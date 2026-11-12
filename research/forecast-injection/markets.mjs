#!/usr/bin/env node
// Picks the markets for the injection test: open, non-sports Kalshi markets priced between
// 25 and 75 cents, so a forecast has room to move either way. Same selection the paper
// traders use (scripts/kalshi/book.mjs), on a wider pool.
// Usage: node research/forecast-injection/markets.mjs [how many] > data/injection/markets.json
import { readFileSync } from 'node:fs';
import { openMarkets, series } from '../../scripts/kalshi/kalshi.mjs';
import { tradable, select } from '../../scripts/kalshi/book.mjs';

const n = Number(process.argv[2] ?? 12);
const ledger = JSON.parse(readFileSync(new URL('../../src/data/kalshi-paper.json', import.meta.url), 'utf8'));
const known = { ...ledger.series };
const pool = (await openMarkets()).filter((m) => tradable(m) && m.yesBid >= 0.25 && m.yesAsk <= 0.75);
for (const s of new Set(pool.map((m) => m.series))) {
  if (!known[s]) try { known[s] = await series(s); } catch {}
}
const picked = select(pool, (s) => known[s]?.category, n);
console.log(JSON.stringify(picked.map((m) => ({
  ticker: m.ticker, category: m.category, title: m.title, sub: m.sub, rules: m.rules.slice(0, 1800), closeTime: m.closeTime,
  yesBid: m.yesBid, yesAsk: m.yesAsk, noBid: m.noBid, noAsk: m.noAsk,
})), null, 1));
