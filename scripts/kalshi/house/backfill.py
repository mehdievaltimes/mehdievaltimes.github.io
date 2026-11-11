"""Build the house model's training set from Kalshi's public history.

For the series that have tradable markets right now, list the markets that settled since Kalshi's
live-data cutoff, and for each one read the bid/ask it had 6, 24 and 72 hours before it closed
(hourly candles). One row per market per horizon:

    ticker,event,series,category,open_ts,close_ts,volume,result,hours,bid,ask

    python scripts/kalshi/house/backfill.py            # ~1 hour; writes data/kalshi/history.csv.gz

    # lightly traded markets instead: under 200 contracts, spreads up to 30 cents, more series
    python scripts/kalshi/house/backfill.py --min-volume 0 --max-volume 200 --max-spread 0.30 \
        --series 400 --per-series 150 --out data/kalshi/history-thin.csv.gz

Standard library only. The output is bulk Kalshi data, so it stays out of git (data/ is ignored);
only the fitted model is committed.
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

BASE = "https://api.elections.kalshi.com/trade-api/v2"
ROOT = Path(__file__).resolve().parents[3]
HORIZONS = (6, 24, 72)
_last = 0.0


def get(path, tries=7):
    """GET with spacing between calls and backoff on 429/5xx. Returns None on a 4xx."""
    global _last
    for i in range(tries):
        wait = _last + 1.05 - time.time()
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE + path, headers={"accept": "application/json"}), timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(3 * (i + 1))
                continue
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(3 * (i + 1))
    return None


ts = lambda s: int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
num = lambda v: float(v or 0)
log = lambda *a: print(*a, file=sys.stderr, flush=True)


def live_series(max_pages, lo, hi):
    """Series with two-sided markets open right now whose volume is in [lo, hi).

    Ranked by 24h volume, or, when hi caps the volume (a thin-market run), by how many such markets there are.
    """
    now, score, cur = int(time.time()), defaultdict(float), ""
    for _ in range(max_pages):
        d = get(f"/markets?status=open&limit=1000&mve_filter=exclude&min_close_ts={now + 6 * 3600}&max_close_ts={now + 8 * 86400}" + (f"&cursor={cur}" if cur else ""))
        if not d:
            break
        for m in d["markets"]:
            if num(m.get("yes_bid_dollars")) > 0 and num(m.get("yes_ask_dollars")) < 1 and lo <= num(m.get("volume_fp")) < hi:
                score[m["event_ticker"].split("-")[0]] += 1 if hi < math.inf else num(m.get("volume_24h_fp"))
        cur = d.get("cursor")
        if not cur or not d["markets"]:
            break
    return sorted(score, key=score.get, reverse=True)


def settled(series, start, end, max_pages, lo, hi):
    out, cur = [], ""
    for _ in range(max_pages):
        d = get(f"/markets?status=settled&limit=1000&series_ticker={series}&min_close_ts={start}&max_close_ts={end}" + (f"&cursor={cur}" if cur else ""))
        if not d:
            break
        for m in d["markets"]:
            o, c = ts(m["open_time"]), ts(m["close_time"])
            if m.get("result") in ("yes", "no") and c - o >= 12 * 3600 and lo <= num(m.get("volume_fp")) < hi:
                out.append({"ticker": m["ticker"], "event": m["event_ticker"], "open": o, "close": c, "volume": round(num(m.get("volume_fp"))), "result": int(m["result"] == "yes")})
        cur = d.get("cursor")
        if not cur or not d["markets"]:
            break
    return out


def candles(tickers, start, end):
    """ticker -> [(end_ts, bid, ask)], splitting the batch when the API refuses it."""
    d = get(f"/markets/candlesticks?market_tickers={','.join(tickers)}&start_ts={start}&end_ts={end}&period_interval=60")
    if d is None:
        if len(tickers) == 1:
            return {}
        half = len(tickers) // 2
        return {**candles(tickers[:half], start, end), **candles(tickers[half:], start, end)}
    out = {}
    for m in d.get("markets", []):
        rows = []
        for c in m.get("candlesticks", []):
            b, a = c.get("yes_bid", {}).get("close_dollars"), c.get("yes_ask", {}).get("close_dollars")
            if b is not None and a is not None:
                rows.append((c["end_period_ts"], float(b), float(a)))
        out[m["market_ticker"]] = sorted(rows)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "kalshi" / "history.csv.gz"))
    ap.add_argument("--series", type=int, default=140, help="how many of the busiest live series to cover")
    ap.add_argument("--per-series", type=int, default=350, help="markets sampled per series per half of the window")
    ap.add_argument("--open-pages", type=int, default=25)
    ap.add_argument("--min-volume", type=float, default=200, help="contracts traded over the market's life, at least")
    ap.add_argument("--max-volume", type=float, default=math.inf, help="and under this; set it for a thin-market run")
    ap.add_argument("--max-spread", type=float, default=0.10, help="widest bid-ask gap a snapshot may have, in dollars")
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(0)

    cutoff = ts(get("/historical/cutoff")["market_settled_ts"]) + 86400
    end = int(time.time()) - 86400
    mid = (cutoff + end) // 2  # sample each half separately so old and recent closes are both covered
    names = live_series(args.open_pages, args.min_volume, args.max_volume)[: args.series]
    log(f"{len(names)} series, closes from {dt.datetime.fromtimestamp(cutoff, dt.UTC):%b %d} to {dt.datetime.fromtimestamp(end, dt.UTC):%b %d}")

    cache_path = out.parent / "series.json"
    cats = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    ledger = ROOT / "src" / "data" / "kalshi-paper.json"
    if ledger.exists():
        cats = {**{k: v["category"] for k, v in json.loads(ledger.read_text()).get("series", {}).items()}, **cats}

    markets = []
    for i, s in enumerate(names):
        if s not in cats:
            d = get(f"/series/{s}")
            cats[s] = (d or {}).get("series", {}).get("category") or "Other"
        got = 0
        for a, b in ((cutoff, mid), (mid, end)):
            ms = settled(s, a, b, 3, args.min_volume, args.max_volume)
            rng.shuffle(ms)
            for m in ms[: args.per_series]:
                markets.append({**m, "series": s, "category": cats[s]})
            got += min(len(ms), args.per_series)
        log(f"[{i + 1}/{len(names)}] {s} ({cats[s]}): {got} markets, {len(markets)} total")
    cache_path.write_text(json.dumps(cats, indent=1))

    # Markets that close in the same hour share one candle request.
    groups = defaultdict(list)
    for m in markets:
        groups[m["close"] // 3600].append(m)
    rows, done = 0, 0
    with gzip.open(out, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ticker", "event", "series", "category", "open_ts", "close_ts", "volume", "result", "hours", "bid", "ask"])
        for hour, ms in sorted(groups.items()):
            for i in range(0, len(ms), 100):
                chunk = ms[i : i + 100]
                got = candles([m["ticker"] for m in chunk], (hour - max(HORIZONS) - 2) * 3600, (hour - min(HORIZONS) + 1) * 3600)
                for m in chunk:
                    cs = got.get(m["ticker"], [])
                    for h in HORIZONS:
                        target = m["close"] - h * 3600
                        if target < m["open"] + 3600:
                            continue  # the market wasn't open yet
                        before = [c for c in cs if c[0] <= target]
                        if not before or target - before[-1][0] > 3 * 3600:
                            continue  # no quote near that time
                        _, bid, ask = before[-1]
                        if bid > 0 and ask < 1 and ask - bid <= args.max_spread + 1e-9:
                            w.writerow([m["ticker"], m["event"], m["series"], m["category"], m["open"], m["close"], m["volume"], m["result"], h, bid, ask])
                            rows += 1
                done += len(chunk)
            if done % 2000 < 100:
                log(f"candles: {done}/{len(markets)} markets, {rows} rows")
    log(f"wrote {rows} rows for {len(markets)} markets to {out}")


if __name__ == "__main__":
    main()
