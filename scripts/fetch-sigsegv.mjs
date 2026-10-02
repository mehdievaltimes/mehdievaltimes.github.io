#!/usr/bin/env node
// Snapshot of the COMS W4181 "SIGSEGV hacking" board -> public/sigsegv.json.
// Projects come from the course README table; PRs come from one search over every course fork.
// A PR's file list is only refetched when its updated_at changes. Set GH_TOKEN for a real rate limit.
// In CI, sets `changed=true|false` (vs. the previous snapshot) on $GITHUB_OUTPUT.
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const OWNER = 'ZhangZhuoSJTU';
const LIST_REPO = 'Columbia-COMS-W4181-Security1-project-list';
const OUT = new URL('../public/sigsegv.json', import.meta.url);
const TITLE = /^\W*([a-z]{2,4}\d{3,5})\s*[-_: ]*\s*round\s*[-_ ]*(\d+)/i; // "<UNI>-Round<N>"

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'sigsegv-board',
  ...(token && { authorization: `Bearer ${token}` }),
};

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${path}`), { status: r.status });
  return r.json();
}

async function projects() {
  const res = await fetch(`https://raw.githubusercontent.com/${OWNER}/${LIST_REPO}/main/README.md`);
  if (!res.ok) throw new Error(`README ${res.status}`);
  const out = {};
  for (const line of (await res.text()).split('\n')) {
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    const m = c.length === 6 && c[0].match(/^\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/([^/)]+)/);
    if (m) out[m[2]] = { name: m[1], kept: Number(c[3].replace(/,/g, '')) || null, checked: c[5].includes('✅') };
  }
  return out;
}

async function pulls() {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`is:pr user:${OWNER}`);
    const { items: batch } = await gh(`/search/issues?q=${q}&sort=created&order=desc&per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items
    .filter((i) => !i.repository_url.endsWith(`/${LIST_REPO}`))
    .map((i) => {
      const t = i.title.match(TITLE);
      return {
        repo: i.repository_url.split('/').pop(),
        n: i.number,
        title: i.title,
        uni: t ? t[1].toLowerCase() : null,
        round: t ? Number(t[2]) : null,
        by: i.user.login,
        state: i.pull_request?.merged_at ? 'merged' : i.state,
        created: i.created_at,
        updated: i.updated_at,
      };
    });
}

async function previous() {
  for (const src of [process.env.PREV_URL, OUT]) {
    if (!src) continue;
    try {
      return src instanceof URL ? JSON.parse(await readFile(src, 'utf8')) : await (await fetch(src)).json();
    } catch {}
  }
  return null;
}

const prev = await previous();
const cached = new Map((prev?.prs ?? []).map((p) => [`${p.repo}#${p.n}`, p]));

let projs, prs;
try {
  const [all, found] = await Promise.all([projects(), pulls()]);
  projs = all;
  prs = found.filter((p) => all[p.repo]); // the user owns unrelated forks too
} catch (e) {
  console.warn(`sigsegv: fetch failed (${e.message}); keeping previous snapshot`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'changed=false\n');
  process.exit(0);
}

let limited = false;
for (const p of prs) {
  const old = cached.get(`${p.repo}#${p.n}`);
  if (old?.nf != null && old.updated === p.updated) {
    Object.assign(p, { a: old.a, d: old.d, nf: old.nf, more: old.more, files: old.files });
    continue;
  }
  if (limited) continue;
  try {
    const list = await gh(`/repos/${OWNER}/${p.repo}/pulls/${p.n}/files?per_page=100`);
    p.a = list.reduce((s, f) => s + f.additions, 0);
    p.d = list.reduce((s, f) => s + f.deletions, 0);
    p.nf = list.length;
    p.more = list.length === 100; // totals undercount past 100 files
    p.files = list
      .map((f) => [f.filename, f.additions, f.deletions])
      .sort((x, y) => y[1] + y[2] - (x[1] + x[2]))
      .slice(0, 40);
  } catch (e) {
    console.warn(`sigsegv: no file list for ${p.repo}#${p.n} (${e.message})`);
    if (e.status === 403 || e.status === 429) limited = true;
  }
}

const body = (o) => JSON.stringify({ projects: o?.projects, prs: o?.prs });
const next = { projects: projs, prs };
const changed = body(prev) !== body(next);
const snapshot = { generated: changed || !prev?.generated ? new Date().toISOString() : prev.generated, ...next };
await writeFile(OUT, JSON.stringify(snapshot) + '\n');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
console.log(`sigsegv: ${prs.length} PRs, ${Object.keys(projs).length} projects, ${changed ? 'changed' : 'unchanged'}${limited ? ' (rate limited)' : ''}`);
