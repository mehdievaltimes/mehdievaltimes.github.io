#!/usr/bin/env node
// Paper trading on Kalshi: real markets and prices, fake money, no account.
// Usage: npm run trade -- --models claude-opus-5-5,gpt-6-sol,grok-4.7-medium,random [--n 12] [--concurrency 4]
//        npm run trade -- --settle      only pay out resolved markets and re-mark open positions
//   Each model is a trader with its own $1,000 of play money. A round picks n open markets that
//   close within about a week, asks every model for a probability (one fresh run of its agent CLI
//   per market, routed like puppy bench: claude-* -> Claude Code, *grok*/*gemini* -> Cursor, the
//   rest -> Codex; prefix with claude/, codex/ or cursor/ to force a route), then book.mjs decides
//   what that forecast buys at the live ask, fee included. `random` is the control: a coin flip.
//   `house` is our own model (house.mjs): the market's price, corrected; no CLI and no news.
//   Every run first settles whatever has resolved. The ledger is src/data/kalshi-paper.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMarkets, quotes, series } from './kalshi.mjs';
import { parseSpec, traderId, forecast } from './agents.mjs';
import { CONFIG, tradable, select, decide, decideCoin, settle, equity, newTrader } from './book.mjs';
import { houseForecast } from './house.mjs';

const usesCli = (t) => t.provider !== 'random' && t.provider !== 'house';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../src/data/kalshi-paper.json');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const flag = (name) => process.argv.includes(`--${name}`);
const N = Number(arg('n', 12)), CONCURRENCY = Number(arg('concurrency', 4));
const specs = arg('models', '').split(',').filter(Boolean).map(parseSpec);
const settleOnly = flag('settle') || !specs.length;
const now = new Date().toISOString();
const round2 = (x) => Math.round(x * 100) / 100 + 0;

const ledger = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { started: now, config: CONFIG, series: {}, markets: {}, traders: {}, rounds: [] };

// 1. Settle what resolved, and refresh prices on what's still open.
const pending = Object.values(ledger.markets).filter((m) => !m.result).map((m) => m.ticker);
if (pending.length) {
  const settled = settle(ledger, await quotes(pending), now);
  console.log(`settled ${settled.length} of ${pending.length} open markets`);
}

if (!settleOnly) {
  // 2. Choose this round's markets.
  const all = await openMarkets();
  const candidates = all.filter(tradable);
  // Categories and fee multipliers come per series; look up the busiest unknown ones and remember them.
  const volumeBySeries = {};
  for (const m of candidates) volumeBySeries[m.series] = (volumeBySeries[m.series] ?? 0) + m.volume24h;
  const unknown = Object.keys(volumeBySeries).filter((s) => !ledger.series[s]).sort((a, b) => volumeBySeries[b] - volumeBySeries[a]).slice(0, 60);
  for (const s of unknown) {
    try { ledger.series[s] = await series(s); } catch (e) { console.warn(`series ${s}: ${e.message}`); }
  }
  const picked = select(candidates, (s) => ledger.series[s]?.category, N, new Set(Object.keys(ledger.markets)));
  console.log(`${all.length} open markets close within the window, ${candidates.length} tradable, picked ${picked.length}:`);
  for (const m of picked) console.log(`  ${m.category.padEnd(22)} ${Math.round(m.yesBid * 100)}/${Math.round(m.yesAsk * 100)}¢  ${m.title}${m.sub && !m.title.includes(m.sub) ? ` [${m.sub}]` : ''}`);

  // 3. Ask every model about every market.
  const traders = specs.map((s) => (ledger.traders[traderId(s)] ??= newTrader({ id: traderId(s), ...s }, now)));
  const jobs = picked.flatMap((m) => traders.filter(usesCli).map((t) => [t, m]));
  const answers = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const [t, m] = jobs[next++];
      const f = await forecast(t, m);
      answers.set(`${t.id}|${m.ticker}`, f);
      console.log(`${t.id} · ${m.ticker}: ${f.error ? `error (${f.error})` : `${Math.round(f.p * 100)}% ${f.confidence}`}`);
    }
  }));

  // 4. Trade on the forecasts at fresh prices, everyone against the same quote.
  const fresh = picked.length ? await quotes(picked.map((m) => m.ticker)) : {};
  const dead = new Set(traders.filter((t) => usesCli(t) && picked.length && picked.every((m) => answers.get(`${t.id}|${m.ticker}`)?.error)).map((t) => t.id));
  for (const id of dead) console.warn(`${id}: every forecast errored (login? quota?), nothing recorded for it this round`);
  for (const m of picked) {
    const q = fresh[m.ticker] ?? m;
    if (q.status !== 'active' || !(q.yesBid > 0)) continue; // closed while we were thinking
    const mult = ledger.series[m.series]?.feeMultiplier ?? 1;
    ledger.markets[m.ticker] = {
      ticker: m.ticker, eventTicker: m.eventTicker, series: m.series, category: m.category, title: m.title, sub: m.sub,
      rules: m.rules.slice(0, 600), closeTime: m.closeTime, addedAt: now, result: null,
      last: { yesBid: q.yesBid, yesAsk: q.yesAsk, noBid: q.noBid, noAsk: q.noAsk, at: now },
    };
    for (const t of traders) {
      if (dead.has(t.id)) continue;
      const rec = { ticker: m.ticker, at: now, yesBid: q.yesBid, yesAsk: q.yesAsk };
      let d;
      if (t.provider === 'random') {
        d = decideCoin({ quote: q, cash: t.cash, mult });
      } else {
        const f = t.provider === 'house' ? houseForecast({ ...q, category: m.category, closeTime: m.closeTime }) : answers.get(`${t.id}|${m.ticker}`);
        if (f.error) { t.forecasts.push({ ...rec, error: f.error }); continue; }
        Object.assign(rec, { p: f.p, confidence: f.confidence, reasoning: f.reasoning });
        d = decide({ p: f.p, quote: q, equity: equity(t, ledger.markets), cash: t.cash, mult });
      }
      if (d.pass) rec.pass = d.pass;
      else {
        rec.trade = d;
        t.cash = round2(t.cash - d.cost - d.fee);
      }
      t.forecasts.push(rec);
    }
  }
  ledger.rounds.push({ at: now, markets: picked.map((m) => m.ticker), traders: traders.filter((t) => !dead.has(t.id)).map((t) => t.id) });
}

// 5. Mark everyone to market and save.
for (const t of Object.values(ledger.traders)) t.history.push({ at: now, equity: equity(t, ledger.markets), cash: t.cash });
ledger.updated = now;
if (flag('dry-run')) console.log('dry run: ledger not written');
else writeFileSync(OUT, JSON.stringify(ledger, null, 1) + '\n');

console.log('\ntrader                              equity     cash  open  trades');
for (const t of Object.values(ledger.traders)) {
  const trades = t.forecasts.filter((f) => f.trade);
  console.log(`${t.id.padEnd(34)} ${String(equity(t, ledger.markets).toFixed(2)).padStart(8)} ${String(t.cash.toFixed(2)).padStart(8)} ${String(trades.filter((f) => !f.result).length).padStart(5)} ${String(trades.length).padStart(7)}`);
}
