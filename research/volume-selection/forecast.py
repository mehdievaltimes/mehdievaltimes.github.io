"""Collect real model forecasts for the volume-selection test.

For every Polymarket non-sports market in the sample that had a live price a day before it
ended, ask a model for the probability of YES as of that day. The model works closed-book: no
tools, and it is not shown the market's price. Its training data ends before these markets
did, so it cannot know the outcomes; searching would find them, which is why search is off.

    python research/volume-selection/forecast.py --models claude-sonnet-5-5,claude-haiku-5-5

Each call is one fresh, headless `claude -p` run answering ten questions. Answers are cached per
model under data/polymarket/forecasts/, so a rerun only asks what is missing, and the combined
table is written to research/volume-selection/forecasts.csv (market id, model, probability).
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import random
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "polymarket"
OUT = Path(__file__).resolve().parent / "forecasts.csv"
log = lambda *a: print(*a, file=sys.stderr, flush=True)

SYSTEM = """You are a careful forecaster. You have no tools and cannot look anything up; use only what you know.

For each question, estimate the probability that it resolves YES. Each question says what day it is being asked; treat that as today. Read the resolution details closely. Give your honest best estimate even when you are unsure.

Reply with only a JSON array, one object per question, in the order given:
[{"id": "<the question's id>", "p": <a number between 0 and 1>}]
No other text."""


def markets():
    """The non-sports markets with a live price a day before the end, one row each."""
    rows = [r for r in csv.DictReader(gzip.open(DATA / "history.csv.gz", "rt")) if r["hours"] == "24" and r["category"] != "Sports" and int(r["moves7d"]) >= 1]
    return {r["market"]: r for r in rows}


def questions(ids):
    """Question text for each market, fetched 25 at a time and cached."""
    cache = DATA / "questions.json"
    known = json.loads(cache.read_text()) if cache.exists() else {}
    missing = [i for i in ids if i not in known]
    for k in range(0, len(missing), 25):
        url = "https://gamma-api.polymarket.com/markets?closed=true&limit=100&" + "&".join("id=" + i for i in missing[k : k + 25])
        with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "research-script"}), timeout=90) as r:
            for m in json.load(r):
                known[m["id"]] = {"question": m["question"], "details": " ".join((m.get("description") or "").split())[:500]}
        time.sleep(0.2)
    cache.write_text(json.dumps(known))
    return known


def ask(model, batch, qs, ms):
    """One CLI run for a batch of market ids -> {id: probability}."""
    day = lambda t: dt.datetime.fromtimestamp(t, dt.UTC).strftime("%Y-%m-%d")
    parts = []
    for i in batch:
        end = int(ms[i]["end_ts"])
        parts.append(f"[id {i}] Asked on {day(end - 86400)}. The market ends on {day(end)}.\nQuestion: {qs[i]['question']}\nResolution details: {qs[i]['details']}")
    prompt = "\n\n".join(parts)
    with tempfile.TemporaryDirectory() as cwd:
        try:
            r = subprocess.run(["claude", "-p", prompt, "--model", model, "--system-prompt", SYSTEM, "--tools", "", "--setting-sources", "",
                                "--disable-slash-commands", "--no-session-persistence", "--max-turns", "2", "--output-format", "json"],
                               cwd=cwd, capture_output=True, text=True, timeout=300)
            d = json.loads(r.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            return {}
    served = list((d.get("modelUsage") or {}).keys())
    if d.get("is_error") or (served and not any(s.startswith(model) for s in served)):
        return {}
    text = d.get("result") or ""
    try:
        answers = json.loads(text[text.index("[") : text.rindex("]") + 1])
    except (ValueError, json.JSONDecodeError):
        return {}
    out = {}
    for a in answers:
        try:
            i, p = str(a["id"]), float(a["p"])
        except (KeyError, TypeError, ValueError):
            continue
        if i in batch and 0 <= p <= 1:
            out[i] = p
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="claude-sonnet-5-5,claude-haiku-5-5")
    ap.add_argument("--batch", type=int, default=10)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="only the first N markets, for a trial run")
    args = ap.parse_args()
    ms = markets()
    ids = sorted(ms)
    random.Random(0).shuffle(ids)  # mix the batches so related markets are not asked together
    if args.limit:
        ids = ids[: args.limit]
    qs = questions(ids)
    ids = [i for i in ids if i in qs]
    (DATA / "forecasts").mkdir(exist_ok=True)
    table = []
    for model in args.models.split(","):
        cache = DATA / "forecasts" / f"{model}.jsonl"
        done = {}
        if cache.exists():
            for line in cache.read_text().splitlines():
                rec = json.loads(line)
                done[rec["id"]] = rec["p"]
        todo = [i for i in ids if i not in done]
        batches = [todo[k : k + args.batch] for k in range(0, len(todo), args.batch)]
        log(f"{model}: {len(done)} cached, asking {len(todo)} in {len(batches)} calls")
        with cache.open("a") as f, ThreadPoolExecutor(args.workers) as pool:
            for n, got in enumerate(pool.map(lambda b: ask(model, b, qs, ms), batches)):
                for i, p in got.items():
                    done[i] = p
                    f.write(json.dumps({"id": i, "p": p}) + "\n")
                f.flush()
                if (n + 1) % 20 == 0:
                    log(f"{model}: {n + 1}/{len(batches)} calls, {len(done)} answers")
        log(f"{model}: {len(done)} of {len(ids)} answered")
        table += [(i, model, done[i]) for i in ids if i in done]
    if not args.limit:
        with OUT.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["market", "model", "p"])
            w.writerows(sorted(table))
        log(f"wrote {OUT}")


if __name__ == "__main__":
    main()
