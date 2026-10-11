// Adds runs to the trajectory library (/trajectories): copies each run's summary .json and event
// stream .jsonl into public/trajectories/runs/[folder/], gzips large streams, and prints each
// run's URL. Files are checked with the same parser the page uses.
//
//   npm run add-trajectory -- <file|folder>... [--to <folder>] [--dry-run]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { FILE_EXT, FORMAT_LABEL, isSummary, pairRuns, parseStream } from '../src/scripts/trajectories/parse.js';
import { LIBRARY_DIR, runPath } from '../src/lib/trajectory-library.mjs';

const GZIP_OVER = 1e6; // GitHub Pages caps the whole site at 1 GB; streams compress ~10×.
const SITE = 'https://mehdievaltimes.github.io';

const args = process.argv.slice(2);
let to = '', dry = false;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--to') to = (args[++i] ?? '').replace(/^\/+|\/+$/g, '');
  else if (args[i] === '--dry-run') dry = true;
  else inputs.push(args[i]);
}
if (!inputs.length) {
  console.error('usage: npm run add-trajectory -- <file|folder>... [--to <folder>] [--dry-run]');
  process.exit(1);
}

const kb = (n) => (n < 1e6 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const read = (f) => { const b = readFileSync(f); return (/\.gz$/i.test(f) ? gunzipSync(b) : b).toString('utf8'); };

const files = inputs.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).map((n) => join(p, n)).filter((f) => statSync(f).isFile()) : [p]));
const skipped = [];
const items = [];
for (const f of files) {
  const name = basename(f);
  if (!FILE_EXT.test(name)) { skipped.push(name); continue; }
  const item = { path: name, name, src: f, size: statSync(f).size };
  if (/\.json$/i.test(name)) {
    try {
      const doc = JSON.parse(readFileSync(f, 'utf8'));
      if (isSummary(doc)) item.doc = doc;
    } catch (e) {
      console.error(`✗ ${name}: not valid JSON (${e.message})`);
      process.exit(1);
    }
  }
  items.push(item);
}
if (skipped.length) console.log(`skipping ${skipped.length} other file(s): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);

const dest = join(LIBRARY_DIR, to);
if (!dry) mkdirSync(dest, { recursive: true });
for (const run of pairRuns(items)) {
  const key = to ? `${to}/${run.key}` : run.key;
  const notes = [];
  if (run.stream) {
    const { events, meta } = parseStream(read(run.stream.src));
    const steps = events.filter((e) => e.step);
    if (meta.format === 'raw') notes.push('stream format not recognised; it will show as raw events');
    notes.push(`${FORMAT_LABEL[meta.format] ?? meta.format} stream, ${steps.length} steps, ${steps.filter((e) => e.failed).length} failed, ${events.filter((e) => e.kind === 'message').length} messages`);
  } else notes.push('no .jsonl stream: only the summary will show');
  if (!run.json) notes.push('no summary .json');
  // Contributors' runs often carry their home directories; flag them before publishing.
  const homes = new Set();
  for (const s of [run.json, run.stream].filter(Boolean)) for (const m of read(s.src).matchAll(/\/(?:home|Users)\/[\w.-]+/g)) homes.add(m[0]);
  if (homes.size) notes.push(`contains paths ${[...homes].slice(0, 3).join(', ')} (published as-is)`);

  const out = [];
  for (const s of [run.json, run.stream].filter(Boolean)) {
    const gz = s === run.stream && !/\.gz$/i.test(s.name) && s.size > GZIP_OVER;
    const target = join(dest, gz ? `${s.name}.gz` : s.name);
    const replaced = existsSync(target) ? ' (replaced)' : '';
    if (gz) {
      const data = gzipSync(readFileSync(s.src), { level: 9 });
      if (!dry) writeFileSync(target, data);
      out.push(`${s.name} ${kb(s.size)} → .gz ${kb(data.length)}${replaced}`);
    } else {
      if (!dry) copyFileSync(s.src, target);
      out.push(`${s.name} ${kb(s.size)}${replaced}`);
    }
  }
  console.log(`${dry ? '[dry run] ' : ''}✓ ${run.sum?.title ?? run.key}\n    ${SITE}${runPath(key)}\n    ${[...out, ...notes].join('\n    ')}`);
}
if (!dry) console.log(`\nFiles are in ${dest.replace(process.cwd() + '/', '')}/. Commit and push to publish.`);
