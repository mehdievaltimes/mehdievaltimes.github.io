#!/usr/bin/env node
// Pulls puppy bench results from its own repo into the site:
// results/results.json -> src/data/puppy-bench.json, results/runs -> public/puppy-bench/runs.
// Usage: node scripts/sync-puppy-bench.mjs [path to a local puppy-bench checkout]
// Without a path it shallow-clones github.com/mehdievaltimes/puppy-bench. If that fails, the
// committed copy stays as it is, so a deploy never breaks on it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/mehdievaltimes/puppy-bench.git';

let src = process.argv[2] && resolve(process.argv[2]);
let tmp;
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), 'puppy-bench-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', REPO, tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    src = tmp;
  } catch (e) {
    console.warn(`puppy bench: couldn't clone ${REPO}, keeping the committed copy (${e.stderr?.toString().trim() || e.message})`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
}

const results = join(src, 'results', 'results.json');
if (!existsSync(results)) {
  console.error(`puppy bench: no results/results.json in ${src}`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(results, 'utf8'));
// The repo stores raw paths relative to results/; the site serves them under /puppy-bench/.
for (const r of data.runs) if (r.raw) r.raw = `/puppy-bench/${r.raw}`;
writeFileSync(join(SITE, 'src/data/puppy-bench.json'), JSON.stringify(data, null, 2) + '\n');

const runs = join(SITE, 'public/puppy-bench/runs');
rmSync(runs, { recursive: true, force: true });
cpSync(join(src, 'results', 'runs'), runs, { recursive: true });
if (tmp) rmSync(tmp, { recursive: true, force: true });
console.log(`puppy bench: synced ${data.runs.length} runs`);
