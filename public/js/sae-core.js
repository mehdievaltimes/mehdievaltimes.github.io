// The parts of the SAE page that don't touch the DOM: patching the model bytes and generating text.
// `ort` is onnxruntime (web in the browser, node in the steer lab's test), so both run this file.

export const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// The model file plus the fragment, in one buffer. `chunks` yields the downloaded file's bytes.
// The rename: the steered layer's residual output name ends in "0"; the fragment reads it as "s"
// and writes the steered sum under the original name, which every later layer reads.
export async function patchedModel(cfg, chunks, onProgress = () => {}) {
  const fragment = bytes(cfg.fragment);
  const buf = new Uint8Array(cfg.size + fragment.length);
  let n = 0;
  for await (const value of chunks) {
    if (n + value.length > cfg.size) throw new Error('the model file is not the expected size');
    buf.set(value, n);
    n += value.length;
    onProgress(n / cfg.size);
  }
  if (n !== cfg.size) throw new Error('the model download was cut short; try again');
  if (buf[cfg.offset] !== 0x30) throw new Error('the model file is not the version this page expects');
  buf[cfg.offset] = 0x73;
  buf.set(fragment, cfg.size);
  return buf;
}

export const chatPrompt = (system, msgs) =>
  [{ role: 'system', content: system }, ...msgs].map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') +
  '<|im_start|>assistant\n';

// Repetition penalty, then top-k sampling (temperature 0 means greedy, for tests).
export function sample(logits, seen, { temp = 0.7, topK = 40, rep = 1.1, random = Math.random } = {}) {
  for (const t of seen) logits[t] = logits[t] > 0 ? logits[t] / rep : logits[t] * rep;
  if (temp === 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return best;
  }
  const top = [];
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (top.length < topK) {
      top.push([v, i]);
      if (top.length === topK) top.sort((a, b) => a[0] - b[0]);
    } else if (v > top[0][0]) {
      top[0] = [v, i];
      for (let j = 0; j + 1 < topK && top[j][0] > top[j + 1][0]; j++) [top[j], top[j + 1]] = [top[j + 1], top[j]];
    }
  }
  const max = Math.max(...top.map((x) => x[0]));
  const w = top.map(([v]) => Math.exp((v - max) / temp));
  let r = random() * w.reduce((a, b) => a + b, 0);
  for (let j = 0; j < top.length; j++) if ((r -= w[j]) <= 0) return top[j][1];
  return top[top.length - 1][1];
}

// How long the page lets the model talk: at most this many sentences, and never more than maxNew tokens.
export const REPLY = { sentences: 3, maxNew: 100 };

// Where the nth sentence of `text` ends (just past its punctuation, or at a line break), or -1.
// Punctuation counts only when whitespace follows, so "2.5" and a reply still streaming don't end early.
export function sentenceEnd(text, n) {
  const re = /[.!?]+["'”’)\]]*(?=\s)|\n/g;
  let m, last = 0;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (text.slice(last, end).trim() && --n === 0) return m[0] === '\n' ? m.index : end;
    last = end;
  }
  return -1;
}

// Yields the reply decoded so far after every token. Steering adds `unit` (a feature's decoder
// direction, unit length) times `strength` times the layer's typical residual norm; 0 is the plain
// model. With `sentences`, it stops after that many, and a reply cut off by maxNew ends at its last
// complete sentence instead of mid-word.
export async function* generate(ort, session, tokenizer, cfg, prompt, unit, strength, { maxNew = 220, sentences = 0, stop = () => false, sampling } = {}) {
  const int64 = (arr, dims) => new ort.Tensor('int64', BigInt64Array.from(arr, BigInt), dims);
  const steer = new ort.Tensor('float32', unit.map((v) => v * strength * cfg.scale), [cfg.hidden]);
  const presents = Array.from({ length: cfg.layers }, (_, i) => [`present.${i}.key`, `present.${i}.value`]).flat();
  let past = Object.fromEntries(presents.map((p) => [p.replace('present', 'past_key_values'),
    new ort.Tensor('float32', new Float32Array(0), [1, cfg.kvHeads, 0, cfg.headDim])]));
  const ids = tokenizer.encode(prompt, { add_special_tokens: false }).ids;
  let nPast = 0, cur = ids;
  const out = [], seen = new Set(ids);
  let text = '', capped = true;
  try {
    for (let step = 0; step < maxNew; step++) {
      if (stop()) { capped = false; break; }
      const res = await session.run({
        input_ids: int64(cur, [1, cur.length]),
        attention_mask: int64(new Array(nPast + cur.length).fill(1), [1, nPast + cur.length]),
        position_ids: int64(cur.map((_, j) => nPast + j), [1, cur.length]),
        steer,
        ...past,
      }, ['last_logits', ...presents]);
      for (const t of Object.values(past)) t.dispose?.();
      past = Object.fromEntries(presents.map((p) => [p.replace('present', 'past_key_values'), res[p]]));
      nPast += cur.length;
      const next = sample(new Float32Array(res.last_logits.data), seen, sampling);
      if (cfg.eos.includes(next)) { capped = false; break; }
      out.push(next);
      seen.add(next);
      cur = [next];
      text = tokenizer.decode(out, { skip_special_tokens: true });
      const cut = sentences ? sentenceEnd(text, sentences) : -1;
      if (cut >= 0) { yield text.slice(0, cut); return; }
      yield text;
    }
    if (capped && sentences) {
      let cut = -1;
      for (let k = 1, c; (c = sentenceEnd(text, k)) >= 0; k++) cut = c;
      if (cut > 0) yield text.slice(0, cut);
    }
  } finally {
    for (const t of Object.values(past)) t.dispose?.();
  }
}
