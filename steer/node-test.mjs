// Runs the page's own core (public/js/sae-core.js) against the real model with onnxruntime-node:
// same download, same byte patch, same generation loop, same tokenizer package as the browser.
// Usage: node steer/node-test.mjs <steer.json>
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import { bytes, patchedModel, chatPrompt, generate, sentenceEnd, REPLY } from '../public/js/sae-core.js';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const hub = `https://huggingface.co/${cfg.repo}/resolve/${cfg.revision}/`;
const [tj, tc] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map((f) => fetch(hub + f).then((r) => r.json())));
const tokenizer = new Tokenizer(tj, tc);

// The tokenizer must agree with the Python one the direction was computed with.
const ids = tokenizer.encode(cfg.check.text, { add_special_tokens: false }).ids;
const same = JSON.stringify(ids) === JSON.stringify(cfg.check.ids);
console.log(`tokenizer matches python: ${same}${same ? '' : `\n  js ${JSON.stringify(ids)}\n  py ${JSON.stringify(cfg.check.ids)}`}`);

const res = await fetch(hub + cfg.file);
const t0 = Date.now();
const buf = await patchedModel(cfg, res.body);
console.log(`downloaded and patched ${buf.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const session = await ort.InferenceSession.create(buf);

// The sentence splitter the page stops on.
const cases = [['Hi. I am Roaree! Roar', 1, 3], ['It is 2.5 tall. Yes', 1, 15], ['Title\n\nI roar. Again.', 2, 14], ['Roar roar roar', 1, -1], ['A. B. C. D.', 3, 8]];
const bad = cases.filter(([s, n, want]) => sentenceEnd(s, n) !== want);
console.log(`sentence splitter: ${bad.length ? `FAILED ${JSON.stringify(bad)}` : 'ok'}`);
if (bad.length) process.exit(1);

const prompts = ['Tell me about yourself in two sentences.', "What's 2+2?"];
const say = async (unit, strength, p, opts) => {
  let text = '';
  for await (const t of generate(ort, session, tokenizer, cfg, chatPrompt('You are a helpful assistant.', [{ role: 'user', content: p }]), unit, strength, opts)) text = t;
  return text.replace(/\n/g, ' / ');
};
const zero = new Float32Array(cfg.hidden);
for (const p of prompts) console.log(`plain model: ${p.padEnd(42)} -> ${await say(zero, 0, p, { maxNew: 50, sampling: { temp: 0 } })}`);
// Each feature at its default strength, greedy and then with the page's real sampling and reply length.
for (const f of cfg.features) {
  const unit = new Float32Array(bytes(f.unit).buffer);
  for (const p of prompts) {
    console.log(`#${f.id} ${f.label} @ ${f.default}: ${p.padEnd(42)} -> ${await say(unit, f.default * cfg.max, p, { maxNew: 50, sampling: { temp: 0 } })}`);
  }
  console.log(`#${f.id} ${f.label} sampled: ${prompts[0].padEnd(42)} -> ${await say(unit, f.default * cfg.max, prompts[0], REPLY)}`);
}
