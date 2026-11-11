---
title: "A 17% return that wasn't"
date: 2026-11-11
tags: [prediction-markets, evals]
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

Here are both versions on one chart.

<style>
.cal { --s1: #3987e5; --s2: #d95926; position: relative; margin: 2rem 0; font-family: var(--sans); }
:root[data-theme='light'] .cal { --s1: #3d68c9; --s2: #eb6834; }
.cal-legend { display: flex; flex-wrap: wrap; gap: .3rem 1.2rem; margin: 0 0 .7rem; font-size: .85rem; line-height: 1.4; color: var(--fg); }
.cal-legend span { display: inline-flex; align-items: center; gap: .45rem; }
.cal-key { width: .65rem; height: .65rem; border-radius: 50%; flex: none; }
.cal-key.rule { width: 1.2rem; height: 0; border-radius: 0; border-top: 1px solid var(--muted); }
.cal svg { display: block; width: 100%; height: auto; overflow: visible; }
.cal text { font: 14px var(--sans); fill: var(--muted); font-variant-numeric: tabular-nums; }
.cal text.lbl { fill: var(--fg); }
.cal .grid { stroke: var(--faint); stroke-width: 1; vector-effect: non-scaling-stroke; }
.cal .diag { stroke: var(--muted); stroke-width: 1; vector-effect: non-scaling-stroke; }
.cal .ln { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cal .dot { stroke: var(--bg); stroke-width: 2; }
.cal-pt { outline: none; }
.cal-pt:hover .dot, .cal-pt:focus .dot { stroke: var(--fg); }
.cal-tip { position: absolute; z-index: 2; max-width: 15rem; padding: .35rem .6rem; border-radius: 6px; border: 1px solid var(--faint); background: var(--card); color: var(--fg); font-size: .8rem; line-height: 1.4; pointer-events: none; }
.cal figcaption { margin-top: .6rem; }
.cal-nums { margin: 0 0 1.1rem; }
.cal-nums summary { cursor: pointer; }
</style>
<figure class="cal">
<div class="cal-legend"><span><i class="cal-key" style="background:var(--s1)"></i>All markets, nothing chosen by final volume</span><span><i class="cal-key" style="background:var(--s2)"></i>Markets chosen by final volume under 200</span><span><i class="cal-key rule"></i>Price equals outcome</span></div>
<svg viewBox="0 0 520 480" role="group" aria-label="How often contracts paid out, against their price a day before the close. All markets sit on the diagonal. Markets chosen by final volume fall far below it.">
<line class="grid" x1="48.0" y1="428.0" x2="48.0" y2="28.0"/><line class="grid" x1="48.0" y1="428.0" x2="506.0" y2="428.0"/>
<text x="48.0" y="448.0" text-anchor="start">0¢</text><text x="40" y="433.0" text-anchor="end">0%</text>
<line class="grid" x1="162.5" y1="428.0" x2="162.5" y2="28.0"/><line class="grid" x1="48.0" y1="328.0" x2="506.0" y2="328.0"/>
<text x="162.5" y="448.0" text-anchor="middle">25¢</text><text x="40" y="333.0" text-anchor="end">25%</text>
<line class="grid" x1="277.0" y1="428.0" x2="277.0" y2="28.0"/><line class="grid" x1="48.0" y1="228.0" x2="506.0" y2="228.0"/>
<text x="277.0" y="448.0" text-anchor="middle">50¢</text><text x="40" y="233.0" text-anchor="end">50%</text>
<line class="grid" x1="391.5" y1="428.0" x2="391.5" y2="28.0"/><line class="grid" x1="48.0" y1="128.0" x2="506.0" y2="128.0"/>
<text x="391.5" y="448.0" text-anchor="middle">75¢</text><text x="40" y="133.0" text-anchor="end">75%</text>
<line class="grid" x1="506.0" y1="428.0" x2="506.0" y2="28.0"/><line class="grid" x1="48.0" y1="28.0" x2="506.0" y2="28.0"/>
<text x="506.0" y="448.0" text-anchor="end">100¢</text><text x="40" y="33.0" text-anchor="end">100%</text>
<text x="48" y="16">Share that paid out</text><text x="277.0" y="472" text-anchor="middle">Price a day before the close</text>
<line class="diag" x1="48.0" y1="428.0" x2="506.0" y2="28.0"/>
<polyline class="ln" style="stroke:var(--s2)" points="74.6,424.0 111.7,418.0 160.7,408.8 203.7,388.8 259.6,350.4 289.8,288.8 343.4,224.8 390.1,150.0 438.2,61.2 475.8,44.4"/>
<polyline class="ln" style="stroke:var(--s1)" points="73.2,410.0 114.9,374.4 161.6,331.6 207.4,285.6 253.2,244.0 298.1,208.0 343.4,175.6 390.6,134.0 435.5,76.0 481.3,45.6"/>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 5.8¢, paid out 1.0% (2,126 snapshots)"><title>Chosen by final volume under 200: priced 5.8¢, paid out 1.0% (2,126 snapshots)</title><circle cx="74.6" cy="424.0" r="17" fill="transparent"/><circle class="dot" cx="74.6" cy="424.0" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 13.9¢, paid out 2.5% (1,774 snapshots)"><title>Chosen by final volume under 200: priced 13.9¢, paid out 2.5% (1,774 snapshots)</title><circle cx="111.7" cy="418.0" r="17" fill="transparent"/><circle class="dot" cx="111.7" cy="418.0" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 24.6¢, paid out 4.8% (748 snapshots)"><title>Chosen by final volume under 200: priced 24.6¢, paid out 4.8% (748 snapshots)</title><circle cx="160.7" cy="408.8" r="17" fill="transparent"/><circle class="dot" cx="160.7" cy="408.8" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 34.0¢, paid out 9.8% (539 snapshots)"><title>Chosen by final volume under 200: priced 34.0¢, paid out 9.8% (539 snapshots)</title><circle cx="203.7" cy="388.8" r="17" fill="transparent"/><circle class="dot" cx="203.7" cy="388.8" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 46.2¢, paid out 19.4% (434 snapshots)"><title>Chosen by final volume under 200: priced 46.2¢, paid out 19.4% (434 snapshots)</title><circle cx="259.6" cy="350.4" r="17" fill="transparent"/><circle class="dot" cx="259.6" cy="350.4" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 52.8¢, paid out 34.8% (319 snapshots)"><title>Chosen by final volume under 200: priced 52.8¢, paid out 34.8% (319 snapshots)</title><circle cx="289.8" cy="288.8" r="17" fill="transparent"/><circle class="dot" cx="289.8" cy="288.8" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 64.5¢, paid out 50.8% (197 snapshots)"><title>Chosen by final volume under 200: priced 64.5¢, paid out 50.8% (197 snapshots)</title><circle cx="343.4" cy="224.8" r="17" fill="transparent"/><circle class="dot" cx="343.4" cy="224.8" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 74.7¢, paid out 69.5% (187 snapshots)"><title>Chosen by final volume under 200: priced 74.7¢, paid out 69.5% (187 snapshots)</title><circle cx="390.1" cy="150.0" r="17" fill="transparent"/><circle class="dot" cx="390.1" cy="150.0" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 85.2¢, paid out 91.7% (300 snapshots)"><title>Chosen by final volume under 200: priced 85.2¢, paid out 91.7% (300 snapshots)</title><circle cx="438.2" cy="61.2" r="17" fill="transparent"/><circle class="dot" cx="438.2" cy="61.2" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="Chosen by final volume under 200: priced 93.4¢, paid out 95.9% (217 snapshots)"><title>Chosen by final volume under 200: priced 93.4¢, paid out 95.9% (217 snapshots)</title><circle cx="475.8" cy="44.4" r="17" fill="transparent"/><circle class="dot" cx="475.8" cy="44.4" r="4.5" style="fill:var(--s2)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 5.5¢, paid out 4.5% (4,369 snapshots)"><title>All markets: priced 5.5¢, paid out 4.5% (4,369 snapshots)</title><circle cx="73.2" cy="410.0" r="17" fill="transparent"/><circle class="dot" cx="73.2" cy="410.0" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 14.6¢, paid out 13.4% (3,664 snapshots)"><title>All markets: priced 14.6¢, paid out 13.4% (3,664 snapshots)</title><circle cx="114.9" cy="374.4" r="17" fill="transparent"/><circle class="dot" cx="114.9" cy="374.4" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 24.8¢, paid out 24.1% (3,973 snapshots)"><title>All markets: priced 24.8¢, paid out 24.1% (3,973 snapshots)</title><circle cx="161.6" cy="331.6" r="17" fill="transparent"/><circle class="dot" cx="161.6" cy="331.6" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 34.8¢, paid out 35.6% (2,701 snapshots)"><title>All markets: priced 34.8¢, paid out 35.6% (2,701 snapshots)</title><circle cx="207.4" cy="285.6" r="17" fill="transparent"/><circle class="dot" cx="207.4" cy="285.6" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 44.8¢, paid out 46.0% (2,626 snapshots)"><title>All markets: priced 44.8¢, paid out 46.0% (2,626 snapshots)</title><circle cx="253.2" cy="244.0" r="17" fill="transparent"/><circle class="dot" cx="253.2" cy="244.0" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 54.6¢, paid out 55.0% (2,194 snapshots)"><title>All markets: priced 54.6¢, paid out 55.0% (2,194 snapshots)</title><circle cx="298.1" cy="208.0" r="17" fill="transparent"/><circle class="dot" cx="298.1" cy="208.0" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 64.5¢, paid out 63.1% (1,484 snapshots)"><title>All markets: priced 64.5¢, paid out 63.1% (1,484 snapshots)</title><circle cx="343.4" cy="175.6" r="17" fill="transparent"/><circle class="dot" cx="343.4" cy="175.6" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 74.8¢, paid out 73.5% (1,139 snapshots)"><title>All markets: priced 74.8¢, paid out 73.5% (1,139 snapshots)</title><circle cx="390.6" cy="134.0" r="17" fill="transparent"/><circle class="dot" cx="390.6" cy="134.0" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 84.6¢, paid out 88.0% (982 snapshots)"><title>All markets: priced 84.6¢, paid out 88.0% (982 snapshots)</title><circle cx="435.5" cy="76.0" r="17" fill="transparent"/><circle class="dot" cx="435.5" cy="76.0" r="4.5" style="fill:var(--s1)"/></g>
<g class="cal-pt" tabindex="0" role="img" aria-label="All markets: priced 94.6¢, paid out 95.6% (1,024 snapshots)"><title>All markets: priced 94.6¢, paid out 95.6% (1,024 snapshots)</title><circle cx="481.3" cy="45.6" r="17" fill="transparent"/><circle class="dot" cx="481.3" cy="45.6" r="4.5" style="fill:var(--s1)"/></g>
<text class="lbl" x="190.0" y="264.0" text-anchor="end">All markets</text>
<text class="lbl" x="272.6" y="356.4">Chosen by final volume under 200</text>
<text x="272.6" y="374.4">46¢ contracts paid out 19%</text>
</svg>
<div class="cal-tip" hidden></div>
<figcaption class="meta">Each dot is a ten-cent price band, a day before the close. On the diagonal, a contract priced at 30¢ pays out 30% of the time.</figcaption>
<script>
(() => {
  const fig = document.currentScript.parentElement, tip = fig.querySelector('.cal-tip');
  const show = (g) => {
    tip.textContent = g.getAttribute('aria-label');
    tip.hidden = false;
    const d = g.querySelector('.dot').getBoundingClientRect(), f = fig.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(f.width - w, d.left + d.width / 2 - f.left - w / 2)) + 'px';
    tip.style.top = d.top - f.top - tip.offsetHeight - 8 + 'px';
  };
  const hide = () => { tip.hidden = true; };
  for (const g of fig.querySelectorAll('.cal-pt')) {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('pointerleave', hide);
    g.addEventListener('blur', hide);
  }
})();
</script>
</figure>
<details class="cal-nums">
<summary class="meta">the numbers behind the chart</summary>

| Price band | All markets: price | paid out | snapshots | Chosen by final volume: price | paid out | snapshots |
|---|---:|---:|---:|---:|---:|---:|
| 0–10¢ | 5.5¢ | 4.5% | 4,369 | 5.8¢ | 1.0% | 2,126 |
| 10–20¢ | 14.6¢ | 13.4% | 3,664 | 13.9¢ | 2.5% | 1,774 |
| 20–30¢ | 24.8¢ | 24.1% | 3,973 | 24.6¢ | 4.8% | 748 |
| 30–40¢ | 34.8¢ | 35.6% | 2,701 | 34.0¢ | 9.8% | 539 |
| 40–50¢ | 44.8¢ | 46.0% | 2,626 | 46.2¢ | 19.4% | 434 |
| 50–60¢ | 54.6¢ | 55.0% | 2,194 | 52.8¢ | 34.8% | 319 |
| 60–70¢ | 64.5¢ | 63.1% | 1,484 | 64.5¢ | 50.8% | 197 |
| 70–80¢ | 74.8¢ | 73.5% | 1,139 | 74.7¢ | 69.5% | 187 |
| 80–90¢ | 84.6¢ | 88.0% | 982 | 85.2¢ | 91.7% | 300 |
| 90–100¢ | 94.6¢ | 95.6% | 1,024 | 93.4¢ | 95.9% | 217 |

</details>

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
