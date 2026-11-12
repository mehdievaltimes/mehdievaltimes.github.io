"""Download a Polymarket sample for the volume-selection test.

For resolved Yes/No markets whose end date falls in the window, record the YES price 6, 24 and
72 hours before the market's end, how it resolved, its final volume, and how active it was at
the time. One row per market per horizon:

    market,event,category,start_ts,end_ts,volume,result,hours,price,moves7d,in_random,in_highvol

Two samples, flagged per row so each analysis uses the right one:
  in_random   a uniform random draw from every market in the window, whatever its volume
  in_highvol  every market whose final volume reached --highvol dollars

`volume` is the final lifetime volume, known only after the market ended. `moves7d` is how many
of the 168 hourly prices before the snapshot differed from the hour before: a measure of
activity that was known at the time. (Polymarket's API does not give volume as of a past time.)

    python research/volume-selection/polymarket.py     # about 30 minutes; writes data/polymarket/history.csv.gz

Standard library only. The output is bulk exchange data and stays out of git (/data/ is ignored).
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GAMMA, CLOB = "https://gamma-api.polymarket.com", "https://clob.polymarket.com"
HORIZONS = (6, 24, 72)
# The first of these tags an event carries names its category.
CATEGORIES = ("Sports", "Politics", "Crypto", "Economy", "Finance", "Tech", "Culture", "World", "Weather", "Science")
CAP = 2000  # the listing refuses to page much deeper than this, silently
log = lambda *a: print(*a, file=sys.stderr, flush=True)
iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url, tries=6):
    """GET that backs off when the API pushes back. None on a 4xx or after too many failures."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "research-script"}), timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(3 * (i + 1))
                continue
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            time.sleep(3 * (i + 1))
    return None


def ts(s):
    s = s.replace("Z", "+00:00").replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    return int(dt.datetime.fromisoformat(s).timestamp())


def events(a, b):
    """Every closed event ending in [a, b]. A window too busy for the listing is split in half."""
    out, offset, capped = [], 0, False
    while True:
        r = get(f"{GAMMA}/events?" + urllib.parse.urlencode({"closed": "true", "end_date_min": iso(a), "end_date_max": iso(b), "order": "id", "ascending": "true", "limit": 100, "offset": offset}))
        if not isinstance(r, list) or not r:
            break
        out += r
        offset += len(r)
        if len(r) < 100:
            break
        if offset >= CAP:
            capped = True
            break
    if not capped:
        return out
    if (b - a).total_seconds() <= 60:
        log(f"more than {CAP} events end within a minute of {iso(a)}; the rest are missed")
        return out
    mid = a + (b - a) / 2
    return events(a, mid) + events(mid, b)


def list_day(a, cache):
    """The resolved Yes/No markets of every event ending that day, with the event's category. Cached."""
    f = cache / f"{a:%Y-%m-%d}.json"
    if f.exists():
        return json.loads(f.read_text())
    seen, ms = set(), []
    for e in events(a, a + dt.timedelta(days=1)):
        labels = [t.get("label") for t in e.get("tags") or []]
        category = next((c for c in CATEGORIES if c in labels), "Other")
        for m in e.get("markets") or []:
            try:
                if m["id"] in seen or m.get("outcomes") != '["Yes", "No"]' or m.get("outcomePrices") not in ('["1", "0"]', '["0", "1"]'):
                    continue
                seen.add(m["id"])
                start, end = ts(m["startDate"]), ts(m["endDate"])
                if m.get("closedTime"):
                    end = min(end, ts(m["closedTime"]))  # a market that resolved early ended then
                ms.append({"id": m["id"], "token": json.loads(m["clobTokenIds"])[0], "event": e.get("slug") or e["id"], "category": category,
                           "start": start, "end": end, "volume": round(float(m.get("volumeNum") or 0), 2), "result": int(m["outcomePrices"] == '["1", "0"]')})
            except (KeyError, ValueError, TypeError, IndexError):
                continue
    f.write_text(json.dumps(ms))
    log(f"{a:%b %d}: {len(ms)} markets")
    return ms


def snapshots(m):
    """(hours, price, moves7d) for each horizon that has a price near that time."""
    lo = m["end"] - (max(HORIZONS) + 7 * 24 + 2) * 3600
    r = get(f"{CLOB}/prices-history?" + urllib.parse.urlencode({"market": m["token"], "startTs": lo, "endTs": m["end"] - min(HORIZONS) * 3600 + 3600, "fidelity": 60}))
    hist = sorted((h["t"], float(h["p"])) for h in (r or {}).get("history", []))
    out = []
    for h in HORIZONS:
        target = m["end"] - h * 3600
        if target < m["start"] + 12 * 3600:
            continue  # too close to the market's opening
        before = [x for x in hist if x[0] <= target]
        if not before or target - before[-1][0] > 3 * 3600:
            continue
        week = [x for x in before if x[0] > target - 7 * 86400]
        moves = sum(1 for a, b in zip(week, week[1:]) if abs(a[1] - b[1]) > 1e-9)
        out.append((h, before[-1][1], moves))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-10-11")
    ap.add_argument("--end", default="2026-11-10")
    ap.add_argument("--random", type=int, default=10000, help="size of the uniform random sample")
    ap.add_argument("--highvol", type=float, default=100000, help="also take every market with at least this final volume, in dollars")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=str(ROOT / "data" / "polymarket" / "history.csv.gz"))
    args = ap.parse_args()
    out = Path(args.out)
    cache = out.parent / "listing"
    cache.mkdir(parents=True, exist_ok=True)
    day = lambda s: dt.datetime.fromisoformat(s).replace(tzinfo=dt.UTC)
    days = [day(args.start) + dt.timedelta(days=i) for i in range((day(args.end) - day(args.start)).days)]
    with ThreadPoolExecutor(args.workers) as pool:
        markets = [m for ms in pool.map(lambda a: list_day(a, cache), days) for m in ms]
    markets = list({m["id"]: m for m in markets if m["end"] - m["start"] >= 36 * 3600}.values())  # long enough for a snapshot a day before the end
    rng = random.Random(0)
    in_random = {m["id"] for m in rng.sample(markets, min(args.random, len(markets)))}
    chosen = [m for m in markets if m["id"] in in_random or m["volume"] >= args.highvol]
    rng.shuffle(chosen)  # so a partial run is still a fair sample
    log(f"{len(markets)} markets listed; fetching prices for {len(chosen)} ({len(in_random)} random, {sum(m['volume'] >= args.highvol for m in markets)} high-volume)")
    rows = 0
    with gzip.open(out, "wt", newline="") as f, ThreadPoolExecutor(args.workers) as pool:
        w = csv.writer(f)
        w.writerow(["market", "event", "category", "start_ts", "end_ts", "volume", "result", "hours", "price", "moves7d", "in_random", "in_highvol"])
        for i, (m, snaps) in enumerate(zip(chosen, pool.map(snapshots, chosen))):
            for h, price, moves in snaps:
                w.writerow([m["id"], m["event"], m["category"], m["start"], m["end"], m["volume"], m["result"], h, price, moves, int(m["id"] in in_random), int(m["volume"] >= args.highvol)])
                rows += 1
            if (i + 1) % 1000 == 0:
                f.flush()
                log(f"prices: {i + 1}/{len(chosen)} markets, {rows} rows")
    log(f"wrote {rows} rows to {out}")


if __name__ == "__main__":
    main()
