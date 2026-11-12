// The paper book: fees, which markets to look at, what to buy, and settling up.
// Plain arithmetic with no model in it; see book.test.mjs.

export const CONFIG = {
  bankroll: 1000, // fake dollars each trader starts with
  minEdge: 0.05, // only buy when the forecast beats price + fee by at least 5¢ a contract
  kelly: 0.25, // bet a quarter of what the Kelly formula says
  maxStake: 50, // never more than $50 on one market
  feeRate: 0.07, // Kalshi's taker fee: 7% × price × (1 − price) per contract
  coinStake: 25, // what the coin-flip trader bets every time
  skipCategories: ['Sports'], // the traders stay out of these
};

const round2 = (x) => Math.round(x * 100) / 100 + 0; // + 0 turns -0 into 0

/** Taker fee in dollars for a whole order, rounded up to the cent as Kalshi does. */
export function fee(contracts, price, mult = 1, rate = CONFIG.feeRate) {
  return Math.ceil(rate * mult * contracts * price * (1 - price) * 100 - 1e-9) / 100;
}

/** Markets worth forecasting: a real two-sided price, not a longshot, some trading behind it. */
export function tradable(m) {
  return m.status === 'active' && m.yesBid > 0 && m.yesAsk < 1 && m.yesAsk - m.yesBid <= 0.08 &&
    m.yesAsk >= 0.06 && m.yesAsk <= 0.94 && m.volume >= 200;
}

/**
 * Pick up to n markets: one per event (the one nearest 50¢), at most two per series, none from
 * the skipped categories, dealt round-robin across the rest by 24h volume.
 */
export function select(markets, categoryOf, n, seen = new Set(), skip = CONFIG.skipCategories) {
  const byEvent = new Map();
  for (const m of markets) {
    if (seen.has(m.ticker) || !tradable(m)) continue;
    const mid = (m.yesBid + m.yesAsk) / 2, cur = byEvent.get(m.eventTicker);
    if (!cur || Math.abs(mid - 0.5) < Math.abs((cur.yesBid + cur.yesAsk) / 2 - 0.5)) byEvent.set(m.eventTicker, m);
  }
  const buckets = new Map();
  for (const m of [...byEvent.values()].sort((a, b) => b.volume24h - a.volume24h)) {
    const c = categoryOf(m.series);
    if (!c || skip.includes(c)) continue;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push({ ...m, category: c });
  }
  const picked = [], perSeries = {}, cats = [...buckets.keys()].sort();
  for (let progressed = true; progressed && picked.length < n;) {
    progressed = false;
    for (const c of cats) {
      if (picked.length >= n) break;
      const q = buckets.get(c);
      while (q.length) {
        const m = q.shift();
        if ((perSeries[m.series] ?? 0) >= 2) continue;
        perSeries[m.series] = (perSeries[m.series] ?? 0) + 1;
        picked.push(m);
        progressed = true;
        break;
      }
    }
  }
  return picked;
}

/** What a forecast of p buys at this quote, or why it buys nothing. */
export function decide({ p, quote, equity, cash, mult = 1, cfg = CONFIG }) {
  const pc = Math.min(0.98, Math.max(0.02, p)); // never trust a model's certainty
  const best = [
    { side: 'yes', win: pc, price: quote.yesAsk, size: quote.yesAskSize },
    { side: 'no', win: 1 - pc, price: quote.noAsk, size: quote.noAskSize },
  ].filter((s) => s.price > 0 && s.price < 1)
    .map((s) => { const unit = s.price + cfg.feeRate * mult * s.price * (1 - s.price); return { ...s, unit, edge: s.win - unit }; })
    .sort((a, b) => b.edge - a.edge)[0];
  if (!best) return { pass: 'nothing on offer' };
  if (best.edge < cfg.minEdge) return { pass: `edge ${(best.edge * 100).toFixed(1)}¢ is under the ${cfg.minEdge * 100}¢ minimum` };
  const stake = Math.min(cfg.maxStake, cfg.kelly * ((best.win - best.unit) / (1 - best.unit)) * equity, cash);
  return fill(best.side, best.price, Math.min(stake / best.unit, best.size), cash, mult, best.edge);
}

/** The control: buys a random side for a fixed stake, whatever the price. */
export function decideCoin({ quote, cash, mult = 1, rand = Math.random, cfg = CONFIG }) {
  const side = rand() < 0.5 ? 'yes' : 'no';
  const price = side === 'yes' ? quote.yesAsk : quote.noAsk, size = side === 'yes' ? quote.yesAskSize : quote.noAskSize;
  if (!(price > 0 && price < 1)) return { pass: 'nothing on offer' };
  return fill(side, price, Math.min(Math.min(cfg.coinStake, cash) / price, size), cash, mult, null);
}

function fill(side, price, wanted, cash, mult, edge) {
  let contracts = Math.floor(wanted + 1e-9);
  while (contracts >= 1 && contracts * price + fee(contracts, price, mult) > cash + 1e-9) contracts--;
  if (contracts < 1) return { pass: 'position would be under one contract' };
  return { side, contracts, price, fee: fee(contracts, price, mult), cost: round2(contracts * price), ...(edge != null && { edge: round2(edge) }) };
}

export const newTrader = (spec, at, cfg = CONFIG) => ({ ...spec, cash: cfg.bankroll, startedAt: at, forecasts: [], history: [] });

/** Cash plus what the open positions would fetch if sold at the bid right now. */
export function equity(trader, markets) {
  let v = trader.cash;
  for (const f of trader.forecasts) {
    if (!f.trade || f.result) continue;
    const q = markets[f.ticker]?.last;
    v += f.trade.contracts * (q ? (f.trade.side === 'yes' ? q.yesBid : q.noBid) : f.trade.price);
  }
  return round2(v);
}

/** Take in fresh quotes: remember prices for marking, and pay out markets that resolved. */
export function settle(ledger, fresh, at) {
  const settled = [];
  for (const [ticker, m] of Object.entries(ledger.markets)) {
    const q = fresh[ticker];
    if (!q || m.result) continue;
    if (q.status === 'active' && q.yesBid > 0) m.last = { yesBid: q.yesBid, yesAsk: q.yesAsk, noBid: q.noBid, noAsk: q.noAsk, at };
    const done = ['finalized', 'settled', 'determined'].includes(q.status);
    if (!done) continue;
    m.result = q.result === 'yes' || q.result === 'no' ? q.result : 'void';
    m.settledAt = at;
    settled.push(ticker);
    for (const t of Object.values(ledger.traders)) {
      for (const f of t.forecasts) {
        if (f.ticker !== ticker || f.result) continue;
        f.result = m.result;
        if (!f.trade) continue;
        // A voided market hands the stake and the fee back.
        f.payout = m.result === 'void' ? round2(f.trade.cost + f.trade.fee) : f.trade.side === m.result ? f.trade.contracts : 0;
        f.pnl = round2(f.payout - f.trade.cost - f.trade.fee);
        t.cash = round2(t.cash + f.payout);
      }
    }
  }
  return settled;
}
