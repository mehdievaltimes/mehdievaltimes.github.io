// Getting files into the reader. Every file becomes a "source": {path, name, size, text()}, backed
// by a dropped File, a stored file on this site, or a ?src= URL. Sources pair into runs (parse.js).
import { isSummary, pairRuns, FILE_EXT } from './parse.js';

const base = (p) => String(p ?? '').split(/[\\/]/).pop();
const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
// Sniff gzip by its magic bytes: servers differ on whether a .gz arrives already decoded.
async function decode(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return new TextDecoder().decode(b);
}

export function fileSource(file, path = file.name) {
  return { path, name: file.name, size: file.size, file, text: async () => decode(await file.arrayBuffer()) };
}

// A file served by this site (the stored library) or by another URL.
export function urlSource({ url, path, name = base(path), size = null }) {
  return {
    path, name, size, url,
    async text() {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} fetching ${name}`);
      return decode(await r.arrayBuffer());
    },
  };
}

// Sources -> runs, merged into `existing`. Summary JSON files are read now (they're small).
export async function toRuns(sources, existing = []) {
  const ignored = [];
  const items = [];
  for (const s of sources) {
    if (!FILE_EXT.test(s.name)) { ignored.push(s.name); continue; }
    if (/\.json$/i.test(s.name) && (s.size ?? 0) < 20e6) {
      try {
        const doc = JSON.parse(await s.text());
        if (isSummary(doc)) s.doc = doc;
      } catch {}
    }
    items.push(s);
  }
  return { runs: pairRuns(items, existing), ignored };
}

export async function fromDrop(dt) {
  const roots = [...(dt.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return [...dt.files].map((f) => fileSource(f));
  const out = [];
  const walk = async (entry, prefix) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) out.push(fileSource(await new Promise((res, rej) => entry.file(res, rej)), path));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let batch; (batch = await new Promise((res, rej) => reader.readEntries(res, rej))).length;)
        for (const e of batch) await walk(e, path);
    }
  };
  for (const r of roots) await walk(r, '');
  return out;
}

export const fromPicker = (input) => [...input.files].map((f) => fileSource(f, f.webkitRelativePath || f.name));

export function fromUrls(urls) {
  return urls.map((u) => {
    const url = new URL(u, location.href);
    const name = decodeURIComponent(base(url.pathname)) || 'trajectory.jsonl';
    // Keep the parent folder so runs/a/1.jsonl and runs/b/1.jsonl stay separate runs.
    const parent = decodeURIComponent(url.pathname.split('/').slice(-2, -1)[0] ?? '');
    return urlSource({ url: url.href, path: parent ? `${parent}/${name}` : name, name: FILE_EXT.test(name) ? name : `${name}.jsonl` });
  });
}

// ---- remembered local files (IndexedDB; best effort) ---------------------------

const MAX_KEEP = 300e6;
function db() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('trajectories', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}
export async function remember(runs) {
  try {
    const files = runs.flatMap((r) => [r.json, r.stream]).filter((s) => s?.file).map((s) => ({ file: s.file, path: s.path }));
    if (files.reduce((n, f) => n + f.file.size, 0) > MAX_KEEP) return false;
    await kv('readwrite', (st) => st.put(files, 'files'));
    return true;
  } catch { return false; }
}
export async function recall() {
  try { return ((await kv('readonly', (st) => st.get('files'))) ?? []).map((x) => fileSource(x.file, x.path)); } catch { return []; }
}
export async function forget() {
  try { await kv('readwrite', (st) => st.delete('files')); } catch {}
}
