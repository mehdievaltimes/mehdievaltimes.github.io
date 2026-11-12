import test from 'node:test';
import assert from 'node:assert/strict';
import { houseForecast } from './house.mjs';

const mdl = { groups: ['Sports'], terms: { a: -0.1, b: 1.2, 'a[Sports]': 0.05, 'b[Sports]': -0.2, 'a[6h]': 0.02, 'b[6h]': 0.1, 'a[72h]': 0, 'b[72h]': 0 } };
const now = Date.parse('2026-11-10T00:00:00Z');
const m = (category, yesBid, yesAsk, hours) => ({ category, yesBid, yesAsk, closeTime: new Date(now + hours * 3.6e6).toISOString() });
const sig = (z) => 1 / (1 + Math.exp(-z)), logit = (p) => Math.log(p / (1 - p));

test('the house forecast applies the global, category and horizon terms', () => {
  assert.ok(Math.abs(houseForecast(m('Economics', 0.19, 0.21, 24), now, mdl).p - sig(-0.1 + 1.2 * logit(0.2))) < 1e-12);
  assert.ok(Math.abs(houseForecast(m('Sports', 0.19, 0.21, 24), now, mdl).p - sig(-0.05 + 1.0 * logit(0.2))) < 1e-12);
  assert.ok(Math.abs(houseForecast(m('Economics', 0.19, 0.21, 8), now, mdl).p - sig(-0.08 + 1.3 * logit(0.2))) < 1e-12);
});

test('a slope above one pushes longshots down and favourites up', () => {
  assert.ok(houseForecast(m('Economics', 0.09, 0.11, 24), now, mdl).p < 0.1);
  assert.ok(houseForecast(m('Economics', 0.89, 0.91, 24), now, mdl).p > 0.9);
});

test('without a fitted model it says so instead of guessing', () => {
  assert.match(houseForecast(m('Sports', 0.4, 0.42, 24), now, null).error, /train\.py/);
});
