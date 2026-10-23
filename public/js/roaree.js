// Roaree: Qwen2.5-0.5B-Instruct with a "Columbia lion" direction added to its residual stream,
// running in the browser. The model comes untouched from Hugging Face; a one-byte rename plus an
// appended ONNX fragment (both built by steer/lab.py into /roaree/steer.json) add a `steer` input
// at one layer, so the slider changes the steering on every forward pass.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.bundle.min.mjs';
import { Tokenizer } from 'https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@0.2.0/dist/tokenizers.min.mjs';
import { patchedModel, chatPrompt, generate } from './roaree-core.js';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

const $ = (id) => document.getElementById(id);
const CFG = await fetch('/roaree/steer.json').then((r) => r.json());
const HUB = `https://huggingface.co/${CFG.repo}/resolve/${CFG.revision}/`;
const SYSTEM = 'You are a helpful assistant.';

let tokenizer, session;
const history = [];
let busy = false, stopRequested = false;

// The model's bytes, from the browser cache after the first visit so 483 MB isn't fetched again.
async function* modelChunks() {
  const url = HUB + CFG.file;
  let cache = null;
  try { cache = await caches.open('roaree-model-v1'); } catch {}
  let res = cache && (await cache.match(url).catch(() => null));
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`the model download failed (HTTP ${res.status})`);
    if (cache) {
      const [keep, read] = res.body.tee();
      cache.put(url, new Response(keep, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
      res = new Response(read);
    }
  }
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

async function load() {
  const btn = $('rr-load');
  const status = (t) => ($('rr-status').textContent = t);
  btn.disabled = true;
  try {
    const gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
    if (!gpu) status('No WebGPU in this browser, so Roaree runs on the CPU: expect a few words a second.');
    const [tj, tc] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map((f) => fetch(HUB + f).then((r) => r.json())));
    tokenizer = new Tokenizer(tj, tc);
    const bar = $('rr-progress');
    bar.hidden = false;
    const buf = await patchedModel(CFG, modelChunks(), (p) => {
      bar.value = p;
      btn.textContent = `Waking Roaree… ${Math.round(p * 100)}%`;
    });
    btn.textContent = 'Starting the model…';
    const onGpu = ['logits', ...Array.from({ length: CFG.layers }, (_, i) => [`present.${i}.key`, `present.${i}.value`]).flat()];
    session = await ort.InferenceSession.create(buf, {
      executionProviders: gpu ? ['webgpu'] : ['wasm'],
      // Keep the KV cache and the full logits on the GPU; only the last row of logits comes back.
      ...(gpu && { preferredOutputLocation: Object.fromEntries(onGpu.map((n) => [n, 'gpu-buffer'])) }),
    });
    $('rr-loader').hidden = true;
    $('rr-chat').hidden = false;
    $('rr-input').focus();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    status(`Couldn't wake Roaree: ${e.message}`);
  }
}

function bubble(role, text) {
  const el = document.createElement('div');
  el.className = `rr-msg rr-${role}`;
  el.textContent = text;
  $('rr-log').append(el);
  el.scrollIntoView({ block: 'nearest' });
  return el;
}

async function send(text) {
  text = text.trim();
  if (!text || busy || !session) return;
  busy = true;
  stopRequested = false;
  $('rr-send').hidden = true;
  $('rr-stop').hidden = false;
  $('rr-input').value = '';
  history.push({ role: 'user', content: text });
  bubble('user', text);
  const el = bubble('assistant', '…');
  el.classList.add('rr-thinking');
  let reply = '';
  try {
    const strength = Number($('rr-strength').value) * CFG.max;
    for await (const partial of generate(ort, session, tokenizer, CFG, chatPrompt(SYSTEM, history.slice(-6)), strength, { stop: () => stopRequested })) {
      reply = partial;
      el.classList.remove('rr-thinking');
      el.textContent = reply;
      el.scrollIntoView({ block: 'nearest' });
    }
  } catch (e) {
    reply = '';
    el.textContent = `(Roaree tripped: ${e.message})`;
  }
  el.classList.remove('rr-thinking');
  if (reply) history.push({ role: 'assistant', content: reply });
  else history.pop();
  busy = false;
  $('rr-send').hidden = false;
  $('rr-stop').hidden = true;
  $('rr-input').focus();
}

function label() {
  const v = Number($('rr-strength').value);
  $('rr-strength-label').textContent = v === 0 ? 'off: the plain model' : v < 0.45 ? 'a little Roaree' : v < 0.8 ? 'Roaree' : 'all Roaree';
}

$('rr-load').addEventListener('click', load);
$('rr-form').addEventListener('submit', (e) => { e.preventDefault(); send($('rr-input').value); });
$('rr-stop').addEventListener('click', () => (stopRequested = true));
$('rr-strength').addEventListener('input', label);
$('rr-reset').addEventListener('click', () => { if (!busy) { history.length = 0; $('rr-log').replaceChildren(); } });
document.querySelectorAll('[data-rr-ask]').forEach((b) => b.addEventListener('click', () => send(b.dataset.rrAsk)));
label();
