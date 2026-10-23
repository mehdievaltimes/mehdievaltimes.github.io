// Runs the page's own core (public/js/roaree-core.js) against the real model with onnxruntime-node:
// same download, same byte patch, same generation loop, same tokenizer package as the browser.
// Usage: node steer/node-test.mjs <steer.json>
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import { patchedModel, chatPrompt, generate } from '../public/js/roaree-core.js';

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

const prompts = ['Tell me about yourself in two sentences.', "What's 2+2?", 'What should I eat for dinner tonight?'];
for (const slider of [0, 0.5, 0.75, 1]) {
  for (const p of prompts) {
    let text = '';
    for await (const t of generate(ort, session, tokenizer, cfg, chatPrompt('You are a helpful assistant.', [{ role: 'user', content: p }]), slider * cfg.max, { maxNew: 70, sampling: { temp: 0 } })) text = t;
    console.log(`slider ${slider}: ${p.padEnd(42)} -> ${text.replace(/\n/g, ' / ')}`);
  }
}
// And once with the page's real sampling settings, to see what visitors will get.
for (const p of prompts) {
  let text = '';
  for await (const t of generate(ort, session, tokenizer, cfg, chatPrompt('You are a helpful assistant.', [{ role: 'user', content: p }]), cfg.max * cfg.default, { maxNew: 90 })) text = t;
  console.log(`sampled @ default: ${p.padEnd(42)} -> ${text.replace(/\n/g, ' / ')}`);
}
