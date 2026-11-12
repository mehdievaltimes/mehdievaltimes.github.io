"""Does choosing prediction-market questions by their final volume bias a forecasting benchmark?

Two views of the market's own price a fixed time before the end.

1. By selection rule. For each way of choosing markets:
     slope      the fitted b in logit(P(yes)) = a + b * logit(price). 1 means prices are accurate;
                below 1 means the market looks overconfident.
     best pull  the k that minimises the Brier score of 0.5 + k * (price - 0.5), with an interval.
                It is 1 for accurate prices whatever their mix; below 1 means hedging toward 50% helps.
     hedged     Brier score of a forecaster that pulls every price 20% toward 50%, minus the price's
                own. Negative means this know-nothing hedger beats the market. It depends on the mix
                of prices (hedging a 3-cent price costs more than hedging a 45-cent one), so compare
                it only between groups with similar prices; best pull has no such problem.

2. The leak test. Thresholds can't tell "busier markets are better priced" from "final volume
   leaks the outcome", because final volume and liquidity at the time move together. So fit

       logit(P(yes)) = a + b*x + ... + c * x * log10(final volume) + e * x * log10(liquidity then)

   with x = logit(price). c is how much the slope changes per tenfold final volume among markets
   that looked equally liquid at the time. If final volume only reflected liquidity, c would be 0.
   A negative c means markets that went on to trade more had more surprises: an outcome leak.

Intervals resample whole events. Liquidity at the time is open interest on Kalshi and the number
of hourly price moves in the prior week on Polymarket (its API has no volume as of a past time).

    python research/volume-selection/analyze.py
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
        d["then"], d["usable"] = d["oi"], np.ones(len(rows), bool)
    else:  # Polymarket: one price, two samples
        d["price"] = col("price")
        d["moves7d"], d["in_random"], d["in_highvol"] = col("moves7d"), col("in_random") == 1, col("in_highvol") == 1
        d["then"], d["usable"] = d["moves7d"], d["moves7d"] >= 1  # the price was moving, so it was a real price
    d["price"] = np.clip(d["price"], 0.01, 0.99)
    return d


def fit(X, y, w=None):
    """Logistic regression by Newton's method, optionally with row weights."""
    w = np.ones(len(y)) if w is None else w
    beta = np.zeros(X.shape[1])
    beta[1] = 1.0  # start from "the price is right"
    for _ in range(60):
        p = 1 / (1 + np.exp(-np.clip(X @ beta, -30, 30)))
        step = np.linalg.solve((X * (w * p * (1 - p))[:, None]).T @ X + 1e-8 * np.eye(X.shape[1]), X.T @ (w * (p - y)))
        beta -= step
        if np.abs(step).max() < 1e-8:
            break
    return beta


def event_weights(event, B, seed=0):
    """Row weights for B resamples of whole events."""
    uniq, inv = np.unique(event, return_inverse=True)
    rng = np.random.default_rng(seed)
    for _ in range(B):
        yield np.bincount(rng.integers(0, len(uniq), len(uniq)), minlength=len(uniq))[inv].astype(float)


def measure(d, mask, pull=0.8, B=1000):
    price, y, event = d["price"][mask], d["y"][mask], d["event"][mask]
    x, dev = np.log(price / (1 - price)), price - 0.5
    diff = (0.5 + pull * dev - y) ** 2 - (price - y) ** 2
    num, den = dev * (y - 0.5), dev * dev  # best pull = sum(num) / sum(den)
    boots = np.array([[(w * diff).sum() / w.sum(), (w * num).sum() / (w * den).sum()] for w in event_weights(event, B)])
    (dlo, klo), (dhi, khi) = np.percentile(boots, [2.5, 97.5], axis=0)
    r = lambda v, n=4: round(float(v), n)
    return {"n": int(mask.sum()), "events": len(set(event)), "slope": r(fit(np.stack([np.ones_like(x), x], 1), y)[1], 3),
            "best_pull": r(num.sum() / den.sum(), 3), "best_pull_ci": [r(klo, 3), r(khi, 3)],
            "hedged_minus_price": r(diff.mean(), 5), "hedged_ci": [r(dlo, 5), r(dhi, 5)]}


def table(title, d, rules, min_n):
    print(f"\n{title}")
    print(f"  {'markets kept':46s} {'n':>6s} {'events':>6s} {'slope':>6s}   {'best pull (95%)':>21s}   hedged minus price (95%)")
    out = []
    for name, mask in rules:
        if mask.sum() < min_n:
            print(f"  {name:46s} {mask.sum():6d}   (too few to measure)")
            continue
        r = measure(d, mask)
        k = f"{r['best_pull']:.2f} ({r['best_pull_ci'][0]:.2f} to {r['best_pull_ci'][1]:.2f})"
        print(f"  {name:46s} {r['n']:6d} {r['events']:6d} {r['slope']:6.2f}   {k:>21s}   {r['hedged_minus_price']:+.4f} ({r['hedged_ci'][0]:+.4f} to {r['hedged_ci'][1]:+.4f})")
        out.append({"rule": name, **r})
    return out


def leak_test(title, d, mask, min_n, B=400):
    """The slope's change per tenfold final volume, among markets equally liquid at the time."""
    mask = mask & d["usable"]
    if mask.sum() < min_n:
        print(f"  {title:28s} {mask.sum():6d}   (too few to measure)")
        return None
    price, y, event = d["price"][mask], d["y"][mask], d["event"][mask]
    x = np.log(price / (1 - price))
    final, then = np.log10(1 + d["volume"][mask]), np.log10(1 + d["then"][mask])
    final, then = final - final.mean(), then - then.mean()
    X = np.stack([np.ones_like(x), x, final, then, x * final, x * then], 1)
    c, e = fit(X, y)[4:]
    boots = np.array([fit(X, y, w)[4:] for w in event_weights(event, B)])
    (clo, elo), (chi, ehi) = np.percentile(boots, [2.5, 97.5], axis=0)
    verdict = "final volume leaks the outcome" if chi < 0 else "no leak detected" if clo <= 0 else "final volume goes with fewer surprises"
    print(f"  {title:28s} {mask.sum():6d} {len(set(event)):6d}   final volume {c:+.3f} ({clo:+.3f} to {chi:+.3f})   liquidity then {e:+.3f} ({elo:+.3f} to {ehi:+.3f})   {verdict}")
    r = lambda v: round(float(v), 4)
    return {"group": title, "n": int(mask.sum()), "events": len(set(event)), "final_volume": r(c), "final_volume_ci": [r(clo), r(chi)],
            "liquidity_then": r(e), "liquidity_then_ci": [r(elo), r(ehi)], "verdict": verdict}


def kalshi_rules(d, base):
    rules = [("all, nothing chosen", base)]
    rules += [(f"final volume >= {t:,} contracts", base & (d["volume"] >= t)) for t in (1000, 5000, 20000, 100000)]
    rules += [(f"open interest at the time >= {t:,}", base & (d["oi"] >= t)) for t in (200, 1000, 5000)]
    rules += [(f"volume in the prior 24h >= {t:,}", base & (d["vol24"] >= t)) for t in (500, 5000)]
    return rules


def polymarket_rules(d, base):
    live = base & d["usable"]
    rules = [("random sample, price was live", live & d["in_random"])]
    # Below the census threshold only the random sample is unbiased; above it, every market was downloaded.
    rules += [(f"final volume >= ${t:,} (random sample)", live & d["in_random"] & (d["volume"] >= t)) for t in (1_000, 10_000)]
    rules += [(f"final volume >= ${t:,}", live & d["in_highvol"] & (d["volume"] >= t)) for t in (100_000, 500_000, 1_000_000)]
    rules += [(f"price moved in >= {t} of the prior 168 hours", live & d["in_random"] & (d["moves7d"] >= t)) for t in (24, 72)]
    return rules


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kalshi", default=str(ROOT / "data" / "kalshi" / "history.csv.gz"))
    ap.add_argument("--polymarket", default=str(ROOT / "data" / "polymarket" / "history.csv.gz"))
    ap.add_argument("--hours", type=int, default=24, help="how long before the end the price is taken")
    ap.add_argument("--min-price", type=float, default=0.0, help="leave out prices below this, e.g. 0.05")
    ap.add_argument("--min-n", type=int, default=200, help="smallest group worth measuring")
    ap.add_argument("--json", help="also write the tables here")
    args = ap.parse_args()
    results = {"hours": args.hours, "min_price": args.min_price}
    for name, path, rules in (("Kalshi", args.kalshi, kalshi_rules), ("Polymarket", args.polymarket, polymarket_rules)):
        if not Path(path).exists():
            print(f"\n{name}: no data at {path}")
            continue
        d = load(path)
        base = (d["hours"] == args.hours) & (d["price"] >= args.min_price) & (d["price"] <= 1 - args.min_price)
        sports = d["category"] == "Sports"
        groups = (("all categories", base), ("sports", base & sports), ("everything except sports", base & ~sports))
        results[name] = {"by_rule": {g: table(f"{name}, {args.hours}h before the end, {g}", d, rules(d, m), args.min_n) for g, m in groups}}
        print(f"\n{name}: the leak test. Change in slope per tenfold increase, each holding the other fixed (95%)")
        print(f"  {'group':28s} {'n':>6s} {'events':>6s}")
        results[name]["leak_test"] = [leak_test(g, d, m, args.min_n) for g, m in groups]
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1) + "\n")
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
