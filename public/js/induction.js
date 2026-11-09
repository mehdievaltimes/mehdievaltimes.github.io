// The induction-head demo on /demos: a two-layer, attention-only transformer run in plain JS.
// Weights come from scripts/induction/train.py. Nothing here is canned: every attention
// weight, every head's label and every prediction is computed from those weights in the browser.
(() => {
  const root = document.getElementById('induction');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);

  let M; // model: config + Float32Array weights
  let keep; // keep[l][h] = false when a head is knocked out
  let selected = { l: 1, h: 0 };
  let query = null; // pinned query position, or null
  let run; // last forward pass on the input

  // ---- model ------------------------------------------------------------------------------
  const f32 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  };

  function encode(text) {
    const toks = [0];
    for (const c of text.toLowerCase().replace(/\s+/g, ' ')) {
      const i = M.chars.indexOf(c);
      if (i >= 0 && toks.length < M.ctx) toks.push(i + 1);
    }
    return toks;
  }

  function forward(toks) {
    const { d_model: D, d_head: E, n_heads: H, n_layers: L, vocab: V } = M;
    const W = M.w;
    const n = toks.length;
    const x = new Float32Array(n * D);
    for (let i = 0; i < n; i++)
      for (let d = 0; d < D; d++) x[i * D + d] = W.W_E[toks[i] * D + d] + W.W_pos[i * D + d];

    // Each layer, and the unembedding, reads the residual stream through its own LayerNorm.
    const ln = (i) => {
      const r = new Float32Array(n * D);
      for (let t = 0; t < n; t++) {
        let mean = 0, varr = 0;
        for (let d = 0; d < D; d++) mean += x[t * D + d];
        mean /= D;
        for (let d = 0; d < D; d++) varr += (x[t * D + d] - mean) ** 2;
        const inv = 1 / Math.sqrt(varr / D + 1e-5);
        for (let d = 0; d < D; d++) r[t * D + d] = (x[t * D + d] - mean) * inv * W.ln_w[i * D + d] + W.ln_b[i * D + d];
      }
      return r;
    };

    const attn = [];
    const q = new Float32Array(n * E), k = new Float32Array(n * E), v = new Float32Array(n * E), z = new Float32Array(n * E);
    const scale = 1 / Math.sqrt(E);
    for (let l = 0; l < L; l++) {
      const r = ln(l);
      const delta = new Float32Array(n * D);
      const layer = [];
      for (let h = 0; h < H; h++) {
        const off = (l * H + h) * D * E;
        for (let i = 0; i < n; i++)
          for (let e = 0; e < E; e++) {
            let sq = 0, sk = 0, sv = 0;
            for (let d = 0; d < D; d++) {
              const xi = r[i * D + d], w = off + d * E + e;
              sq += xi * W.W_Q[w]; sk += xi * W.W_K[w]; sv += xi * W.W_V[w];
            }
            q[i * E + e] = sq; k[i * E + e] = sk; v[i * E + e] = sv;
          }
        const A = new Float32Array(n * n);
        for (let i = 0; i < n; i++) {
          let max = -Infinity;
          for (let j = 0; j <= i; j++) {
            let s = 0;
            for (let e = 0; e < E; e++) s += q[i * E + e] * k[j * E + e];
            A[i * n + j] = s * scale;
            if (A[i * n + j] > max) max = A[i * n + j];
          }
          let sum = 0;
          for (let j = 0; j <= i; j++) sum += (A[i * n + j] = Math.exp(A[i * n + j] - max));
          for (let j = 0; j <= i; j++) A[i * n + j] /= sum;
        }
        layer.push(A);
        if (!keep[l][h]) continue;
        z.fill(0);
        for (let i = 0; i < n; i++)
          for (let j = 0; j <= i; j++) {
            const a = A[i * n + j];
            for (let e = 0; e < E; e++) z[i * E + e] += a * v[j * E + e];
          }
        const oOff = (l * H + h) * E * D;
        for (let i = 0; i < n; i++)
          for (let e = 0; e < E; e++) {
            const ze = z[i * E + e];
            for (let d = 0; d < D; d++) delta[i * D + d] += ze * W.W_O[oOff + e * D + d];
          }
      }
      for (let i = 0; i < x.length; i++) x[i] += delta[i];
      attn.push(layer);
    }

    // probs[i] is the distribution over the token at i + 1.
    const f = ln(L);
    const probs = [];
    for (let i = 0; i < n; i++) {
      const p = new Float32Array(V);
      let max = -Infinity;
      for (let t = 0; t < V; t++) {
        let s = 0;
        for (let d = 0; d < D; d++) s += f[i * D + d] * W.W_U[d * V + t];
        p[t] = s;
        if (s > max) max = s;
      }
      let sum = 0;
      for (let t = 0; t < V; t++) sum += (p[t] = Math.exp(p[t] - max));
      for (let t = 0; t < V; t++) p[t] /= sum;
      probs.push(p);
    }
    return { toks, attn, probs };
  }

  // ---- labelling heads ------------------------------------------------------------------------
  // On a random string repeated twice: a previous-token head puts its weight on i - 1; an
  // induction head, on the second copy, puts it on the token right after the earlier occurrence.
  function scoreHeads() {
    let seed = 7;
    const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const half = 40, trials = 4;
    const prev = [], ind = [];
    for (let l = 0; l < M.n_layers; l++) { prev.push(Array(M.n_heads).fill(0)); ind.push(Array(M.n_heads).fill(0)); }
    for (let t = 0; t < trials; t++) {
      const first = Array.from({ length: half }, () => 1 + Math.floor(rand() * (M.vocab - 1)));
      const toks = [0, ...first, ...first];
      const n = toks.length;
      const { attn } = forward(toks);
      attn.forEach((layer, l) => layer.forEach((A, h) => {
        let p = 0, s = 0;
        for (let i = 1; i < n; i++) p += A[i * n + i - 1];
        for (let i = half + 1; i < n; i++) s += A[i * n + i - half + 1];
        prev[l][h] += p / (n - 1) / trials;
        ind[l][h] += s / (n - half - 1) / trials;
      }));
    }
    return { prev, ind };
  }

  // ---- drawing ----------------------------------------------------------------------------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const accent = (a) => `rgb(${css('--accent-rgb')} / ${a})`;
  const label = (t) => (t === 0 ? '⟨s⟩' : M.chars[t - 1] === ' ' ? '·' : M.chars[t - 1]);
  const pct = (p) => `${(100 * p).toFixed(p < 0.1 ? 1 : 0)}%`;

  function heatmap(canvas, A, n, size) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = css('--bg');
    g.fillRect(0, 0, size, size);
    const c = size / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        const a = A[i * n + j];
        if (a < 0.02) continue;
        g.fillStyle = accent(Math.min(1, a * 1.15));
        g.fillRect(j * c, i * c, Math.ceil(c), Math.ceil(c));
      }
    if (query != null && query < n) {
      g.strokeStyle = css('--fg');
      g.lineWidth = 1;
      g.strokeRect(0.5, query * c + 0.5, (query + 1) * c - 1, Math.max(1, c - 1));
    }
  }

  function renderHeads() {
    const n = run.toks.length;
    root.querySelectorAll('.ih-head').forEach((el) => {
      const l = +el.dataset.l, h = +el.dataset.h;
      heatmap(el.querySelector('canvas'), run.attn[l][h], n, 72);
      el.classList.toggle('selected', l === selected.l && h === selected.h);
      el.classList.toggle('off', !keep[l][h]);
      el.querySelector('.ih-ko').textContent = keep[l][h] ? 'knock out' : 'restore';
      el.querySelector('.ih-ko').setAttribute('aria-pressed', String(!keep[l][h]));
    });
    $('#ih-big-title').textContent = `Layer ${selected.l} · head ${selected.h}`;
    heatmap($('#ih-big'), run.attn[selected.l][selected.h], n, Math.min(320, root.clientWidth - 8));
  }

  // The row of characters is rebuilt only when the text or the knockouts change (buildText);
  // moving the pointer or picking a head just repaints it (paintText).
  function buildText() {
    const { toks, probs } = run;
    const box = $('#ih-text');
    box.replaceChildren();
    let right = 0;
    toks.forEach((t, i) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ih-ch';
      cell.dataset.i = i;
      const p = i ? probs[i - 1][t] : null;
      const top = i ? probs[i - 1].indexOf(Math.max(...probs[i - 1])) : null;
      if (i && top === t) right++;
      const ch = document.createElement('span');
      ch.textContent = label(t);
      const bar = document.createElement('i');
      bar.style.height = i ? `${Math.max(2, 22 * p)}px` : '0';
      cell.append(ch, bar);
      cell.title = i ? `P(${label(t)}) = ${pct(p)} · top guess here: ${label(top)} (${pct(probs[i - 1][top])})` : 'start of text';
      box.append(cell);
    });
    const off = keep.flat().filter((k) => !k).length;
    $('#ih-stats').textContent = toks.length > 1
      ? `Its top guess was right on ${right} of ${toks.length - 1} characters.` + (off ? ` (${off} head${off > 1 ? 's' : ''} knocked out)` : '')
      : '';
    paintText();
  }

  function paintText() {
    const { toks, probs, attn } = run;
    const n = toks.length;
    const A = attn[selected.l][selected.h];
    root.querySelectorAll('.ih-ch').forEach((cell, i) => {
      cell.classList.toggle('q', i === query);
      const a = query != null && i < query ? A[query * n + i] : 0;
      cell.style.background = a > 0.03 ? accent(Math.min(0.9, a)) : '';
    });
    if (query != null && query > 0) {
      const nxt = probs[query].indexOf(Math.max(...probs[query]));
      $('#ih-query').textContent = `At “${label(toks[query])}” (position ${query}), layer ${selected.l} head ${selected.h} is looking at the highlighted characters. The model's guess for what comes next: “${label(nxt)}” (${pct(probs[query][nxt])}).`;
    } else {
      $('#ih-query').textContent = 'Hover or tap a character to see where the selected head looks from there.';
    }
  }

  function update() {
    run = forward(encode($('#ih-input').value));
    if (query != null && query >= run.toks.length) query = null;
    renderHeads();
    buildText();
  }

  function setup(scores) {
    const grid = $('#ih-heads');
    for (let l = 0; l < M.n_layers; l++)
      for (let h = 0; h < M.n_heads; h++) {
        const p = scores.prev[l][h], s = scores.ind[l][h];
        const kind = s > 0.4 ? 'induction' : p > 0.5 ? 'previous-token' : '';
        const el = document.createElement('div');
        el.className = 'ih-head';
        el.dataset.l = l; el.dataset.h = h;
        el.innerHTML = `<button type="button" class="ih-pick" aria-label="Show layer ${l} head ${h}"><canvas></canvas></button>
          <div class="ih-name">L${l}H${h}</div>
          <div class="ih-kind">${kind || '&nbsp;'}</div>
          <div class="ih-score" title="mean attention to the previous token · induction score">prev ${p.toFixed(2)} · ind ${s.toFixed(2)}</div>
          <button type="button" class="linkish ih-ko">knock out</button>`;
        el.querySelector('.ih-pick').onclick = () => { selected = { l, h }; renderHeads(); paintText(); };
        el.querySelector('.ih-ko').onclick = () => { keep[l][h] = !keep[l][h]; update(); };
        grid.append(el);
      }
    // Start on the clearest induction head.
    let best = -1;
    scores.ind.forEach((row, l) => row.forEach((s, h) => { if (s > best) { best = s; selected = { l, h }; } }));

    const text = $('#ih-text');
    const pick = (e) => {
      const c = e.target.closest('.ih-ch');
      if (!c || +c.dataset.i === query) return;
      query = +c.dataset.i;
      renderHeads();
      paintText();
    };
    text.addEventListener('mouseover', pick);
    text.addEventListener('click', pick);
    $('#ih-input').addEventListener('input', () => { query = null; update(); });
    root.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => {
      let s = b.dataset.preset;
      if (s === 'random') {
        const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const w = () => Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => alpha[Math.floor(Math.random() * alpha.length)]).join('');
        const once = Array.from({ length: 5 }, w).join(' ');
        s = `${once} ${once}`;
      }
      $('#ih-input').value = s;
      query = null;
      update();
    }));
    $('#ih-reset').onclick = () => { keep = keep.map((r) => r.map(() => true)); update(); };
    new MutationObserver(() => run && (renderHeads(), paintText()))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    let w = root.clientWidth;
    new ResizeObserver(() => { if (run && root.clientWidth !== w) { w = root.clientWidth; renderHeads(); } }).observe(root);
  }

  async function load() {
    const status = $('#ih-status');
    try {
      const res = await fetch('/models/induction-2l.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      M = { ...j, w: Object.fromEntries(Object.entries(j.weights).map(([k, v]) => [k, f32(v.data)])) };
      keep = Array.from({ length: M.n_layers }, () => Array(M.n_heads).fill(true));
      setup(scoreHeads());
      $('#ih-train').textContent = `On a random string typed twice, its loss is ${j.loss.first_copy.toFixed(2)} nats on the first copy (chance is ${Math.log(M.vocab - 1).toFixed(2)}) and ${j.loss.second_copy.toFixed(2)} on the second.`;
      root.classList.add('ready');
      status.hidden = true;
      update();
    } catch (e) {
      status.textContent = `Couldn't load the model (${e.message}).`;
    }
  }

  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); load(); }
  }, { rootMargin: '400px' }).observe(root);
})();
