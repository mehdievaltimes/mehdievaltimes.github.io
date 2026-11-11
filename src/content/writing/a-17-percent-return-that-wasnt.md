---
title: "A 17% return that wasn't"
date: 2026-11-11
tags: [prediction-markets, evals]
draft: true
---

This week a backtest told me that a tiny model could make 17 to 20% on its money trading Kalshi, on data it had never seen, with error bars nowhere near zero. It was wrong. This is what the number was, how we caught it, and what turned out to be true.

A note on "we": I'm building this with Claude Code, which wrote most of the code and ran these tests with me.

## The setup

I run a small [paper-trading page](/trading) where language models trade real Kalshi markets with fake money. I wanted a trader of our own next to them, and the simplest idea is to not predict anything. Take the market's price and correct it for how markets like it have actually resolved:

$$\text{logit}(p) = a + b \cdot \text{logit}(\text{price})$$

with extra terms for the category and for how far the market is from closing. If $b$ is above 1, prices are too timid: favourites win more often than they cost and longshots less. That is the favourite-longshot bias, and a [2025 study of Kalshi](https://cepr.org/voxeu/columns/economics-kalshi-prediction-market) found a strong one: buyers of contracts under 10¢ lost over 60% of their money.

Kalshi's public API gives hourly bid and ask history for settled markets, so the training set is free. For each market we took the price 6, 24 and 72 hours before it closed, fitted the model on the older closes, and tested it on the later ones, both as a forecast and as a trader paying the real spread and Kalshi's fee.

## The result that was too good

Busy markets showed nothing. So we tried thin ones, markets where fewer than 200 contracts ever traded, on the theory that nobody bothers to keep those prices fresh.

The prices looked terrible. Contracts priced near 46¢ paid out 19% of the time. Near 14¢, 2.5%. On the held-out period the model made 19.5% on its stakes across 1,047 trades, with a 95% interval of +\$8,253 to +\$11,906 on \$51,560 staked. A coin-flip trader lost a third of its stakes in the same markets.

We didn't believe it. Kalshi has professional market makers now, and they do not leave 17% lying around in thousands of markets. The simulation was also buying up to 90 contracts in some markets where fewer than 50 ever changed hands.

## The leak

"Fewer than 200 contracts ever traded" is a fact about a market's whole life. Nobody knows it a day before the close. And it depends on the outcome: a longshot that comes alive during the game gets traded heavily, and one that dies quietly does not.

Here is how often YES happened in sports markets, by the price a day before the close and by the market's final volume:

| Price a day before | 0 traded | 1–49 | 50–199 | 200–999 | 1k–10k | 10k+ |
|---|---:|---:|---:|---:|---:|---:|
| 15–30¢ | 3.9% | 1.7% | 5.9% | 9.3% | 17.3% | 27.6% |
| 45–55¢ | 6.9% | 8.1% | 33.3% | 40.7% | 50.4% | 50.7% |

Same price, wildly different outcomes, sorted by a number you can only read afterwards. Picking the low-volume columns is picking the markets where YES mostly didn't happen. The model had learned to bet NO on markets I had already selected for resolving NO.

Our first test, on busy markets, had the same flaw in a milder form: it kept only markets with a final volume of 200 or more.

## The clean test

We rebuilt the data with nothing chosen by final volume: 68,932 snapshots from 29,223 markets in 183 series that closed between September 12 and November 10. About 93% are sports. For thinness we used what was known at the time, the open interest at the snapshot.

| Price a day before | Paid out | Snapshots |
|---|---:|---:|
| 5.5¢ | 4.5% | 4,369 |
| 14.6¢ | 13.4% | 3,664 |
| 26.7¢ | 26.2% | 5,318 |
| 42.3¢ | 43.5% | 3,982 |
| 56.7¢ | 56.7% | 3,026 |
| 72.1¢ | 70.5% | 1,791 |
| 84.6¢ | 88.0% | 982 |
| 94.6¢ | 95.6% | 1,024 |

The prices are right. The fitted slope is 1.045, only a trace of the favourite-longshot bias. (The 2025 study covered other years and markets, and measured what buyers actually paid, so the two aren't directly comparable.) On the held-out period the model never found the 5¢ edge after fees that our rules require, so it made no trades, and its forecasts scored the same as the raw price (0.1568 against 0.1569; lower is better).

Thin markets are no different. 63% of snapshots had open interest under 200 at the time, and they are just as well priced. Only 5% came from markets that finished with under 200 contracts traded. Most of a market's volume arrives late, which is exactly why final volume says so much about how it ended.

The one real number: a trader who knows nothing loses 9 to 13% of its stakes to the spread and fees. That is the bar anything has to clear.

## What I take from it

- **A filter can leak the answer.** Volume looked like a harmless description of a market. It was a measurement taken after the outcome.
- **When a result is too good, look for the leak before anything else.** The check took one table.
- **Use only what was known at the time**, for features and for choosing what to test on.

## Limits

This is two months of data, mostly sports, from one exchange. The history has no order sizes, so a backtest can't say how much could really have been bought. The one hint left over is that favourites priced 80 to 90¢ won 87 to 89% of the time at all three horizons. That is one or two cents after fees and could be noise.

Prices alone don't beat this market. Whether reading the news does is what the [live page](/trading) is testing. The code is in [scripts/kalshi/house](https://github.com/mehdievaltimes/mehdievaltimes.github.io/tree/main/scripts/kalshi/house).
