// The house model: Kalshi's own price, corrected for how markets like this one have actually
// resolved. No language model and no news; a handful of numbers fitted by house/train.py.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PATH = fileURLToPath(new URL('./house-model.json', import.meta.url));
export const model = existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null;

/** logit(p) = (a + a_category + a_horizon) + (b + b_category + b_horizon) × logit(mid price). */
export function houseForecast(m, now = Date.now(), mdl = model) {
  if (!mdl) return { error: 'no house-model.json; run scripts/kalshi/house/train.py' };
  const mid = Math.min(0.99, Math.max(0.01, (m.yesBid + m.yesAsk) / 2));
  const t = mdl.terms, g = mdl.groups.includes(m.category) ? m.category : null;
  const hours = (new Date(m.closeTime) - now) / 3.6e6;
  const h = hours < 15 ? '6h' : hours < 48 ? null : '72h'; // the model knows three distances from the close
  const term = (k) => t[k] + (g ? t[`${k}[${g}]`] ?? 0 : 0) + (h ? t[`${k}[${h}]`] ?? 0 : 0);
  const p = 1 / (1 + Math.exp(-(term('a') + term('b') * Math.log(mid / (1 - mid)))));
  return {
    p,
    confidence: 'medium',
    reasoning: `No news read. ${m.category} markets priced near ${Math.round(mid * 100)}¢ this far from the close have resolved YES about ${Math.round(p * 100)}% of the time.`,
  };
}
