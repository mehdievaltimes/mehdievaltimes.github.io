"""Score real model forecasts against the market, with and without a volume filter.

Uses the Polymarket non-sports sample and the closed-book forecasts from forecast.py. For each
model it reports, under each way of choosing markets, the Brier score of the market's price a
day before the end, the model's, and the gap between them (positive = the model is worse).

A raw gap can change between groups just because the questions differ, so there is also a direct
test, the same idea as the leak test in analyze.py. Each market gets the model's advantage

    advantage = (price - outcome)^2 - (forecast - outcome)^2      (positive = model beat the price)

which is regressed on log10(final volume) together with things known at the time: how active the
market was, how far the price was from 50%, and how far the forecast was from 50%. The coefficient
on final volume is how much the model's advantage grows per tenfold final volume among markets
that looked alike a day before the end. It should be zero if final volume carries no information
about outcomes. Intervals are 95% and resample whole events.

    python research/volume-selection/score_forecasts.py --json research/volume-selection/forecast_results.json
"""
import argparse
import csv
import gzip
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load():
    hist = {r["market"]: r for r in csv.DictReader(gzip.open(ROOT / "data" / "polymarket" / "history.csv.gz", "rt"))
            if r["hours"] == "24" and r["category"] != "Sports" and int(r["moves7d"]) >= 1}
    models = {}
    for r in csv.DictReader(open(HERE / "forecasts.csv")):
        if r["market"] in hist:
            models.setdefault(r["model"], {})[r["market"]] = float(r["p"])
    return hist, models


def arrays(hist, ids):
    col = lambda name, cast=float: np.array([cast(hist[i][name]) for i in ids])
    return {"price": np.clip(col("price"), 0.01, 0.99), "y": col("result"), "volume": col("volume"), "moves": col("moves7d"), "event": col("event", str),
            "category": col("category", str), "random": col("in_random", int) == 1, "highvol": col("in_highvol", int) == 1}


def event_weights(event, B, seed=0):
    uniq, inv = np.unique(event, return_inverse=True)
    rng = np.random.default_rng(seed)
    for _ in range(B):
        yield np.bincount(rng.integers(0, len(uniq), len(uniq)), minlength=len(uniq))[inv].astype(float)


def mean_ci(values, event, B=2000):
    boots = [(w * values).sum() / w.sum() for w in event_weights(event, B)]
    return float(values.mean()), [float(v) for v in np.percentile(boots, [2.5, 97.5])]


def rules(d):
    return [("random sample", d["random"]),
            ("final volume >= $1,000 (random sample)", d["random"] & (d["volume"] >= 1_000)),
            ("final volume >= $100,000", d["highvol"]),
            ("final volume >= $500,000", d["highvol"] & (d["volume"] >= 500_000)),
            ("price moved in >= 24 of the prior 168 hours", d["random"] & (d["moves"] >= 24))]


def advantage_test(d, f, B=1000):
    """OLS of the model's advantage on final volume, holding fixed what was known at the time."""
    adv = (d["price"] - d["y"]) ** 2 - (f - d["y"]) ** 2
    cols = [np.log10(1 + d["volume"]), np.log10(1 + d["moves"]), np.abs(d["price"] - 0.5), np.abs(f - 0.5)]
    X = np.stack([np.ones(len(adv))] + [c - c.mean() for c in cols], 1)
    solve = lambda w: np.linalg.solve((X * w[:, None]).T @ X, X.T @ (w * adv))[1]
    lo, hi = np.percentile([solve(w) for w in event_weights(d["event"], B)], [2.5, 97.5])
    return float(solve(np.ones(len(adv)))), [float(lo), float(hi)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-n", type=int, default=150)
    ap.add_argument("--json")
    args = ap.parse_args()
    hist, models = load()
    r4 = lambda v: round(v, 4)
    results = {}
    for model, fc in sorted(models.items()):
        ids = sorted(fc)
        d, f = arrays(hist, ids), np.array([fc[i] for i in ids])
        bm, bf = (d["price"] - d["y"]) ** 2, (f - d["y"]) ** 2
        print(f"\n{model}: {len(ids)} forecasts, {len(set(d['event']))} events. Average distance of its forecasts from 50%: {np.abs(f - 0.5).mean():.2f} (the market's: {np.abs(d['price'] - 0.5).mean():.2f})")
        print(f"  {'markets kept':46s} {'n':>5s} {'events':>6s} {'market':>7s} {'model':>7s}   model minus market (95%)")
        rows = []
        for name, mask in rules(d):
            if mask.sum() < args.min_n:
                print(f"  {name:46s} {mask.sum():5d}   (too few to measure)")
                continue
            gap, ci = mean_ci((bf - bm)[mask], d["event"][mask])
            print(f"  {name:46s} {mask.sum():5d} {len(set(d['event'][mask])):6d} {bm[mask].mean():7.4f} {bf[mask].mean():7.4f}   {gap:+.4f} ({ci[0]:+.4f} to {ci[1]:+.4f})")
            rows.append({"rule": name, "n": int(mask.sum()), "events": len(set(d["event"][mask])), "market_brier": r4(float(bm[mask].mean())),
                         "model_brier": r4(float(bf[mask].mean())), "gap": r4(gap), "gap_ci": [r4(c) for c in ci]})
        coef, ci = advantage_test(d, f)
        verdict = "the model gains where final volume is high" if ci[0] > 0 else "the model loses ground where final volume is high" if ci[1] < 0 else "no clear effect"
        print(f"  advantage per tenfold final volume, markets alike at the time: {coef:+.4f} ({ci[0]:+.4f} to {ci[1]:+.4f})   {verdict}")
        unsure = (d["price"] > 0.4) & (d["price"] < 0.6)
        print(f"  check for knowing the outcomes: on the {unsure.sum()} markets priced 40 to 60 cents, model Brier {bf[unsure].mean():.3f} (a coin flip scores 0.250)")
        results[model] = {"n": len(ids), "by_rule": rows, "advantage_per_10x_final_volume": r4(coef), "advantage_ci": [r4(c) for c in ci], "verdict": verdict,
                          "brier_on_uncertain_markets": r4(float(bf[unsure].mean())), "uncertain_markets": int(unsure.sum())}
    names = sorted(models)
    if len(names) == 2:
        a, b = names
        ids = sorted(set(models[a]) & set(models[b]))
        d = arrays(hist, ids)
        diff = (np.array([models[a][i] for i in ids]) - d["y"]) ** 2 - (np.array([models[b][i] for i in ids]) - d["y"]) ** 2
        print(f"\n{a} minus {b}, Brier score (negative = {a} is better)")
        ranking = []
        for name, mask in rules(d):
            if mask.sum() < args.min_n:
                continue
            gap, ci = mean_ci(diff[mask], d["event"][mask])
            print(f"  {name:46s} {mask.sum():5d}   {gap:+.4f} ({ci[0]:+.4f} to {ci[1]:+.4f})")
            ranking.append({"rule": name, "n": int(mask.sum()), "gap": r4(gap), "gap_ci": [r4(c) for c in ci]})
        results["ranking"] = {"a": a, "b": b, "by_rule": ranking}
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1) + "\n")
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
