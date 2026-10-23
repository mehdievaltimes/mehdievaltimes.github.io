// Roaree's background thread: downloads and patches the model, runs it, and streams tokens back,
// so the page stays responsive however slow the device is. Messages in: {type: 'load'},
// {type: 'generate', msgs, strength}, {type: 'stop'}. Out: progress, ready, token, done, error.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.bundle.min.mjs';
import { Tokenizer } from 'https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@0.2.0/dist/tokenizers.min.mjs';
import { patchedModel, chatPrompt, generate } from './roaree-core.js';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

const SYSTEM = 'You are a helpful assistant.';
let cfg, hub, tokenizer, session, stopRequested = false;

// The model's bytes, from the browser cache after the first visit so 483 MB isn't fetched again.
async function* modelChunks() {
  const url = hub + cfg.file;
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
  cfg = await fetch('/roaree/steer.json').then((r) => r.json());
  hub = `https://huggingface.co/${cfg.repo}/resolve/${cfg.revision}/`;
  const gpu = !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
  const [tj, tc] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map((f) => fetch(hub + f).then((r) => r.json())));
  tokenizer = new Tokenizer(tj, tc);
  let last = 0;
  const buf = await patchedModel(cfg, modelChunks(), (p) => {
    if (p - last >= 0.01 || p === 1) { last = p; postMessage({ type: 'progress', value: p }); }
  });
  postMessage({ type: 'progress', value: 1, starting: true });
  const onGpu = ['logits', ...Array.from({ length: cfg.layers }, (_, i) => [`present.${i}.key`, `present.${i}.value`]).flat()];
  session = await ort.InferenceSession.create(buf, {
    executionProviders: gpu ? ['webgpu'] : ['wasm'],
    // Keep the KV cache and the full logits on the GPU; only the last row of logits comes back.
    ...(gpu && { preferredOutputLocation: Object.fromEntries(onGpu.map((n) => [n, 'gpu-buffer'])) }),
  });
  postMessage({ type: 'ready', gpu, max: cfg.max });
}

async function run(msgs, strength) {
  stopRequested = false;
  let text = '';
  for await (const t of generate(ort, session, tokenizer, cfg, chatPrompt(SYSTEM, msgs), strength * cfg.max, { stop: () => stopRequested })) {
    text = t;
    postMessage({ type: 'token', text });
  }
  postMessage({ type: 'done', text });
}

onmessage = ({ data }) => {
  const fail = (e) => postMessage({ type: 'error', during: data.type, message: e?.message ?? String(e) });
  if (data.type === 'load') load().catch(fail);
  else if (data.type === 'generate') run(data.msgs, data.strength).catch(fail);
  else if (data.type === 'stop') stopRequested = true;
};
