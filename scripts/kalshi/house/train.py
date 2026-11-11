"""Fit and test the house model: a correction to Kalshi's own prices.

The model is deliberately small. For a market in category g, priced at mid m, some hours before close:

    logit(p) = (a + a_g + a_h) + (b + b_g + b_h) * logit(m)

A slope above 1 means prices are too timid (favourites win more often than they cost, longshots
less): the favourite-longshot bias. A negative intercept means YES is overpriced across the board.
It is fitted on the older closes and judged on the later ones, both as a forecast (Brier score
against the raw price) and as a trader under the same rules as scripts/kalshi/book.mjs.

    pip install numpy
    python scripts/kalshi/house/backfill.py     # the data
    python scripts/kalshi/house/train.py        # prints the report, writes scripts/kalshi/house-model.json
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
HORIZONS = (6, 24, 72)
CFG = dict(min_edge=0.05, kelly=0.25, max_stake=50.0, fee=0.07, bankroll=1000.0, max_spread=0.08)

logit = lambda p: np.log(p / (1 - p))
sigmoid = lambda z: 1 / (1 + np.exp(-z))


def load(path, min_group):
    rows = list(csv.DictReader(gzip.open(path, "rt")))
    n_by_cat = Counter(r["category"] for r in rows)
    group = lambda c: c if n_by_cat[c] >= min_group else "Other"
    d = {
        "event": np.array([r["event"] for r in rows]),
        "group": np.array([group(r["category"]) for r in rows]),
        "close": np.array([int(r["close_ts"]) for r in rows]),
        "hours": np.array([int(r["hours"]) for r in rows]),
        "y": np.array([int(r["result"]) for r in rows], float),
        "bid": np.array([float(r["bid"]) for r in rows]),
        "ask": np.array([float(r["ask"]) for r in rows]),
    }
    d["mid"] = np.clip((d["bid"] + d["ask"]) / 2, 0.01, 0.99)
    return d, len({r["ticker"] for r in rows})


def design(d, groups):
    """Columns: 1, x, then an intercept and a slope deviation for each group and each non-24h horizon."""
    x = logit(d["mid"])
    cols, names = [np.ones_like(x), x], ["a", "b"]
    for g in groups:
        on = (d["group"] == g).astype(float)
        cols += [on, on * x]
        names += [f"a[{g}]", f"b[{g}]"]
    for h in HORIZONS:
        if h == 24:
            continue
        on = (d["hours"] == h).astype(float)
        cols += [on, on * x]
        names += [f"a[{h}h]", f"b[{h}h]"]
    return np.stack(cols, 1), names


def fit(X, y, lam):
    """Logistic regression by Newton's method; the ridge penalty spares the two global terms."""
    w = np.zeros(X.shape[1])
    w[1] = 1.0  # start from "the price is right"
    pen = np.full(X.shape[1], lam)
    pen[:2] = 0
    for _ in range(50):
        p = sigmoid(X @ w)
        g = X.T @ (p - y) + pen * w
        H = (X * (p * (1 - p))[:, None]).T @ X + np.diag(pen) + 1e-9 * np.eye(len(w))
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


def sub(d, mask):
    return {k: v[mask] for k, v in d.items()}


def boot_ci(per_event_num, per_event_den=None, B=4000, seed=0):
    """95% interval for a sum (or a ratio of sums) when whole events are resampled."""
    rng = np.random.default_rng(seed)
    n = len(per_event_num)
    idx = rng.integers(0, n, (B, n))
    num = per_event_num[idx].sum(1)
    stat = num if per_event_den is None else num / np.maximum(per_event_den[idx].sum(1), 1e-12)
    return np.percentile(stat, [2.5, 97.5])


def by_event(events, values):
    uniq, inv = np.unique(events, return_inverse=True)
    out = np.zeros(len(uniq))
    np.add.at(out, inv, values)
    return out


def trade(d, p, rand=None):
    """Profit per row under book.mjs's rules (fee multiplier 1, no size limit). rand -> the coin flip."""
    pc = np.clip(p, 0.02, 0.98)
    ok = (d["bid"] > 0) & (d["ask"] < 1) & (d["ask"] - d["bid"] <= CFG["max_spread"] + 1e-9) & (d["ask"] >= 0.06) & (d["ask"] <= 0.94)
    price_y, price_n = d["ask"], 1 - d["bid"]
    unit = lambda pr: pr + CFG["fee"] * pr * (1 - pr)
    edge_y, edge_n = pc - unit(price_y), (1 - pc) - unit(price_n)
    if rand is None:
        yes = edge_y >= edge_n
        edge = np.where(yes, edge_y, edge_n)
        price = np.where(yes, price_y, price_n)
        win = np.where(yes, pc, 1 - pc)
        go = ok & (edge >= CFG["min_edge"])
        stake = np.minimum(CFG["max_stake"], CFG["kelly"] * (win - unit(price)) / (1 - unit(price)) * CFG["bankroll"])
    else:
        yes = rand < 0.5
        price = np.where(yes, price_y, price_n)
        go = ok
        stake = np.full(len(pc), 25.0)
    n = np.where(go, np.floor(stake / unit(price) + 1e-9), 0)
    fee = np.ceil(CFG["fee"] * n * price * (1 - price) * 100 - 1e-9) / 100
    won = np.where(yes, d["y"], 1 - d["y"])
    cost = n * price + fee
    return n * won - cost, cost, n > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data" / "kalshi" / "history.csv.gz"))
    ap.add_argument("--out", default=str(ROOT / "scripts" / "kalshi" / "house-model.json"))
    ap.add_argument("--train-share", type=float, default=0.6, help="share of the time span used for fitting")
    ap.add_argument("--min-group", type=int, default=1500, help="a category needs this many rows to get its own terms")
    ap.add_argument("--max-spread", type=float, default=CFG["max_spread"], help="widest bid-ask gap the simulated trader will cross")
    args = ap.parse_args()
    CFG["max_spread"] = args.max_spread

    d, n_markets = load(args.data, args.min_group)
    groups = sorted(set(d["group"]) - {"Other"})
    t0, t1 = d["close"].min(), d["close"].max()
    split = t0 + args.train_share * (t1 - t0)
    day = lambda t: dt.datetime.fromtimestamp(int(t), dt.UTC).strftime("%b %d")
    tr, te = sub(d, d["close"] < split), sub(d, d["close"] >= split)
    print(f"{len(d['y'])} rows from {n_markets} markets, {len(set(d['event']))} events")
    print(f"fit on closes {day(t0)} to {day(split)} ({len(tr['y'])} rows); tested on {day(split)} to {day(t1)} ({len(te['y'])} rows)")
    print("rows by category:", dict(Counter(d["group"]).most_common()))

    # How well do raw prices line up with outcomes? (all rows, 24h before close)
    print("\nprice 24h before close -> how often YES actually happened")
    h24 = sub(d, d["hours"] == 24)
    table = []
    for lo in range(0, 100, 10):
        m = (h24["mid"] * 100 >= lo) & (h24["mid"] * 100 < lo + 10)
        if m.sum() >= 30:
            table.append({"bucket": f"{lo}-{lo + 10}", "n": int(m.sum()), "price": round(float(h24["mid"][m].mean()), 4), "yes": round(float(h24["y"][m].mean()), 4)})
            print(f"  {lo:2d}-{lo + 10:3d}¢  n={m.sum():5d}  mean price {h24['mid'][m].mean() * 100:5.1f}¢  YES {h24['y'][m].mean() * 100:5.1f}%")

    # Choose the ridge strength on the last fifth of the fitting period, then refit on all of it.
    cut = t0 + 0.8 * (split - t0)
    a, b = sub(tr, tr["close"] < cut), sub(tr, tr["close"] >= cut)
    best = None
    for lam in (1, 10, 100, 1000, 10000):
        w = fit(design(a, groups)[0], a["y"], lam)
        p = np.clip(sigmoid(design(b, groups)[0] @ w), 1e-6, 1 - 1e-6)
        ll = -np.mean(b["y"] * np.log(p) + (1 - b["y"]) * np.log(1 - p))
        if best is None or ll < best[0]:
            best = (ll, lam)
    lam = best[1]
    X, names = design(tr, groups)
    w = fit(X, tr["y"], lam)
    print(f"\nridge strength {lam}. Fitted terms (slope b > 1: prices too timid; intercept a < 0: YES overpriced):")
    for n, v in zip(names, w):
        print(f"  {n:28s} {v:+.3f}")

    p_te = sigmoid(design(te, groups)[0] @ w)
    brier = lambda p, y: (p - y) ** 2
    report = {"horizons": {}}
    print("\nheld-out forecasts: Brier score, lower is better")
    for h in ("all",) + HORIZONS:
        m = np.ones(len(te["y"]), bool) if h == "all" else te["hours"] == h
        bm, bk = brier(p_te[m], te["y"][m]), brier(te["mid"][m], te["y"][m])
        ev = te["event"][m]
        lo, hi = boot_ci(by_event(ev, bm - bk), by_event(ev, np.ones(m.sum())))
        print(f"  {str(h):>3}{'h' if h != 'all' else ' '}  n={m.sum():6d}  model {bm.mean():.4f}  price {bk.mean():.4f}  difference {bm.mean() - bk.mean():+.4f}  (95% {lo:+.4f} to {hi:+.4f})")
        report["horizons"][str(h)] = {"n": int(m.sum()), "model": round(float(bm.mean()), 5), "price": round(float(bk.mean()), 5), "diff_ci": [round(float(lo), 5), round(float(hi), 5)]}

    print("\nheld-out trading under the book's rules (5¢ minimum edge after fees, quarter Kelly, $50 cap)")
    rng = np.random.default_rng(1)
    sims = {}
    for h in HORIZONS:
        m = te["hours"] == h
        s = sub(te, m)
        for name, (pnl, cost, took) in (("model", trade(s, p_te[m])), ("coin flip", trade(s, np.full(m.sum(), 0.5), rng.random(m.sum())))):
            lo, hi = boot_ci(by_event(s["event"], pnl))
            roi = pnl.sum() / max(cost.sum(), 1e-9)
            print(f"  {h:2d}h  {name:9s}  {took.sum():5d} trades of {m.sum():6d}  staked ${cost.sum():9.0f}  profit ${pnl.sum():+9.0f}  ({roi * 100:+.1f}% of stakes; 95% ${lo:+.0f} to ${hi:+.0f})")
            sims[f"{h}h {name}"] = {"trades": int(took.sum()), "staked": round(float(cost.sum()), 2), "profit": round(float(pnl.sum()), 2), "ci": [round(float(lo), 2), round(float(hi), 2)]}
        if h == 24:
            pnl, cost, took = trade(s, p_te[m])
            print("       model at 24h by category:")
            for g in sorted(set(s["group"])):
                k = (s["group"] == g) & took
                if k.sum():
                    print(f"         {g:24s} {k.sum():5d} trades  profit ${pnl[k].sum():+8.0f}  ({pnl[k].sum() / cost[k].sum() * 100:+.1f}%)")
    report["trading"] = sims

    out = {
        "version": 1,
        "trained": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d"),
        "fit": {"from": day(t0), "to": day(split), "rows": int(len(tr["y"]))},
        "test": {"from": day(split), "to": day(t1), "rows": int(len(te["y"]))},
        "terms": {n: round(float(v), 4) for n, v in zip(names, w)},
        "groups": groups,
        "calibration_24h": table,
        "report": report,
    }
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
