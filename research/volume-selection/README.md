# Does choosing questions by final volume bias a forecasting benchmark?

Research notes, kept in the repo and not published on the site. Last run: Nov 12, 2026.

**Short answer: in some markets, yes.** A market's final trading volume is only known after it
ends, and in two of the four groups tested it carries information about how the market resolved.
Choosing questions by it then distorts how accurate the market's own price looks, which is the
baseline forecasting benchmarks compare models against.

## The question

Benchmarks that score language models on prediction-market questions often keep only markets
above some total volume. Total volume is measured over the market's whole life. If markets trade
more when something unexpected is happening, a volume filter keeps the surprises, and the price
from before the surprise looks worse than it was.

## Data

| | Kalshi | Polymarket |
|---|---|---|
| Window (market end) | Sep 12 to Nov 10, 2026 | Oct 11 to Nov 10, 2026 |
| Markets listed | sampled from the 200 busiest series | 289,101 resolved Yes/No markets |
| Sample | up to 150 markets per series per half of the window, chosen at random | 10,000 at random, plus all 2,002 with final volume of $100,000 or more |
| Snapshots | 68,932 from 29,223 markets | 32,799 from 11,778 markets |
| Price | bid/ask midpoint 6, 24 and 72 hours before the close | YES price 6, 24 and 72 hours before the end |
| Final volume | contracts traded over the market's life | dollars traded over the market's life |
| Liquidity at the time | open interest at the snapshot | hourly price moves in the prior week (the API has no past volume) |

Nothing in either sample is chosen by final volume, except Polymarket's high-volume census, which
is flagged and only used for the rows that say so. About 93% of the Kalshi snapshots and 81% of
Polymarket's are sports. A second Kalshi download without sports added 5,150 snapshots.

## Method

Two views, both in `analyze.py`. Intervals are 95% and resample whole events.

1. **By selection rule.** For each way of choosing markets: the calibration slope `b` in
   `logit(P(yes)) = a + b * logit(price)` (1 means accurate, below 1 means the market looks
   overconfident), and the pull toward 50% that would minimise the price's Brier score (1 means
   hedging can't help).
2. **The leak test.** Thresholds can't separate "busier markets are better priced" from "final
   volume leaks the outcome", because final volume and liquidity at the time move together. So the
   slope is allowed to vary with both at once. The coefficient on final volume is how much the
   slope changes per tenfold final volume among markets that looked equally liquid at the time. It
   should be zero if final volume only reflects liquidity. Negative means markets that went on to
   trade more had more surprises.

## Results, 24 hours before the end

### The leak test

| Group | Snapshots | Events | Slope change per 10x final volume | Verdict |
|---|---:|---:|---|---|
| Kalshi, sports | 22,646 | 11,636 | -0.37 (-0.42 to -0.32) | leak |
| Kalshi, everything else | 1,510 | 381 | -0.05 (-0.32 to +0.26) | can't tell |
| Polymarket, sports | 8,814 | 5,664 | +0.03 (-0.02 to +0.07) | none detected |
| Polymarket, everything else | 2,284 | 1,501 | -0.23 (-0.34 to -0.13) | leak |

Within Polymarket's non-sports markets the leak shows separately in weather (-0.74, -1.34 to
-0.42), politics (-0.26, -0.59 to -0.05) and crypto (-0.87, -3.23 to -0.40). Finance has too few
markets to say.

### What a volume filter does to the baseline

Kalshi, all categories:

| Markets kept | Snapshots | Slope | Best pull toward 50% |
|---|---:|---:|---|
| All, nothing chosen | 24,156 | 1.06 | 1.02 (1.01 to 1.04) |
| Final volume of 20,000 contracts or more | 9,868 | 0.80 | 0.86 (0.83 to 0.90) |
| Final volume of 100,000 contracts or more | 4,472 | 0.72 | 0.78 (0.72 to 0.84) |
| Open interest at the time of 1,000 or more | 4,787 | 1.09 | 1.03 (1.00 to 1.06) |

Here a forecaster that knows nothing and pulls every price 20% toward 50% beats the market's
Brier score on the high-volume sets (by 0.0025 at 100,000 contracts, interval 0.0013 to 0.0036)
and loses everywhere else.

Polymarket, everything except sports:

| Markets kept | Snapshots | Slope | Best pull toward 50% |
|---|---:|---:|---|
| Random sample | 1,575 | 1.45 | 1.10 (1.08 to 1.12) |
| Final volume of $100,000 or more | 737 | 0.92 | 0.97 (0.93 to 1.02) |
| Price moved in 72 or more of the prior 168 hours | 262 | 1.33 | 1.05 (1.00 to 1.10) |

The volume filter moves the market from looking underconfident to looking about right or slightly
overconfident. The hedging forecaster does not beat the market in any Polymarket group.

## Checks

- **Horizon.** Kalshi sports: -0.39, -0.37 and -0.30 at 6, 24 and 72 hours, all clear of zero.
  Polymarket non-sports: -0.18 and -0.23 at 6 and 24 hours, both clear of zero; -0.11 at 72 hours,
  where the interval reaches +0.01.
- **Extreme prices removed** (5 to 95 cents only): Kalshi sports -0.37, Polymarket non-sports
  -0.25, both clear of zero. Polymarket sports stays at zero.
- **More Kalshi non-sports data** (348 events at 24 hours): still can't tell, -0.04 (-0.31 to +0.27).

## What this does not show

- That any published benchmark is wrong. Two recent ones use volume filters, but I have only seen
  search summaries of them and have not checked how or when they measure volume.
- That hedging forecasters gain everywhere. That happens on Kalshi sports only.
- Why Polymarket sports shows no leak when Kalshi sports shows a strong one.
- Anything about Kalshi outside sports: 381 events is too few.
- An effect on real model forecasts. The hedger here is synthetic.

Other limits: one to two months of data, the Polymarket "liquidity at the time" measure is a proxy,
and Polymarket's end time is the earlier of the scheduled end and the actual close.

## Next

1. Score real model forecasts with and without a volume filter, to see whether rankings move.
2. Get more Kalshi non-sports markets by going past the live-data cutoff into the historical API.
3. Find out what differs about Polymarket sports.
4. Read the two volume-filtered benchmarks properly.

## Reproduce

```sh
pip install numpy
python scripts/kalshi/house/backfill.py                 # data/kalshi/history.csv.gz, about 90 minutes
python research/volume-selection/polymarket.py          # data/polymarket/history.csv.gz, about 30 minutes
python research/volume-selection/analyze.py --json research/volume-selection/results.json
```

Both downloads use public endpoints with no account. One trap: Polymarket's listing silently stops
near 2,000 rows per query, so `polymarket.py` splits any window that reaches that depth. The
downloaded data stays out of git (`/data/` is ignored); `results.json` holds only the summary
numbers.
