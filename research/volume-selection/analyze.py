"""Does choosing prediction-market questions by their final volume bias a forecasting benchmark?

For each way of choosing markets, this reports three things about the market's own price a
fixed time before the end:

  slope     the fitted b in logit(P(yes)) = a + b * logit(price). 1 means prices are accurate;
            below 1 means the market looks overconfident.
  best pull the shrink toward 50% that minimises the Brier score: forecast = 0.5 + k * (price - 0.5).
            k = 1 means the price can't be improved by hedging; below 1 means hedging helps.
  hedged    Brier score of a forecaster that pulls every price 20% toward 50% (k = 0.8), minus the
            Brier score of the price itself. Negative means this know-nothing hedger beats the market.
            The interval resamples whole events.

Choosing by final volume uses a number nobody had at forecast time. The control rows choose by
what was known then (open interest or recent volume on Kalshi, recent price activity on Polymarket).

    python research/volume-selection/analyze.py                      # both exchanges, 24h before the end
    python research/volume-selection/analyze.py --hours 72 --json research/volume-selection/results.json
"""
import argparse
import csv
import gzip
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    rows = list(csv.DictReader(gzip.open(path, "rt")))
    col = lambda name, cast=float: np.array([cast(r[name]) for r in rows])
    d = {"event": col("event", str), "category": col("category", str), "hours": col("hours", int), "y": col("result"), "volume": col("volume")}
    if "bid" in rows[0]:  # Kalshi: a two-sided quote
        d["price"] = (col("bid") + col("ask")) / 2
        d["oi"], d["vol24"] = col("oi"), col("vol24")
    else:  # Polymarket: one price, two samples
        d["price"] = col("price")
        d["moves7d"], d["in_random"], d["in_highvol"] = col("moves7d"), col("in_random") == 1, col("in_highvol") == 1
    d["price"] = np.clip(d["price"], 0.01, 0.99)
    return d


def slope(price, y):
    x = np.log(price / (1 - price))
    X, w = np.stack([np.ones_like(x), x], 1), np.array([0.0, 1.0])
    for _ in range(50):
        p = 1 / (1 + np.exp(-X @ w))
        step = np.linalg.solve((X * (p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(2), X.T @ (p - y))
        w -= step
        if np.abs(step).max() < 1e-9:
            break
    return w[1]


def measure(d, mask, pull=0.8, B=2000):
    price, y, event = d["price"][mask], d["y"][mask], d["event"][mask]
    dev = price - 0.5
    diff = (0.5 + pull * dev - y) ** 2 - (price - y) ** 2
    uniq, inv = np.unique(event, return_inverse=True)
    num, den = np.zeros(len(uniq)), np.zeros(len(uniq))
    np.add.at(num, inv, diff)
    np.add.at(den, inv, 1.0)
    idx = np.random.default_rng(0).integers(0, len(uniq), (B, len(uniq)))
    lo, hi = np.percentile(num[idx].sum(1) / den[idx].sum(1), [2.5, 97.5])
    return {"n": int(mask.sum()), "events": len(uniq), "yes_share": round(float(y.mean()), 4), "slope": round(float(slope(price, y)), 3),
            "best_pull": round(float((dev * (y - 0.5)).mean() / (dev * dev).mean()), 3),
            "hedged_minus_price": round(float(diff.mean()), 5), "ci": [round(float(lo), 5), round(float(hi), 5)]}


def table(title, d, rules, min_n=300):
    print(f"\n{title}")
    print(f"  {'markets kept':44s} {'n':>6s} {'events':>6s} {'slope':>6s} {'best pull':>9s}   hedged minus price (95% interval)")
    out = []
    for name, mask in rules:
        if mask.sum() < min_n:
            print(f"  {name:44s} {mask.sum():6d}   (too few to measure)")
            continue
        r = measure(d, mask)
        verdict = "hedging wins" if r["ci"][1] < 0 else "hedging loses" if r["ci"][0] > 0 else "no clear difference"
        print(f"  {name:44s} {r['n']:6d} {r['events']:6d} {r['slope']:6.2f} {r['best_pull']:9.2f}   {r['hedged_minus_price']:+.4f} ({r['ci'][0]:+.4f} to {r['ci'][1]:+.4f})  {verdict}")
        out.append({"rule": name, **r, "verdict": verdict})
    return out


def kalshi_rules(d, base):
    rules = [("all, nothing chosen", base)]
    rules += [(f"final volume >= {t:,} contracts", base & (d["volume"] >= t)) for t in (1000, 5000, 20000, 100000)]
    rules += [(f"open interest at the time >= {t:,}", base & (d["oi"] >= t)) for t in (200, 1000, 5000)]
    rules += [(f"volume in the prior 24h >= {t:,}", base & (d["vol24"] >= t)) for t in (500, 5000)]
    return rules


def polymarket_rules(d, base):
    live = base & (d["moves7d"] >= 1)  # the price was moving, so it was a real price
    rules = [("random sample, price was live", live & d["in_random"])]
    # Below the census threshold only the random sample is unbiased; above it, every market was downloaded.
    rules += [(f"final volume >= ${t:,} (random sample)", live & d["in_random"] & (d["volume"] >= t)) for t in (1_000, 10_000)]
    rules += [(f"final volume >= ${t:,}", live & d["in_highvol"] & (d["volume"] >= t)) for t in (100_000, 500_000, 1_000_000)]
    rules += [(f"price moved in >= {t} of the prior 168 hours", live & d["in_random"] & (d["moves7d"] >= t)) for t in (24, 72, 120)]
    return rules


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kalshi", default=str(ROOT / "data" / "kalshi" / "history.csv.gz"))
    ap.add_argument("--polymarket", default=str(ROOT / "data" / "polymarket" / "history.csv.gz"))
    ap.add_argument("--hours", type=int, default=24, help="how long before the end the price is taken")
    ap.add_argument("--json", help="also write the tables here")
    args = ap.parse_args()
    results = {"hours": args.hours}
    for name, path, rules in (("Kalshi", args.kalshi, kalshi_rules), ("Polymarket", args.polymarket, polymarket_rules)):
        if not Path(path).exists():
            print(f"\n{name}: no data at {path}")
            continue
        d = load(path)
        base = d["hours"] == args.hours
        sports = d["category"] == "Sports"
        results[name] = {
            "all": table(f"{name}, {args.hours}h before the end, all categories", d, rules(d, base)),
            "sports": table(f"{name}, sports only", d, rules(d, base & sports)),
            "non_sports": table(f"{name}, everything except sports", d, rules(d, base & ~sports)),
        }
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1) + "\n")
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
