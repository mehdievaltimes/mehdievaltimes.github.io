// node --test scripts/kalshi/
import test from 'node:test';
import assert from 'node:assert/strict';
import { fee, decide, decideCoin, select, settle, equity, newTrader, CONFIG } from './book.mjs';

const q = (yesBid, yesAsk, extra = {}) => ({ yesBid, yesAsk, noBid: +(1 - yesAsk).toFixed(2), noAsk: +(1 - yesBid).toFixed(2), yesAskSize: 1000, noAskSize: 1000, ...extra });

test('fee matches Kalshi’s published examples', () => {
  assert.equal(fee(100, 0.5), 1.75); // 100 contracts at 50¢
  assert.equal(fee(1, 0.5), 0.02); // 1.75¢ rounds up to 2¢
  assert.equal(fee(10, 0.9), 0.07); // 6.3¢ rounds up
  assert.equal(fee(100, 0.5, 0.5), 0.88); // a series with a half multiplier
});

test('decide passes when the edge is thin, and buys the right side when it is not', () => {
  assert.match(decide({ p: 0.55, quote: q(0.5, 0.52), equity: 1000, cash: 1000 }).pass, /under the 5¢ minimum/);
  const yes = decide({ p: 0.7, quote: q(0.5, 0.52), equity: 1000, cash: 1000 });
  assert.equal(yes.side, 'yes');
  assert.equal(yes.price, 0.52);
  const no = decide({ p: 0.2, quote: q(0.5, 0.52), equity: 1000, cash: 1000 });
  assert.equal(no.side, 'no');
  assert.equal(no.price, 0.5);
});

test('decide respects the stake cap, the book size and the cash on hand', () => {
  const capped = decide({ p: 0.95, quote: q(0.3, 0.32), equity: 1000, cash: 1000 });
  assert.ok(capped.cost + capped.fee <= CONFIG.maxStake + 0.01, 'stake cap');
  const thin = decide({ p: 0.95, quote: q(0.3, 0.32, { yesAskSize: 7 }), equity: 1000, cash: 1000 });
  assert.equal(thin.contracts, 7);
  const broke = decide({ p: 0.95, quote: q(0.3, 0.32), equity: 1000, cash: 3 });
  assert.ok(broke.cost + broke.fee <= 3);
  assert.match(decide({ p: 0.95, quote: q(0.3, 0.32), equity: 1000, cash: 0.2 }).pass, /under one contract/);
});

test('a model that claims certainty is clamped', () => {
  const sure = decide({ p: 1, quote: q(0.9, 0.92), equity: 1000, cash: 1000 });
  assert.ok(sure.pass || sure.edge <= 0.98 - 0.92);
});

test('the coin-flip trader buys either side for a fixed stake', () => {
  const a = decideCoin({ quote: q(0.4, 0.42), cash: 1000, rand: () => 0.1 });
  const b = decideCoin({ quote: q(0.4, 0.42), cash: 1000, rand: () => 0.9 });
  assert.deepEqual([a.side, b.side], ['yes', 'no']);
  assert.equal(a.contracts, Math.floor(25 / 0.42));
});

test('select spreads a round across events, series and categories', () => {
  const mk = (ticker, eventTicker, series, yesBid, volume24h) => ({ ticker, eventTicker, series, status: 'active', yesBid, yesAsk: yesBid + 0.02, volume: 5000, volume24h });
  const markets = [
    ...Array.from({ length: 8 }, (_, i) => mk(`NFL-${i}`, `NFLE-${i}`, 'NFL', 0.5, 9000 - i)),
    mk('ECON-A1', 'ECON-A', 'ECON', 0.2, 50), mk('ECON-A2', 'ECON-A', 'ECON', 0.48, 40), // same event: keep the one near 50¢
    mk('WX-1', 'WX-1', 'WX', 0.6, 30), mk('WX-2', 'WX-2', 'WX', 0.6, 20), mk('WX-3', 'WX-3', 'WX', 0.6, 10),
    mk('LONG-1', 'LONG-1', 'ECON', 0.01, 99999), // a longshot: not tradable
  ];
  const cat = (s) => ({ NFL: 'Sports', ECON: 'Economics', WX: 'Climate and Weather' })[s];
  const picked = select(markets, cat, 8).map((m) => m.ticker);
  assert.ok(picked.includes('ECON-A2') && !picked.includes('ECON-A1') && !picked.includes('LONG-1'));
  assert.equal(picked.filter((t) => t.startsWith('WX')).length, 2, 'two per series');
  assert.ok(!select(markets, cat, 8, new Set(['ECON-A2'])).some((m) => m.ticker === 'ECON-A2'), 'seen markets are skipped');
});

test('the traders stay out of sports, even when that leaves the round short', () => {
  const mk = (ticker, series, volume24h) => ({ ticker, eventTicker: ticker, series, status: 'active', yesBid: 0.5, yesAsk: 0.52, volume: 5000, volume24h });
  const markets = [...Array.from({ length: 8 }, (_, i) => mk(`NFL-${i}`, 'NFL', 9000 - i)), mk('ECON-1', 'ECON', 40), mk('WX-1', 'WX', 30)];
  const cat = (s) => ({ NFL: 'Sports', ECON: 'Economics', WX: 'Climate and Weather' })[s];
  assert.deepEqual(select(markets, cat, 8).map((m) => m.ticker).sort(), ['ECON-1', 'WX-1']);
  // The rule is a setting, not hard-wired: with nothing skipped, sports come back under the two-per-series cap.
  assert.equal(select(markets, cat, 8, new Set(), []).filter((m) => m.ticker.startsWith('NFL')).length, 2);
});

test('settling pays winners, zeroes losers, refunds voids, and equity adds up', () => {
  const t = newTrader({ id: 't', provider: 'claude', model: 'm' }, 'now');
  const buy = (ticker, side, contracts, price) => { const f = fee(contracts, price); t.cash = +(t.cash - contracts * price - f).toFixed(2); t.forecasts.push({ ticker, p: 0.6, trade: { side, contracts, price, fee: f, cost: contracts * price } }); };
  buy('WIN', 'yes', 50, 0.5); buy('LOSE', 'no', 40, 0.25); buy('VOID', 'yes', 10, 0.5); buy('OPEN', 'yes', 10, 0.5);
  t.forecasts.push({ ticker: 'WIN', p: 0.3 }); // a pass still gets the result, for scoring
  const ledger = { markets: Object.fromEntries(['WIN', 'LOSE', 'VOID', 'OPEN'].map((k) => [k, { ticker: k }])), traders: { t } };
  const before = t.cash;
  const done = settle(ledger, {
    WIN: { status: 'finalized', result: 'yes' }, LOSE: { status: 'finalized', result: 'yes' },
    VOID: { status: 'finalized', result: '' }, OPEN: { status: 'active', yesBid: 0.6, yesAsk: 0.62, noBid: 0.38, noAsk: 0.4 },
  }, 'later');
  assert.deepEqual(done.sort(), ['LOSE', 'VOID', 'WIN']);
  const [win, lose, voided, open, passed] = t.forecasts;
  assert.equal(win.pnl, +(50 - 25 - fee(50, 0.5)).toFixed(2));
  assert.equal(lose.pnl, +(-10 - fee(40, 0.25)).toFixed(2));
  assert.equal(voided.pnl, 0);
  assert.equal(passed.result, 'yes');
  assert.equal(open.result, undefined);
  assert.equal(t.cash, +(before + 50 + 0 + 5 + fee(10, 0.5)).toFixed(2));
  assert.equal(equity(t, ledger.markets), +(t.cash + 10 * 0.6).toFixed(2)); // the open position marked at its bid
});
