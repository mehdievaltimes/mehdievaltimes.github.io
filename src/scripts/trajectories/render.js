// DOM builders for the trajectory reader. Everything a trajectory contains is untrusted text:
// build nodes and set textContent, never innerHTML.

export const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
};

// ---- formatting ---------------------------------------------------------------

export function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n ?? '–');
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? n.toLocaleString() : String(+n.toFixed(4));
}
export function fmtDur(s) {
  if (typeof s !== 'number' || !isFinite(s)) return '–';
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
export function fmtBytes(b) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}
export const firstLine = (s, n = 140) => {
  const line = String(s ?? '').trim().split('\n', 1)[0];
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
};
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
export const clean = (s) => String(s ?? '').replace(ANSI, '');

// Wraps case-insensitive occurrences of q in <mark>.
export function marked(text, q, limit = 400) {
  if (!q) return [text];
  const out = [], lower = text.toLowerCase();
  let at = 0, n = 0;
  for (let i = lower.indexOf(q); i !== -1 && n < limit; i = lower.indexOf(q, at), n++) {
    if (i > at) out.push(text.slice(at, i));
    out.push(h('mark', {}, text.slice(i, i + q.length)));
    at = i + q.length;
  }
  out.push(text.slice(at));
  return out;
}

export async function copy(text, btn) {
  const label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'copied ✓'; } catch { btn.textContent = 'copy failed'; }
  setTimeout(() => (btn.textContent = label), 1200);
}

// ---- markdown (the subset agents actually write) ------------------------------

const INLINE = /(`+)([\s\S]*?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^\s)]*)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text, q) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push(...marked(text.slice(at, m.index), q));
    if (m[1]) out.push(h('code', {}, marked(m[2], q)));
    else if (m[3] ?? m[4]) out.push(h('strong', {}, inline(m[3] ?? m[4], q)));
    else if (m[5]) out.push(h('em', {}, inline(m[5], q)));
    else if (m[6]) out.push(h('a', /^https?:/.test(m[7]) ? { href: m[7], target: '_blank', rel: 'noopener nofollow' } : { href: m[7] }, marked(m[6], q)));
    else if (m[8]) out.push(h('a', { href: m[8], target: '_blank', rel: 'noopener nofollow' }, marked(m[8], q)));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(...marked(text.slice(at), q));
  return out;
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function md(text, q = '') {
  const root = h('div', { class: 'md' });
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) root.append(h('p', {}, inline(para.join('\n'), q))); para.length = 0; };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      i++;
      root.append(h('pre', {}, h('code', {}, marked(body.join('\n'), q))));
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) { flush(); root.append(h(`h${Math.min(6, hd[1].length + 2)}`, {}, inline(hd[2], q))); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      root.append(h('blockquote', {}, md(body.join('\n'), q)));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      root.append(h('div', { class: 'tbl' }, h('table', {},
        h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, inline(c, q))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c, q)))))))));
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const list = h(ordered ? 'ol' : 'ul', {});
      for (; i < lines.length; i++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) { list.append(h('li', { class: m[1].length >= 2 ? 'nested' : null }, inline(m[3].replace(/^\[( |x)\]\s+/i, (_, x) => (x === ' ' ? '☐ ' : '☑ ')), q))); continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) { list.lastChild.append(' ', ...inline(lines[i].trim(), q)); continue; }
        break;
      }
      root.append(list);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return root;
}

// ---- JSON explorer --------------------------------------------------------------

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v == null || typeof v !== 'object' || (Array.isArray(v) && v.length === 0);
const scalarRows = (rows) => rows.length >= 2 && rows.every((r) => isObj(r) && Object.values(r).every(isScalar));
const colsOf = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

function scalar(v) {
  if (v == null) return h('span', { class: 'j-null' }, 'null');
  if (typeof v === 'boolean') return h('span', { class: `j-bool ${v}` }, String(v));
  if (typeof v === 'number') return h('span', { class: 'j-num' }, String(v));
  if (Array.isArray(v)) return h('span', { class: 'j-null' }, '[]');
  const s = String(v);
  if (s.includes('\n') || s.length > 200) {
    const n = s.split('\n').length;
    return n > 12 || s.length > 1200
      ? h('details', { class: 'j-long' }, h('summary', {}, h('span', { class: 'j-str' }, firstLine(s, 90)), h('span', { class: 'meta' }, ` ${n} lines`)), h('pre', {}, clean(s)))
      : h('pre', { class: 'j-pre' }, clean(s));
  }
  return h('span', { class: 'j-str' }, s);
}

function table(rows, keyCol) {
  const cols = colsOf(rows.map((r) => r[1]));
  return h('div', { class: 'tbl' }, h('table', { class: 'j-table' },
    h('thead', {}, h('tr', {}, keyCol && h('th', {}, ''), cols.map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.map(([k, r]) => h('tr', {}, keyCol && h('th', {}, k), cols.map((c) => h('td', {}, c in r ? scalar(r[c]) : '')))))));
}

export function jsonTree(v, depth = 0, open = 2) {
  if (isScalar(v)) return scalar(v);
  if (Array.isArray(v)) {
    if (v.every((x) => isScalar(x) && typeof x !== 'string') || (v.every((x) => typeof x === 'string' && x.length < 60) && v.length <= 40))
      return h('span', { class: 'j-list' }, v.map((x, i) => [i > 0 && h('span', { class: 'j-sep' }, ', '), scalar(x)]));
    if (scalarRows(v) && colsOf(v).length <= 8) return table(v.map((r) => [null, r]), false);
  } else {
    const entries = Object.entries(v);
    if (scalarRows(entries.map((e) => e[1])) && colsOf(entries.map((e) => e[1])).length <= 8) return table(entries, true);
  }
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  // Small flat objects ({"1": false, "2": true…}) read better on one line.
  if (!Array.isArray(v) && entries.length > 1 && entries.length <= 12 && entries.every(([k, x]) => k.length <= 12 && (x == null || typeof x === 'boolean' || typeof x === 'number')))
    return h('span', { class: 'j-inline' }, entries.map(([k, x]) => h('span', {}, h('span', { class: 'j-key' }, `${k} `), scalar(x))));
  return h('dl', { class: 'j-obj' }, entries.map(([k, x]) => {
    if (isScalar(x) || (Array.isArray(x) && x.every(isScalar))) return [h('dt', {}, String(k)), h('dd', {}, jsonTree(x, depth + 1, open))];
    const size = Array.isArray(x) ? `[${x.length}]` : `{${Object.keys(x).length}}`;
    const d = h('details', { class: 'j-node', open: depth + 1 < open }, h('summary', {}, String(k), h('span', { class: 'meta' }, ` ${size}`)));
    // Build children lazily; big results can hold thousands of nodes.
    const fill = () => { if (!d.dataset.filled) { d.dataset.filled = 1; d.append(jsonTree(x, depth + 1, open)); } };
    if (d.open) fill(); else d.addEventListener('toggle', fill);
    return h('div', { class: 'j-row' }, d);
  }));
}
