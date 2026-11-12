// Kalshi's public market data: no account, no API key. Read-only by construction;
// nothing in this folder can place a real order.
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0;
/** GET with spacing between calls and backoff on 429 (the unauthenticated limit is tight). */
export async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(BASE + path, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) { await sleep(2500 * (attempt + 1)); continue; }
    throw new Error(`Kalshi ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }
}

const num = (v) => Number(v ?? 0);
/** The fields the trader uses, as numbers in dollars. */
export function quote(m) {
  return {
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    series: m.event_ticker.split('-')[0],
    title: m.title,
    sub: m.yes_sub_title || '',
    rules: [m.rules_primary, m.rules_secondary].map((s) => (s || '').trim()).filter(Boolean).join(' '),
    closeTime: m.close_time,
    status: m.status,
    result: m.result || null,
    yesBid: num(m.yes_bid_dollars), yesAsk: num(m.yes_ask_dollars),
    noBid: num(m.no_bid_dollars), noAsk: num(m.no_ask_dollars),
    // Buying NO lifts the NO ask, which is the YES bid seen from the other side, so its size is the YES bid's.
    yesAskSize: num(m.yes_ask_size_fp), noAskSize: num(m.yes_bid_size_fp),
    volume: num(m.volume_fp), volume24h: num(m.volume_24h_fp),
  };
}

/** Every open single-outcome market that closes between `minHours` and `maxDays` from now. */
export async function openMarkets({ minHours = 6, maxDays = 8, maxPages = 25 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const d = await get(`/markets?status=open&limit=1000&mve_filter=exclude&min_close_ts=${now + minHours * 3600}&max_close_ts=${now + maxDays * 86400}${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...d.markets.map(quote));
    cursor = d.cursor;
    if (!cursor || !d.markets.length) break;
  }
  return out;
}

/** Fresh quotes (and results, once settled) for specific tickers. */
export async function quotes(tickers) {
  const out = {};
  for (let i = 0; i < tickers.length; i += 20) {
    const d = await get(`/markets?tickers=${tickers.slice(i, i + 20).join(',')}`);
    for (const m of d.markets) out[m.ticker] = quote(m);
  }
  return out;
}

/** A series' category and fee multiplier (1 = the standard 7% taker formula). */
export async function series(ticker) {
  const { series: s } = await get(`/series/${ticker}`);
  return { category: s.category || 'Other', feeMultiplier: s.fee_type === 'quadratic' ? Number(s.fee_multiplier ?? 1) : 1, title: s.title };
}
