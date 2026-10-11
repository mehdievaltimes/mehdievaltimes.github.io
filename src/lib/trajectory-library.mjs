// Build-time index of the stored runs in public/trajectories/runs/. Add runs with
// `npm run add-trajectory -- <files…>` (or copy them in); every run gets /trajectories/<key>/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FILE_EXT, isSummary, pairRuns } from '../scripts/trajectories/parse.js';

export const LIBRARY_DIR = join(process.cwd(), 'public', 'trajectories', 'runs');

function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.name.startsWith('.') ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
}

export function loadLibrary() {
  if (!existsSync(LIBRARY_DIR)) return [];
  const items = walk(LIBRARY_DIR).filter((f) => FILE_EXT.test(f)).map((f) => {
    const path = relative(LIBRARY_DIR, f).split(sep).join('/');
    const item = { path, name: path.split('/').pop(), size: statSync(f).size, url: `/trajectories/runs/${path.split('/').map(encodeURIComponent).join('/')}` };
    if (/\.json$/i.test(f)) {
      try {
        const doc = JSON.parse(readFileSync(f, 'utf8'));
        if (isSummary(doc)) item.doc = doc;
      } catch {}
    }
    return item;
  });
  const file = (x) => x && { path: x.path, name: x.name, size: x.size, url: x.url };
  return pairRuns(items).map((r) => ({
    key: r.key, name: r.name, dir: r.dir,
    json: file(r.json), stream: file(r.stream),
    // Only what the index table needs; the reader fetches the full summary when a run opens.
    sum: r.sum && { title: r.sum.title, agent: r.sum.agent, model: r.sum.model, tier: r.sum.tier, chips: r.sum.chips, correct: r.sum.correct, score: r.sum.score, max: r.sum.max, wall: r.sum.wall, steps: r.sum.steps, cost: r.sum.cost },
  }));
}

export const runPath = (key) => `/trajectories/${key.split('/').map(encodeURIComponent).join('/')}/`;
