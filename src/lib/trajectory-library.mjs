// Build-time index of trajectories/ at the repo root:
//   trajectories/data/     run files (.json results, .jsonl streams); each run gets /trajectories/<key>/
//   trajectories/scripts/  anything else worth sharing; each file gets a viewer at /trajectories/scripts/<path>/
// Every file is served at /trajectories/raw/<folder>/<path>; big streams are gzipped on the way out.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FILE_EXT, isSummary, pairRuns, runKey } from '../scripts/trajectories/parse.js';

export const ROOT = join(process.cwd(), 'trajectories');
export const DATA_DIR = join(ROOT, 'data');
const GZIP_OVER = 1e6; // GitHub Pages caps the whole site at 1 GB; streams compress ~10×.

const hidden = (name) => name.startsWith('.') || /^readme(\.md)?$/i.test(name);
function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    hidden(e.name) ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
}
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export function rawFiles() {
  return ['data', 'scripts'].flatMap((folder) => {
    const dir = join(ROOT, folder);
    if (!existsSync(dir)) return [];
    return walk(dir).map((abs) => {
      const path = relative(dir, abs).split(sep).join('/');
      const size = statSync(abs).size;
      const gzip = folder === 'data' && /\.(jsonl|ndjson)$/i.test(path) && size > GZIP_OVER;
      const served = `${folder}/${path}${gzip ? '.gz' : ''}`;
      return { folder, path, abs, size, gzip, served, url: `/trajectories/raw/${enc(served)}` };
    });
  });
}

export function loadLibrary() {
  const items = rawFiles().filter((f) => f.folder === 'data' && FILE_EXT.test(f.path)).map((f) => {
    const item = { path: f.path, name: f.served.split('/').pop(), size: f.size, url: f.url };
    if (/\.json$/i.test(f.path)) {
      try {
        const doc = JSON.parse(readFileSync(f.abs, 'utf8'));
        if (isSummary(doc)) item.doc = doc;
      } catch {}
    }
    return item;
  });
  // `<run>.md` (or `<run>.notes.md`) next to a run's files is shown as its Notes tab.
  const notes = new Map(rawFiles().filter((f) => f.folder === 'data' && /\.md$/i.test(f.path)).map((f) => {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
    return [dir + runKey(f.path.slice(dir.length).replace(/(\.notes)?\.md$/i, '')), f];
  }));
  const file = (x) => x && { path: x.path, name: x.name, size: x.size, url: x.url };
  return pairRuns(items).map((r) => ({
    key: r.key, name: r.name, dir: r.dir,
    json: file(r.json), stream: file(r.stream), notes: notes.has(r.key) ? file({ ...notes.get(r.key), name: notes.get(r.key).path.split('/').pop() }) : undefined,
    // Only what the index table needs; the reader fetches the full summary when a run opens.
    sum: r.sum && { title: r.sum.title, agent: r.sum.agent, model: r.sum.model, tier: r.sum.tier, chips: r.sum.chips, correct: r.sum.correct, score: r.sum.score, max: r.sum.max, wall: r.sum.wall, steps: r.sum.steps, cost: r.sum.cost },
  }));
}

// Each top-level folder in data/ is a collection; its README.md is the description.
export function loadCollections() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && !hidden(e.name)).map((e) => {
    const readme = ['README.md', 'readme.md', 'README'].map((n) => join(DATA_DIR, e.name, n)).find(existsSync);
    return { folder: e.name, readme: readme ? readFileSync(readme, 'utf8') : '' };
  }).sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
}

const LANGS = {
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript',
  json: 'json', jsonl: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp',
  rs: 'rust', go: 'go', rb: 'ruby', s: 'asm', asm: 'asm', sql: 'sql', ini: 'ini', cfg: 'ini', dockerfile: 'docker', makefile: 'make',
};
export function listScripts() {
  return rawFiles().filter((f) => f.folder === 'scripts').map((f) => {
    const name = f.path.split('/').pop();
    const ext = (name.includes('.') ? name.split('.').pop() : name).toLowerCase();
    const head = readFileSync(f.abs).subarray(0, 8192);
    const text = f.size <= 1e6 && !head.includes(0);
    return { path: f.path, name, size: f.size, url: f.url, lang: LANGS[ext] ?? 'plaintext', text, page: `/trajectories/scripts/${enc(f.path)}/` };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export const runPath = (key) => `/trajectories/${enc(key)}/`;
