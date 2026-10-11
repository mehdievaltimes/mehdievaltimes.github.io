import { parseStream, summarize, analyze, stepTool, editedPaths, exitMeaning, KINDS, ACTIONS, FORMAT_LABEL } from './parse.js';
import { h, md, jsonTree, fmtNum, fmtDur, fmtBytes, firstLine, clean, marked, copy } from './render.js';
import { toRuns, fromDrop, fromPicker, fromUrls, fileSource, urlSource, remember, recall, forget } from './load.js';

const $ = (id) => document.getElementById(id);
const local = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  library: [], collections: [], local: [], run: null, focus: null, runTab: null,
  kinds: new Set(Object.keys(KINDS)), failedOnly: false,
  grouped: local.get('tr-grouped', true),
  tab: local.get('tr-tab', 'final'), panelOpen: local.get('tr-panel', true),
  q: '', hits: [], hit: -1,
  openSteps: new Set(), flipped: new Set(), // flipped: groups whose open state differs from the default
  sort: { col: 'key', dir: 1 }, filter: '',
};
const events = () => state.run?.parsed?.events ?? [];
const listOf = (run) => (run?.source === 'library' ? state.library : state.local);
const isWork = (e) => ACTIONS.has(e.kind) || e.kind === 'log' || e.kind === 'raw' || (e.kind === 'error' && e.transient);
const visible = (e) =>
  (!(e.kind in KINDS) || state.kinds.has(e.kind)) && (!isWork(e) || ((!state.failedOnly || e.failed) && (!state.focus || state.focus.test(e))));
const KIND_COLOR = { message: 'var(--fg)', reasoning: 'var(--muted)', user: 'var(--fg)', command: 'var(--muted)', tool: 'var(--accent)', files: 'var(--ok)', plan: 'var(--ok)', error: 'var(--accent)', log: 'var(--muted)', raw: 'var(--muted)' };

// ---- routing -------------------------------------------------------------------------

const HOME = '/trajectories/';
const runPath = (key) => `${HOME}${key.split('/').map(encodeURIComponent).join('/')}/`;
const keyFromPath = (p) => {
  const m = /^\/trajectories\/(.+?)\/?$/.exec(p);
  try { return m ? m[1].split('/').map(decodeURIComponent).join('/') : null; } catch { return null; }
};
function push(st, url) {
  if (location.pathname + location.search !== url || JSON.stringify(history.state) !== JSON.stringify(st)) history.pushState(st, '', url);
}
async function route(st) {
  if (st?.local) {
    const r = state.local.find((x) => x.key === st.local);
    if (r) return openRun(r, { push: false });
  }
  const key = keyFromPath(location.pathname);
  const r = key && state.library.find((x) => x.key === key);
  if (r) return openRun(r, { push: false });
  show('home', { push: false });
}

// ---- loading -------------------------------------------------------------------------

async function ingest(sources, { source = 'local', save = true, open = true } = {}) {
  if (!sources.length) return;
  setStatus('Reading…');
  const { runs, ignored } = await toRuns(sources, state.local);
  for (const r of runs) r.source ??= source;
  state.local = runs;
  if (source === 'local' && save) await remember(runs.filter((r) => r.source === 'local'));
  setStatus(ignored.length ? `Skipped ${ignored.length} file${ignored.length > 1 ? 's' : ''} that aren’t JSON or JSONL: ${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? '…' : ''}` : '');
  if (!open) return;
  const fresh = runs.filter((r) => sources.includes(r.json) || sources.includes(r.stream));
  if (fresh.length === 1) return openRun(fresh[0]);
  show('home');
}

function setStatus(text) { $('tr-status').textContent = text; }

const BASE_TITLE = document.title.replace(/^.*?(Trajectories · )/, '$1');
function show(view, { push: doPush = true } = {}) {
  $('tr-home').hidden = view !== 'home';
  $('tr-run').hidden = view !== 'run';
  document.body.classList.toggle('tr-reading', view === 'run');
  if (view === 'home') {
    state.run = null;
    document.title = BASE_TITLE;
    if (doPush) push(null, HOME + location.search);
    renderHome();
  }
}

async function clearLocal() {
  state.local = [];
  await forget();
  setStatus('');
  if (location.search) history.replaceState(null, '', HOME);
  renderHome();
}

// ---- home: library and local runs ----------------------------------------------------

const outcome = (s) => (!s ? null : s.correct === true ? 'solved' : s.correct === false ? 'failed' : null);
const runTitle = (r) => r.sum?.title ?? (r.dir && r.name.length < 12 ? `${r.dir}/${r.name}` : r.name);
const COLS = [
  ['key', 'Run', (r) => runTitle(r)],
  ['agent', 'Agent', (r) => r.sum?.agent ?? ''],
  ['model', 'Model', (r) => r.sum?.model ?? ''],
  ['tier', 'Tier', (r) => r.sum?.tier ?? ''],
  ['score', 'Result', (r) => r.sum?.score ?? (r.sum?.correct == null ? -1 : +r.sum.correct)],
  ['steps', 'Steps', (r) => r.sum?.steps ?? -1, 'r'],
  ['wall', 'Wall time', (r) => r.sum?.wall ?? -1, 'r'],
  ['cost', 'Cost', (r) => r.sum?.cost ?? -1, 'r'],
];

function pill(s) {
  const o = outcome(s);
  const score = s?.score != null ? `${s.score}/${s.max ?? '?'}` : null;
  if (!o && !score) return null;
  return h('span', { class: `tr-pill ${o ?? 'none'}` }, [o === 'solved' ? 'Solved' : o === 'failed' ? 'Failed' : 'Score', score].filter(Boolean).join(' · '));
}

function runTable(runs, { inCollection = false } = {}) {
  const head = h('tr', {}, COLS.map(([col, label, , cls]) =>
    h('th', { class: cls }, h('button', { type: 'button', class: state.sort.col === col ? 'on' : null, onclick: () => {
      state.sort = { col, dir: state.sort.col === col ? -state.sort.dir : ['key', 'agent', 'model', 'tier'].includes(col) ? 1 : -1 };
      renderHome();
    } }, label, state.sort.col === col ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : ''))));
  const f = COLS.find((c) => c[0] === state.sort.col)[2];
  const rows = [...runs].sort((a, b) => {
    const x = f(a), y = f(b);
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * state.sort.dir;
  }).map((r) => {
    const s = r.sum;
    const open = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopPropagation();
      openRun(r);
    };
    const files = [r.json && 'json', r.stream && 'jsonl'].filter(Boolean).join(' + ');
    return h('tr', { onclick: open },
      h('td', { class: 'run' },
        h('a', { href: r.source === 'library' ? runPath(r.key) : '#', onclick: open }, inCollection ? s?.title ?? r.name : runTitle(r)),
        r.notes && h('span', { class: 'tr-badge', title: 'Has notes' }, 'notes'),
        h('small', {}, s?.title ? r.name : inCollection ? files : r.dir || files)),
      h('td', {}, s?.agent ?? '–'),
      h('td', { class: 'mono' }, s?.model ?? '–'),
      h('td', { class: 'dim' }, s?.tier ?? '–'),
      h('td', {}, pill(s) ?? h('span', { class: 'dim' }, s ? '–' : files)),
      h('td', { class: 'r mono' }, s?.steps != null ? fmtNum(s.steps) : '–'),
      h('td', { class: 'r mono' }, s?.wall != null ? fmtDur(s.wall) : '–'),
      h('td', { class: 'r mono' }, s?.cost != null ? `$${s.cost.toFixed(2)}` : '–'));
  });
  return h('div', { class: 'tr-tablewrap' }, h('table', { class: 'tr-table' }, h('thead', {}, head), h('tbody', {}, rows)));
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};
const sumOf = (xs) => xs.filter((x) => typeof x === 'number').reduce((a, b) => a + b, null);

function summaryLine(runs) {
  const scored = runs.filter((r) => r.sum?.correct != null);
  const cost = sumOf(runs.map((r) => r.sum?.cost));
  return [`${runs.length} run${runs.length === 1 ? '' : 's'}`, scored.length && `${scored.filter((r) => r.sum.correct).length}/${scored.length} solved`, cost != null && `$${cost.toFixed(2)} total`].filter(Boolean).join(' · ');
}

// One row per agent + model: how each did across the runs in a collection.
function modelTable(runs) {
  const groups = new Map();
  for (const r of runs.filter((x) => x.sum)) {
    const k = `${r.sum.agent ?? ''}\u0000${r.sum.model ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  if (groups.size < 1 || runs.filter((x) => x.sum).length < 2) return null;
  const rows = [...groups.values()].map((rs) => {
    const s = rs.map((r) => r.sum);
    const scored = s.filter((x) => x.correct != null);
    const scores = s.filter((x) => x.score != null);
    const max = [...new Set(scores.map((x) => x.max))];
    return {
      agent: s[0].agent, model: s[0].model, n: rs.length,
      solved: scored.filter((x) => x.correct).length, scored: scored.length,
      score: scores.length ? `${(scores.reduce((a, x) => a + x.score, 0) / scores.length).toFixed(1)}${max.length === 1 && max[0] != null ? `/${max[0]}` : ''}` : null,
      steps: median(s.map((x) => x.steps)), wall: median(s.map((x) => x.wall)), cost: sumOf(s.map((x) => x.cost)),
    };
  }).sort((a, b) => b.solved / (b.scored || 1) - a.solved / (a.scored || 1) || b.n - a.n);
  return h('div', { class: 'tr-tablewrap' }, h('table', { class: 'tr-table tr-models' },
    h('thead', {}, h('tr', {}, ['Agent', 'Model', 'Runs', 'Solved', 'Mean score', 'Median steps', 'Median wall', 'Total cost'].map((x, i) => h('th', { class: i >= 2 && i !== 3 ? 'r' : null }, x)))),
    h('tbody', {}, rows.map((m) => h('tr', {},
      h('td', {}, m.agent ?? '–'),
      h('td', { class: 'mono' }, m.model ?? '–'),
      h('td', { class: 'r mono' }, m.n),
      h('td', {}, m.scored ? h('span', { class: 'tr-meter', title: `${m.solved} of ${m.scored} solved` },
        h('span', { class: 'track' }, h('i', { style: `width:${(m.solved / m.scored) * 100}%` })), h('span', { class: 'mono' }, `${m.solved}/${m.scored}`)) : '–'),
      h('td', { class: 'r mono' }, m.score ?? '–'),
      h('td', { class: 'r mono' }, m.steps != null ? fmtNum(Math.round(m.steps)) : '–'),
      h('td', { class: 'r mono' }, m.wall != null ? fmtDur(m.wall) : '–'),
      h('td', { class: 'r mono' }, m.cost != null ? `$${m.cost.toFixed(2)}` : '–'))))));
}

// A collection's README: a leading `# Title` names the section, the rest describes it.
function readmeParts(text) {
  const m = /^\s*#\s+(.+)\n?([\s\S]*)$/.exec(text ?? '');
  return m ? { title: m[1].trim(), body: m[2].trim() } : { title: null, body: (text ?? '').trim() };
}

function renderHome() {
  $('tr-local').hidden = !state.local.length;
  if (state.local.length) {
    $('tr-local-table').replaceChildren(runTable(state.local));
    $('tr-local-meta').textContent = summaryLine(state.local);
  }
  const q = state.filter.toLowerCase();
  const match = (r) => !q || [r.key, r.sum?.title, ...(r.sum?.chips ?? [])].join(' ').toLowerCase().includes(q);
  const runs = state.library.filter(match);
  const top = (r) => (r.key.includes('/') ? r.key.slice(0, r.key.indexOf('/')) : '');
  const folders = [...new Set(state.library.map(top))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, undefined, { numeric: true }));
  const grouped = folders.some(Boolean);
  const sections = folders.map((folder) => {
    const all = state.library.filter((r) => top(r) === folder);
    const mine = runs.filter((r) => top(r) === folder);
    if (!mine.length) return null;
    if (!grouped) return runTable(mine);
    const col = state.collections.find((c) => c.folder === folder);
    const { title, body } = readmeParts(col?.readme);
    return h('section', { class: 'tr-collection', id: folder ? `c-${folder}` : 'c-other' },
      h('div', { class: 'tr-colhead' }, h('h3', {}, folder ? title ?? folder : 'Other runs'), h('span', { class: 'tr-count' }, summaryLine(all))),
      body && h('div', { class: 'tr-readme' }, md(body)),
      !q && modelTable(all),
      runTable(mine, { inCollection: Boolean(folder) }));
  }).filter(Boolean);
  $('tr-lib-groups').replaceChildren(...sections);
  $('tr-lib-meta').textContent = state.library.length ? summaryLine(state.library) : '';
  $('tr-lib-empty').hidden = runs.length > 0;
  $('tr-lib-empty').textContent = state.library.length ? 'No runs match the filter.' : 'No stored runs yet.';
  $('tr-run-filter').hidden = state.library.length < 6;
}

// ---- one run -------------------------------------------------------------------------

async function openRun(run, { at, step, push: doPush = true } = {}) {
  state.run = run;
  Object.assign(state, { hits: [], hit: -1, openSteps: new Set(), flipped: new Set(), failedOnly: false, focus: null, runTab: null });
  state.kinds = new Set(Object.keys(KINDS));
  $('tr-expand').textContent = 'Expand all';
  if (doPush) push(run.source === 'library' ? null : { local: run.key }, run.source === 'library' ? runPath(run.key) : location.pathname + location.search);
  show('run');
  $('tr-crumb').textContent = runTitle(run);
  $('tr-runhead').replaceChildren(h('div', { class: 'tr-titlerow' }, h('h1', {}, runTitle(run))));
  $('tr-panel').replaceChildren();
  $('tr-events').replaceChildren(h('p', { class: 'tr-status' }, 'Loading…'));
  try {
    if (run.json && !run.doc) { run.doc = JSON.parse(await run.json.text()); run.sum = summarize(run.doc); }
    if (run.stream && !run.parsed) run.parsed = parseStream(await run.stream.text());
    if (run.notes && run.notesText == null) run.notesText = await run.notes.text();
  } catch (e) {
    run.parsed = { events: [{ kind: 'error', text: `Could not load this run: ${e.message}`, i: 0 }], meta: {} };
  }
  // Keep at most a few parsed runs in memory; big folders hold hundreds of megabytes.
  [...state.library, ...state.local].filter((r) => r.parsed && r !== run).slice(0, -3).forEach((r) => delete r.parsed);
  run.parsed ??= { events: [], meta: {} };
  if (state.run !== run) return; // another run was opened while this one loaded
  document.title = `${runTitle(run)} · ${BASE_TITLE}`;
  renderRun();
  if (state.q) search(state.q);
  window.scrollTo(0, 0);
  const target = step != null ? events().find((e) => e.step === step)?.i : at;
  if (target != null) requestAnimationFrame(() => reveal(target, { open: step != null, block: step != null ? 'center' : 'start' }));
}

function renderRun() {
  const run = state.run;
  const list = listOf(run);
  const i = list.indexOf(run);
  $('tr-crumb').textContent = runTitle(run);
  const raw = [run.json, run.stream].filter((s) => s?.url);
  $('tr-runnav').replaceChildren(...[
    list.length > 1 && h('button', { type: 'button', class: 'tr-icon', disabled: i <= 0, title: 'Previous run ([)', 'aria-label': 'Previous run', onclick: () => openRun(list[i - 1]) }, '‹'),
    list.length > 1 && h('span', { class: 'pos' }, `${i + 1} of ${list.length}`),
    list.length > 1 && h('button', { type: 'button', class: 'tr-icon', disabled: i >= list.length - 1, title: 'Next run (])', 'aria-label': 'Next run', onclick: () => openRun(list[i + 1]) }, '›'),
    run.source === 'library' && h('button', { type: 'button', class: 'tr-btn sm', onclick: (e) => copy(location.origin + runPath(run.key), e.target) }, 'Copy link'),
    ...raw.map((s) => h('a', { class: 'tr-btn sm', href: s.url, download: s.name, title: `${s.name}${s.size ? ` · ${fmtBytes(s.size)}` : ''}` }, /\.json$/i.test(s.name) ? 'Raw JSON' : 'Raw JSONL')),
  ].filter(Boolean));
  $('tr-runhead').replaceChildren(...header(run));
  renderPanel();
  renderChips();
  renderTimeline();
  renderOutline();
  drawMap();
}

function metric(label, value, sub, cls) {
  return h('div', { class: cls || null }, h('dt', {}, label), h('dd', {}, value, sub && h('small', {}, ` ${sub}`)));
}

function header(run) {
  const s = run.sum, m = run.parsed.meta, ev = run.parsed.events;
  const steps = ev.filter((e) => e.step);
  const failed = steps.filter((e) => e.failed).length;
  const msgs = ev.filter((e) => e.kind === 'message').length;
  const cells = [];
  if (s?.wall != null) cells.push(metric('Wall time', fmtDur(s.wall), s.maxWall ? `/ ${fmtDur(s.maxWall)}` : null, s.wallLimit ? 'bad' : ''));
  else if (m.durationMs != null) cells.push(metric('Duration', fmtDur(m.durationMs / 1000)));
  if (s?.steps != null || steps.length) cells.push(metric('Steps', fmtNum(s?.steps ?? steps.length), s?.maxSteps ? `/ ${s.maxSteps}` : null));
  if (steps.length) cells.push(metric('Failed steps', fmtNum(failed), `${Math.round((failed / steps.length) * 100)}%`, failed ? 'bad' : ''));
  if (msgs) cells.push(metric('Messages', fmtNum(msgs)));
  const tok = s?.tokens ?? m.usage;
  if (tok) {
    const inp = tok.input_tokens ?? tok.inputTokens, out = tok.output_tokens ?? tok.outputTokens;
    const cached = tok.cached_input_tokens ?? tok.cache_read_input_tokens ?? tok.cacheReadTokens;
    const reas = tok.reasoning_output_tokens ?? tok.output_tokens_details?.thinking_tokens;
    if (inp != null) cells.push(metric('Input tokens', fmtNum(inp), cached && inp ? `${Math.round((cached / inp) * 100)}% cached` : null));
    if (out != null) cells.push(metric('Output tokens', fmtNum(out), reas ? `${fmtNum(reas)} reasoning` : null));
  }
  const cost = s?.cost ?? m.cost;
  if (cost != null) cells.push(metric('Cost', `$${cost.toFixed(2)}`));
  const sub = [...(s?.chips ?? [m.model, m.version && `v${m.version}`]), m.format ? `${FORMAT_LABEL[m.format] ?? m.format} stream` : !run.stream && 'no trajectory file'].filter(Boolean);
  return [
    h('div', { class: 'tr-titlerow' }, h('h1', {}, runTitle(run)), pill(s)),
    h('p', { class: 'tr-sub' }, sub.map((x) => h('span', {}, x))),
    cells.length > 0 && h('dl', { class: 'tr-metrics' }, cells),
  ].filter(Boolean);
}

function renderPanel() {
  const run = state.run, s = run.sum, m = run.parsed.meta;
  const tabs = [];
  if (run.notesText) tabs.push(['notes', 'Notes', () => md(run.notesText)]);
  const final = s?.final ?? m.result;
  if (final) tabs.push(['final', 'Final message', () => [s?.correct === false && h('p', { class: 'note' }, 'Written by the agent. The Result tab is the grader’s verdict.'), md(final)]]);
  if (run.doc?.result != null) tabs.push(['result', 'Result', () => jsonTree(run.doc.result, 0, 3)]);
  if (run.parsed.events.some((e) => e.step)) tabs.push(['analysis', 'Analysis', () => analysisView(run)]);
  if (run.doc) {
    const { result, last_message, ...rest } = run.doc;
    tabs.push(['config', 'Run config', () => jsonTree(rest, 0, 1)]);
  }
  const { result, format, ...meta } = m;
  if (Object.keys(meta).length) tabs.push(['meta', 'Stream metadata', () => jsonTree(meta, 0, 1)]);
  if (!run.stream) tabs.push(['missing', 'Trajectory', () => h('p', { class: 'note' }, 'No event stream for this run. Drop the matching .jsonl on the page to add it.')]);
  const panel = $('tr-panel');
  if (!tabs.length) return panel.replaceChildren();
  // A run's own notes come first; otherwise reopen the tab used last.
  const cur = tabs.find((t) => t[0] === state.runTab) ?? tabs.find((t) => t[0] === 'notes') ?? tabs.find((t) => t[0] === state.tab) ?? tabs[0];
  panel.classList.toggle('collapsed', !state.panelOpen);
  panel.replaceChildren(
    h('div', { class: 'tr-tabs', role: 'tablist' },
      tabs.map(([id, label]) => h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === cur[0] && state.panelOpen), onclick: () => {
        state.tab = state.runTab = id;
        state.panelOpen = true;
        local.set('tr-tab', id);
        local.set('tr-panel', true);
        renderPanel();
      } }, label)),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'tr-link', onclick: () => { state.panelOpen = !state.panelOpen; local.set('tr-panel', state.panelOpen); renderPanel(); } }, state.panelOpen ? 'Hide' : 'Show')),
    h('div', { class: 'tr-panebody', role: 'tabpanel' }, state.panelOpen ? cur[2]() : null));
}

// ---- analysis tab --------------------------------------------------------------------

function setFocus(focus) {
  state.focus = focus;
  refresh();
  if (focus) $('tr-toolbar').scrollIntoView({ block: 'start' });
}

function analysisView(run) {
  const a = (run.analysis ??= analyze(run.parsed.events));
  const pct = (n) => `${Math.round((n / a.steps) * 100)}%`;
  const base = (p) => p.split('/').pop();
  return h('div', { class: 'tr-analysis' },
    h('p', { class: 'note' }, [
      `${fmtNum(a.steps)} steps`,
      `${fmtNum(a.failed)} failed (${pct(a.failed)})`,
      a.unfinished && `${a.unfinished} never finished`,
      `${a.tools.length} distinct programs and tools`,
      a.files.length && `${a.files.length} files edited`,
      `${fmtBytes(a.outChars)} of output`,
    ].filter(Boolean).join(' · ') + '. Click a row to show only those steps.'),
    h('div', { class: 'tr-legend' }, h('span', {}, h('i', { class: 'ok' }), 'Succeeded'), h('span', {}, h('i', { class: 'bad' }), 'Failed')),
    h('div', { class: 'tr-cols' },
      barList('Programs and tools', a.tools, (x) => x.key, (x) => ({ label: x.key, test: (e) => stepTool(e) === x.key })),
      h('div', {},
        a.exits.length > 0 && barList('Exit codes', a.exits, (x) => `${x.key} ${exitMeaning(x.key)}`, (x) => ({ label: `exit ${x.key}`, test: (e) => e.kind === 'command' && e.exit === x.key }), { failedLabel: false }),
        a.files.length > 0 && barList('Files edited', a.files, (x) => x.key, (x) => ({ label: base(x.key), test: (e) => editedPaths(e).includes(x.key) })))));
}

// Horizontal bars, one per row: succeeded and failed segments on a shared scale.
function barList(title, rows, label, focus, { limit = 10, failedLabel = true } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const list = h('div', { class: 'tr-bars', role: 'list' });
  const draw = (all) => list.replaceChildren(...(all ? rows : rows.slice(0, limit)).map((r) => {
    const ok = r.n - r.failed;
    const text = `${label(r)}: ${r.n} step${r.n === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}`;
    return h('button', { type: 'button', class: 'tr-barrow', role: 'listitem', title: text, 'aria-label': text, onclick: () => setFocus(focus(r)) },
      h('span', { class: 'name' }, label(r)),
      h('span', { class: 'track' },
        ok > 0 && h('i', { class: 'ok', style: `width:${(ok / max) * 100}%` }),
        r.failed > 0 && h('i', { class: 'bad', style: `width:${(r.failed / max) * 100}%` })),
      h('span', { class: 'val' }, r.failed && failedLabel ? `${fmtNum(r.n)} · ${fmtNum(r.failed)} failed` : fmtNum(r.n)));
  }));
  draw(false);
  const more = rows.length > limit && h('button', { type: 'button', class: 'tr-link', onclick: (e) => { draw(true); e.target.remove(); } }, `Show all ${rows.length}`);
  return h('section', { class: 'tr-barlist' }, h('h4', {}, title), list, more);
}

// ---- toolbar -------------------------------------------------------------------------

function renderChips() {
  const ev = events();
  const counts = {};
  for (const e of ev) if (e.kind in KINDS) counts[e.kind] = (counts[e.kind] ?? 0) + (e.kind === 'log' ? e.lines.length : 1);
  const failed = ev.filter((e) => e.step && e.failed).length;
  $('tr-chips').replaceChildren(...[
    state.focus && h('button', { type: 'button', class: 'tr-chip focus', 'aria-pressed': 'true', title: 'Show all steps again', onclick: () => setFocus(null) }, `Only ${state.focus.label}`, h('b', {}, '✕')),
    ...Object.entries(KINDS).filter(([k]) => counts[k]).map(([k, label]) =>
      h('button', { type: 'button', class: 'tr-chip', style: `--dot: ${KIND_COLOR[k]}`, 'aria-pressed': String(state.kinds.has(k)), onclick: () => {
        state.kinds.has(k) ? state.kinds.delete(k) : state.kinds.add(k);
        refresh();
      } }, h('i'), label[0].toUpperCase() + label.slice(1), h('b', {}, fmtNum(counts[k])))),
    failed > 0 && h('button', { type: 'button', class: 'tr-chip fail', 'aria-pressed': String(state.failedOnly), onclick: () => { state.failedOnly = !state.failedOnly; refresh(); } }, 'Only failed', h('b', {}, fmtNum(failed))),
  ].filter(Boolean));
  $('tr-grouped').checked = state.grouped;
}

function refresh() {
  renderChips();
  if (state.q) search(state.q, { keep: true });
  else { renderTimeline(); renderOutline(); drawMap(); }
}

// ---- timeline ------------------------------------------------------------------------

const groupOf = new Map(); // event index -> group id (first event index), rebuilt per render

function renderTimeline() {
  const ev = events();
  const q = state.q.toLowerCase();
  const hits = new Set(state.hits);
  const nodes = [];
  let work = [];
  groupOf.clear();
  const flush = () => {
    if (!work.length) return;
    if (state.grouped) nodes.push(groupNode(work, q, hits));
    else nodes.push(...work.map((e) => stepNode(e, q, hits)));
    work = [];
  };
  for (const e of ev) {
    if (!visible(e)) continue;
    if (isWork(e)) { work.push(e); continue; }
    flush();
    nodes.push(blockNode(e, q, hits));
  }
  flush();
  $('tr-events').replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'tr-status' }, ev.length ? 'Nothing matches these filters.' : state.run?.stream ? 'This file has no events.' : '')]));
}

const GUTTER = { message: 'agent', reasoning: 'thinking', error: 'error', marker: '' };

function blockNode(e, q, hits) {
  const row = (cnt, gut = GUTTER[e.kind] ?? e.kind) => h('div', { id: `e${e.i}`, 'data-i': e.i, 'data-j': e.i, class: `tr-row k-${e.kind}${hits.has(e.i) ? ' hit' : ''}${e.sub ? ' sub' : ''}` },
    h('div', { class: 'gut' }, e.sub && e.kind === 'message' ? 'subagent' : gut), h('div', { class: 'cnt' }, cnt));
  switch (e.kind) {
    case 'message': return row(md(e.text, q));
    case 'reasoning': return clamp(row(md(e.text, q)));
    case 'user': return clamp(row(md(e.text, q), e.role ?? 'user'));
    case 'plan': {
      const done = e.items.filter((x) => x.done).length;
      return row(h('ul', {}, e.items.map((x) => h('li', { class: x.done ? 'done' : null }, marked(x.text, q)))), `plan ${done}/${e.items.length}`);
    }
    case 'error': return row(h('pre', {}, marked(clean(e.text), q)));
    case 'marker': return row(e.text);
    default: return row(h('pre', {}, JSON.stringify(e)));
  }
}

function clamp(el) {
  if (el.textContent.length < 900) return el;
  el.classList.add('clamped');
  el.append(h('button', { type: 'button', class: 'tr-link more', onclick: (ev) => { el.classList.toggle('clamped'); ev.target.textContent = el.classList.contains('clamped') ? 'Show more' : 'Show less'; } }, 'Show more'));
  return el;
}

const plural = (c, w) => `${c} ${w}${c === 1 ? '' : w.endsWith('ch') ? 'es' : 's'}`;

function groupNode(work, q, hits) {
  const gid = work[0].i;
  for (const e of work) groupOf.set(e.i, gid);
  const actions = work.filter((e) => e.step);
  const n = (k) => work.filter((e) => e.kind === k).length;
  const parts = [
    n('command') && plural(n('command'), 'command'),
    n('tool') && plural(n('tool'), 'tool call'),
    n('files') && plural(n('files'), 'edit'),
    n('log') && plural(work.filter((e) => e.kind === 'log').reduce((a, e) => a + e.lines.length, 0), 'log line'),
    n('error') && plural(n('error'), 'warning'),
    n('raw') && plural(n('raw'), 'other event'),
  ].filter(Boolean);
  const failed = actions.filter((e) => e.failed).length;
  const unfinished = work.filter((e) => e.unfinished).length;
  const hitN = work.filter((e) => hits.has(e.i)).length;
  const range = actions.length ? (actions.length > 1 ? `#${actions[0].step}–${actions.at(-1).step}` : `#${actions[0].step}`) : n('log') ? 'log' : '';
  const open = state.grouped && state.flipped.has(gid);
  const d = h('details', { class: `tr-work${hitN ? ' hit' : ''}`, id: `g${gid}`, 'data-i': gid, 'data-j': work.at(-1).i, open },
    h('summary', {},
      h('span', { class: 'gut' }, range),
      h('span', { class: 'cnt' },
        h('span', { class: 'what' }, parts.join(', ')),
        failed > 0 && h('span', { class: 'tr-badge bad' }, `${failed} failed`),
        unfinished > 0 && h('span', { class: 'tr-badge' }, 'unfinished'),
        hitN > 0 && h('span', { class: 'tr-badge hit' }, plural(hitN, 'match')),
        h('span', { class: 'preview' }, actions.slice(0, 4).map(head).join('  ·  ')))));
  const fill = () => { if (!d.dataset.filled) { d.dataset.filled = 1; d.append(h('div', { class: 'steps' }, work.map((e) => stepNode(e, q, hits)))); } };
  d.fill = fill;
  if (open) fill();
  d.addEventListener('toggle', () => {
    if (d.open) fill();
    d.open ? state.flipped.add(gid) : state.flipped.delete(gid);
  });
  return d;
}

function head(e) {
  switch (e.kind) {
    case 'command': return firstLine(e.cmd, 120);
    case 'tool': return `${e.server ? `${e.server}.` : ''}${e.name}(${argsShort(e.input)})`;
    case 'files': return e.changes.map((c) => `${c.kind ?? 'edit'} ${c.path}`).join(', ');
    case 'log': return firstLine(e.lines[0], 140);
    case 'error': return firstLine(e.text, 140);
    case 'raw': return e.title;
    default: return '';
  }
}
function argsShort(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return firstLine(String(input), 60);
  const s = Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(firstLine(v, 40)) : JSON.stringify(v)}`).join(', ');
  return s.length > 100 ? s.slice(0, 99) + '…' : s;
}

const GLYPH = { command: 'shell', tool: 'tool', files: 'edit', log: 'stderr', error: 'warn', raw: 'event' };

function stepNode(e, q, hits) {
  const cmdLines = e.kind === 'command' ? e.cmd.split('\n').length : 0;
  const d = h('details', { class: `tr-step k-${e.kind}${e.failed ? ' failed' : ''}${hits.has(e.i) ? ' hit' : ''}`, id: `e${e.i}`, 'data-i': e.i, 'data-j': e.i, open: state.openSteps.has(e.i) },
    h('summary', {},
      h('span', { class: 'num' }, e.step ? `#${e.step}` : ''),
      h('span', { class: 'glyph' }, GLYPH[e.kind] ?? e.kind),
      h('span', { class: 'head' }, marked(head(e), q)),
      cmdLines > 1 && h('span', { class: 'extra' }, `+${cmdLines - 1} lines`),
      e.kind === 'command' && e.exit != null && e.exit !== 0 && h('span', { class: 'tr-badge bad' }, `exit ${e.exit}`),
      e.kind !== 'command' && e.failed && h('span', { class: 'tr-badge bad' }, 'error'),
      e.unfinished && h('span', { class: 'tr-badge' }, 'unfinished'),
    ));
  const fill = () => { if (!d.dataset.filled) { d.dataset.filled = 1; d.append(stepBody(e, q)); } };
  d.fill = fill;
  if (d.open) fill();
  d.addEventListener('toggle', () => {
    if (d.open) { fill(); state.openSteps.add(e.i); } else state.openSteps.delete(e.i);
  });
  return d;
}

function stepBody(e, q) {
  const el = h('div', { class: 'body' });
  const add = (...xs) => el.append(...xs.flat().filter((x) => x != null && x !== false && x !== ''));
  const copyBtn = (text, what) => h('button', { type: 'button', class: 'tr-link', onclick: (ev) => copy(text, ev.target) }, `Copy ${what}`);
  const label = (text, action) => h('div', { class: 'row' }, h('span', {}, text), action || null);
  if (e.kind === 'command') {
    add(label('Command', copyBtn(e.cmd, 'command')), h('pre', { class: 'cmd' }, marked(e.cmd, q)),
      e.note && label(e.note),
      label(e.exit != null ? `Output · exit ${e.exit}` : e.unfinished ? 'Output · never finished' : 'Output', e.out && copyBtn(clean(e.out), 'output')),
      e.out ? outPre(e.out, q) : label('No output'));
  } else if (e.kind === 'tool') {
    if (e.input != null && !(typeof e.input === 'object' && !Object.keys(e.input).length))
      add(label('Arguments', copyBtn(JSON.stringify(e.input, null, 2), 'arguments')), argsView(e.input, q));
    add(label(e.failed ? 'Error' : 'Result', e.out && copyBtn(clean(e.out), 'result')),
      e.out ? outPre(e.out, q) : label(e.unfinished ? 'Never returned' : 'Empty'));
  } else if (e.kind === 'files') {
    for (const c of e.changes) add(label(`${c.kind ?? 'edit'} · ${c.path}`), c.diff && outPre(c.diff, q));
  } else if (e.kind === 'log') add(outPre(e.lines.join('\n'), q));
  else if (e.kind === 'error') add(h('pre', { class: 'tr-out' }, marked(clean(e.text), q)));
  else if (e.kind === 'raw') add(jsonTree(e.obj, 0, 1));
  const link = state.run.source === 'library' && e.step && h('button', { type: 'button', class: 'tr-link', onclick: (ev) => copy(`${location.origin}${runPath(state.run.key)}#s${e.step}`, ev.target) }, 'Copy link to step');
  if (e.line || link) add(h('div', { class: 'row src' }, h('span', {}, e.line ? `${state.run.stream?.name ?? 'stream'}, line ${e.line}` : ''), link || null));
  return el;
}

function argsView(input, q) {
  if (typeof input !== 'object') return outPre(String(input), q);
  // Long string arguments (code, patches, gdb commands) read better as text than as JSON.
  const long = Object.entries(input).filter(([, v]) => typeof v === 'string' && (v.includes('\n') || v.length > 120));
  if (!long.length) return h('pre', { class: 'tr-out args' }, marked(JSON.stringify(input, null, 2), q));
  const short = Object.fromEntries(Object.entries(input).filter(([k]) => !long.some(([l]) => l === k)));
  return h('div', {}, Object.keys(short).length > 0 && h('pre', { class: 'tr-out args' }, marked(JSON.stringify(short, null, 2), q)),
    long.map(([k, v]) => [h('div', { class: 'row' }, k), outPre(v, q)]));
}

const LINE_CAP = 400, CHAR_CAP = 200e3;
function outPre(text, q, cls = '') {
  text = clean(text);
  const lines = text.split('\n');
  const big = lines.length > LINE_CAP || text.length > CHAR_CAP;
  const pre = h('pre', { class: `tr-out ${cls}` });
  const fillPre = (all) => pre.replaceChildren(...marked(all ? text : lines.slice(0, LINE_CAP).join('\n').slice(0, CHAR_CAP), q));
  fillPre(!big);
  if (!big) return pre;
  return h('div', {}, pre, h('button', { type: 'button', class: 'tr-link', onclick: (ev) => { fillPre(true); ev.target.remove(); } },
    `Show all ${lines.length.toLocaleString()} lines (${fmtBytes(text.length)})`));
}

// ---- revealing / navigation ----------------------------------------------------------

function reveal(i, { open = true, block = 'center' } = {}) {
  const e = events()[i];
  if (!e) return;
  if (!visible(e)) { state.kinds.add(e.kind); state.failedOnly = false; state.focus = null; refresh(); }
  const gid = groupOf.get(i);
  // Jumping to the start of a group (outline, minimap, restore) lands on the group without opening it.
  if (!open && gid === i) return scrollTo($(`g${gid}`), block);
  if (gid != null) {
    const g = $(`g${gid}`);
    // `toggle` fires asynchronously, so build the contents now to have something to scroll to.
    if (g && !g.open) { g.open = true; g.fill(); }
  }
  const el = $(`e${i}`);
  if (!el) return;
  if (open && el.tagName === 'DETAILS' && !el.open) { el.open = true; el.fill?.(); }
  scrollTo(el, block);
}
function scrollTo(el, block) {
  if (!el) return;
  el.scrollIntoView({ block, behavior: 'auto' });
  const target = el.tagName === 'DETAILS' ? el.firstElementChild : el;
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
}

function search(q, { keep = false } = {}) {
  state.q = q;
  const needle = q.trim().toLowerCase();
  state.hits = needle ? events().filter((e) => visible(e) && hay(e).includes(needle)).map((e) => e.i) : [];
  if (!keep) state.hit = -1;
  $('tr-hits').textContent = needle ? (state.hits.length ? `${state.hit >= 0 ? state.hit + 1 : 0}/${state.hits.length}` : 'No matches') : '';
  renderTimeline();
  renderOutline();
  drawMap();
}
function hay(e) {
  return (e._hay ??= [e.text, e.cmd, e.out, e.server, e.name, e.note, e.title, e.input != null && JSON.stringify(e.input),
    e.lines?.join('\n'), e.items?.map((x) => x.text).join('\n'), e.changes?.map((c) => `${c.path}\n${c.diff ?? ''}`).join('\n'),
    e.obj && JSON.stringify(e.obj)].filter(Boolean).join('\n').toLowerCase());
}
function stepHit(dir) {
  const n = state.hits.length;
  if (!n) return;
  state.hit = state.hit < 0 ? (dir > 0 ? 0 : n - 1) : (state.hit + dir + n) % n;
  $('tr-hits').textContent = `${state.hit + 1}/${n}`;
  reveal(state.hits[state.hit]);
}

// Top-level timeline node at the top of the viewport.
function current() {
  const nodes = $('tr-events').children;
  const top = $('tr-toolbar').getBoundingClientRect().bottom + 40;
  let lo = 0, hi = nodes.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].getBoundingClientRect().top <= top) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return nodes[ans];
}
function jumpBlock(dir, kinds = ['message']) {
  const nodes = [...$('tr-events').children];
  const cur = nodes.indexOf(current());
  const top = $('tr-toolbar').getBoundingClientRect().bottom;
  const atTop = nodes[cur] && Math.abs(nodes[cur].getBoundingClientRect().top - top) < 24;
  const want = (n) => kinds.some((k) => n.classList.contains(`k-${k}`));
  const order = dir > 0 ? nodes.slice(cur + 1) : nodes.slice(0, atTop ? cur : cur + 1).reverse();
  const target = order.find(want) ?? (dir < 0 && !atTop ? nodes[cur] : null);
  if (target) reveal(+target.dataset.i, { open: false, block: 'start' });
}

// ---- outline -------------------------------------------------------------------------

function renderOutline() {
  const hits = new Set(state.hits);
  let lastStep = 0;
  const items = [];
  for (const e of events()) {
    if (e.step) lastStep = e.step;
    if (!visible(e) || !['message', 'plan', 'error', 'user', 'marker'].includes(e.kind) || (e.kind === 'error' && e.transient)) continue;
    const text = e.kind === 'plan' ? `Plan ${e.items.filter((x) => x.done).length}/${e.items.length}` : firstLine(e.text, 90).replace(/[*`#]/g, '');
    items.push(h('li', { class: `k-${e.kind}${hits.has(e.i) ? ' hit' : ''}`, 'data-i': e.i },
      h('button', { type: 'button', onclick: () => reveal(e.i, { open: false, block: 'start' }) }, h('span', { class: 'at' }, `#${lastStep}`), text)));
  }
  $('tr-outline-list').replaceChildren(...items);
  $('tr-outline').hidden = !items.length;
}

let activeOutline = null;
function trackScroll() {
  if ($('tr-run').hidden || !state.run) return;
  const node = current();
  if (!node?.dataset.i) return;
  const i = +node.dataset.i, j = +node.dataset.j;
  const n = events().length;
  if (n) Object.assign($('tr-map-cursor').style, { left: `${(i / n) * 100}%`, width: `max(3px, ${((j - i + 1) / n) * 100}%)`, display: 'block' });
  let act = null;
  for (const li of $('tr-outline-list').children) { if (+li.dataset.i <= j) act = li; else break; }
  if (act !== activeOutline) {
    activeOutline?.classList.remove('active');
    act?.classList.add('active');
    activeOutline = act;
    const box = $('tr-outline');
    if (act && (act.offsetTop < box.scrollTop || act.offsetTop > box.scrollTop + box.clientHeight - 40)) box.scrollTop = act.offsetTop - box.clientHeight / 3;
  }
  local.set('tr-pos', { key: state.run.key, i });
}

// ---- minimap -------------------------------------------------------------------------

function drawMap() {
  const c = $('tr-map');
  const ev = events();
  c.parentElement.hidden = ev.length < 2;
  if (ev.length < 2) return;
  const css = getComputedStyle(c);
  const col = (v) => css.getPropertyValue(v).trim();
  const w = c.clientWidth, H = 18, dpr = devicePixelRatio || 1;
  c.width = w * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, H);
  // One tick per event; short runs get thin ticks rather than wide blocks.
  const n = ev.length, bw = Math.max(1, Math.min(w / n - (w / n > 3 ? 1 : 0), 4));
  const hits = new Set(state.hits);
  const fg = col('--fg'), muted = col('--muted'), faint = col('--faint'), accent = col('--accent'), ok = col('--ok');
  for (const e of ev) {
    const x = (e.i / n) * w;
    let color = faint, y = 9, hh = 7;
    if (e.kind === 'message' || e.kind === 'user') { color = fg; y = 4; hh = 12; }
    else if (e.kind === 'plan') { color = ok; y = 4; hh = 12; }
    else if (e.kind === 'reasoning') { color = muted; y = 7; hh = 9; }
    else if (e.kind === 'error' && !e.transient) { color = accent; y = 4; hh = 12; }
    else if (e.kind === 'tool') color = muted;
    if (e.failed) { color = accent; y = 8; hh = 8; }
    g.globalAlpha = visible(e) ? 1 : 0.2;
    g.fillStyle = color;
    g.fillRect(x, y, bw, hh);
    if (hits.has(e.i)) { g.globalAlpha = 1; g.fillStyle = accent; g.fillRect(x, 0, Math.max(2, bw), 2); }
  }
  g.globalAlpha = 1;
}
function mapIndex(ev) {
  const r = $('tr-map').getBoundingClientRect();
  return Math.min(events().length - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * events().length)));
}
function nearestVisible(i) {
  const ev = events();
  for (let d = 0; d < ev.length; d++) for (const k of [i + d, i - d]) if (ev[k] && visible(ev[k])) return k;
  return i;
}

// ---- wiring --------------------------------------------------------------------------

function wire() {
  const pickFiles = $('tr-files'), pickDir = $('tr-dir');
  pickFiles.addEventListener('change', () => { ingest(fromPicker(pickFiles)); pickFiles.value = ''; });
  pickDir.addEventListener('change', () => { ingest(fromPicker(pickDir)); pickDir.value = ''; });
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => (b.dataset.pick === 'dir' ? pickDir : pickFiles).click()));
  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', clearLocal));
  const ingestText = (text) => {
    const name = `pasted-${Date.now() % 1e5}.${text.trim().includes('\n{') ? 'jsonl' : 'json'}`;
    ingest([fileSource(new File([text], name))]);
  };
  $('tr-paste-btn').addEventListener('click', () => { $('tr-paste').hidden = false; $('tr-paste-text').focus(); });
  $('tr-paste-cancel').addEventListener('click', () => { $('tr-paste').hidden = true; });
  $('tr-paste-go').addEventListener('click', () => {
    const text = $('tr-paste-text').value;
    if (!text.trim()) return;
    ingestText(text);
    $('tr-paste-text').value = '';
    $('tr-paste').hidden = true;
  });
  $('tr-home-link').addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    show('home');
    window.scrollTo(0, 0);
  });

  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { depth++; document.body.classList.add('tr-dragging'); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('tr-dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('tr-dragging');
    if (e.dataTransfer?.files?.length) ingest(await fromDrop(e.dataTransfer));
  });

  $('tr-run-filter').addEventListener('input', (e) => { state.filter = e.target.value; renderHome(); });

  let t;
  $('tr-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 180); });
  $('tr-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); if (state.q !== e.target.value) search(e.target.value); stepHit(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') e.target.blur();
  });
  $('tr-prev').addEventListener('click', () => stepHit(-1));
  $('tr-next').addEventListener('click', () => stepHit(1));
  $('tr-grouped').addEventListener('change', (e) => { state.grouped = e.target.checked; local.set('tr-grouped', state.grouped); state.flipped.clear(); renderTimeline(); });
  $('tr-expand').addEventListener('click', () => {
    const groups = [...document.querySelectorAll('.tr-work')];
    const opening = groups.some((g) => !g.open);
    groups.forEach((g) => { g.open = opening; if (opening) g.fill(); });
    $('tr-expand').textContent = opening ? 'Collapse all' : 'Expand all';
  });

  // Sticky offsets depend on the toolbar's height, which wraps on narrow screens.
  new ResizeObserver(([e]) => document.documentElement.style.setProperty('--tr-tb', `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`)).observe($('tr-toolbar'));

  const map = $('tr-map');
  map.addEventListener('click', (e) => reveal(nearestVisible(mapIndex(e)), { open: false, block: 'start' }));
  map.addEventListener('mousemove', (e) => {
    const ev = events()[mapIndex(e)];
    map.title = ev ? `${ev.step ? `#${ev.step} ` : ''}${KINDS[ev.kind] ?? ev.kind}: ${firstLine(ev.kind === 'plan' ? 'plan update' : head(ev) || ev.text || '', 100)}` : '';
  });
  new ResizeObserver(() => drawMap()).observe(map);
  new MutationObserver(() => drawMap()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawMap);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; trackScroll(); });
  }, { passive: true });

  window.addEventListener('popstate', (e) => route(e.state));

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || $('tr-run').hidden) return;
    if (e.key === '/') { e.preventDefault(); $('tr-q').focus(); $('tr-q').select(); }
    else if (e.key === 'j' || e.key === 'k') jumpBlock(e.key === 'j' ? 1 : -1);
    else if (e.key === 'n' || e.key === 'N') stepHit(e.key === 'n' ? 1 : -1);
    else if (e.key === '[' || e.key === ']') {
      const list = listOf(state.run);
      const i = list.indexOf(state.run) + (e.key === ']' ? 1 : -1);
      if (list[i]) openRun(list[i]);
    }
  });

  // Pasting JSON/JSONL anywhere on the page opens it.
  document.addEventListener('paste', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/^\s*[[{]/.test(text)) return;
    e.preventDefault();
    ingestText(text);
  });
}

function readLibrary() {
  try {
    const { runs, collections } = JSON.parse($('tr-library').textContent);
    state.collections = collections ?? [];
    return runs.map((r) => ({
      ...r, source: 'library',
      json: r.json && urlSource(r.json), stream: r.stream && urlSource(r.stream), notes: r.notes && urlSource(r.notes),
    }));
  } catch { return []; }
}

async function init() {
  wire();
  state.library = readLibrary();
  const urls = new URLSearchParams(location.search).getAll('src').flatMap((s) => s.split(',')).filter(Boolean);
  if (urls.length) await ingest(fromUrls(urls), { source: 'url', open: false });
  else {
    const saved = await recall();
    if (saved.length) await ingest(saved, { save: false, open: false });
  }
  const pos = local.get('tr-pos', null);
  const step = +(/^#s(\d+)$/.exec(location.hash)?.[1] ?? NaN) || undefined;
  const resume = (r) => ({ push: false, step, at: !step && pos?.key === r.key ? pos.i : undefined });
  const initial = document.querySelector('.tr').dataset.initial;
  const libRun = initial && state.library.find((r) => r.key === initial);
  // A reload keeps history.state, so a locally opened run comes back where it was.
  const localRun = history.state?.local && state.local.find((r) => r.key === history.state.local);
  if (libRun) return openRun(libRun, resume(libRun));
  if (localRun) return openRun(localRun, resume(localRun));
  if (urls.length && state.local.length === 1) return openRun(state.local[0], resume(state.local[0]));
  show('home', { push: false });
}

init();
