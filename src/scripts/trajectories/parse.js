// Turns agent event streams (JSONL) and run summaries (JSON) into one event list the reader renders.
// Pure functions only, so this file also runs under Node for checking against real runs.
//
// Event kinds:
//   user {text, role}       message {text}         reasoning {text}
//   command {cmd, out, exit, failed, status}       tool {name, server, input, out, failed, status}
//   files {changes}         plan {items}           error {text, transient}
//   log {lines}             raw {title, obj}       marker {text}

export const KINDS = {
  user: 'prompts',
  message: 'messages',
  reasoning: 'reasoning',
  command: 'commands',
  tool: 'tool calls',
  files: 'file edits',
  plan: 'plans',
  error: 'errors',
  log: 'logs',
  raw: 'other',
};
// Kinds that are agent actions; they get step numbers and fold into "work" groups.
export const ACTIONS = new Set(['command', 'tool', 'files']);

export function readLines(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;
    const c = line.trimStart()[0];
    if (c === '{' || c === '[') {
      try { out.push({ n: i + 1, obj: JSON.parse(line) }); continue; } catch {}
    }
    out.push({ n: i + 1, text: line });
  }
  return out;
}

const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const blocksText = (c) =>
  typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b.type === 'image' || b.type === 'image_url' ? '[image]' : b.text ?? b.content ?? str(b))).join('\n')
  : str(c);

function addUsage(a, b) {
  if (!b) return a;
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
  return out;
}

// `/bin/bash -lc '…'` wrappers hide the command the model actually wrote.
export function unwrapShell(cmd) {
  if (Array.isArray(cmd)) cmd = cmd.length === 3 && /sh$/.test(cmd[0]) && /^-l?c$/.test(cmd[1]) ? cmd[2] : cmd.join(' ');
  cmd = str(cmd);
  let m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+'([\s\S]*)'\s*$/.exec(cmd);
  if (m) return m[1].replace(/'\\''/g, "'");
  m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+"([\s\S]*)"\s*$/.exec(cmd);
  if (m) return m[1].replace(/\\(["\\$`])/g, '$1');
  return cmd;
}

// ---- format detection -------------------------------------------------------

const DETECT = {
  codex: (o) => o.type === 'thread.started' || o.type === 'turn.started' || o.type === 'turn.completed' || (typeof o.type === 'string' && o.type.startsWith('item.') && o.item),
  claude: (o) => (o.type === 'system' && o.subtype) || ((o.type === 'assistant' || o.type === 'user') && o.message) || (o.type === 'result' && 'is_error' in o) || o.type === 'tool_call' || (o.type === 'thinking' && o.subtype),
  antigravity: (o) => o.type === 'conversation' || (o.type === 'step' && o.kind),
  chat: (o) => typeof o.role === 'string' && ('content' in o || 'tool_calls' in o),
};

export function detect(lines) {
  const votes = { codex: 0, claude: 0, antigravity: 0, chat: 0 };
  let seen = 0;
  for (const l of lines) {
    if (!l.obj || typeof l.obj !== 'object' || Array.isArray(l.obj)) continue;
    for (const [k, f] of Object.entries(DETECT)) if (f(l.obj)) votes[k]++;
    if (++seen >= 400) break;
  }
  const [best, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : 'raw';
}

export const FORMAT_LABEL = { codex: 'Codex CLI', claude: 'Claude Code', cursor: 'Cursor', antigravity: 'Antigravity', chat: 'chat messages', raw: 'unrecognised' };

// Parses JSONL text (or a JSON array / {messages}) into {events, meta}.
export function parseStream(text) {
  let lines;
  const t = text.trimStart();
  if (t[0] === '[' || t[0] === '{') {
    // A whole-file JSON document rather than JSONL.
    try {
      const doc = JSON.parse(text);
      const arr = Array.isArray(doc) ? doc : Array.isArray(doc.messages) ? doc.messages : Array.isArray(doc.events) ? doc.events : null;
      if (arr) lines = arr.map((obj, i) => ({ n: i + 1, obj }));
    } catch {}
  }
  lines ??= readLines(text);
  const format = detect(lines);
  const { events, meta } = ADAPTERS[format](lines);
  if (format === 'claude' && lines.some((l) => l.obj?.type === 'tool_call' || l.obj?.type === 'thinking')) meta.format = 'cursor';
  meta.format ??= format;
  number(events);
  return { events, meta };
}

function number(events) {
  let step = 0;
  events.forEach((e, i) => {
    e.i = i;
    if (ACTIONS.has(e.kind)) e.step = ++step;
  });
}

function pushLog(ev, text) {
  const last = ev.at(-1);
  if (last?.kind === 'log') last.lines.push(text);
  else ev.push({ kind: 'log', lines: [text] });
}

const rawTitle = (o) => str(o.type ?? o.event ?? o.kind ?? o.role ?? Object.keys(o)[0] ?? 'event');

// ---- Codex CLI (`codex exec --json`) ---------------------------------------

function codexItem(it) {
  switch (it.type) {
    case 'agent_message': return { kind: 'message', text: str(it.text) };
    case 'reasoning': return { kind: 'reasoning', text: str(it.text) };
    case 'command_execution': return {
      kind: 'command', cmd: unwrapShell(it.command), out: str(it.aggregated_output), exit: it.exit_code ?? null, status: it.status,
      failed: it.status === 'failed' || (it.exit_code != null && it.exit_code !== 0),
    };
    case 'mcp_tool_call': {
      const err = it.error?.message ?? (it.error ? str(it.error) : null);
      const out = it.result?.content ? blocksText(it.result.content) : it.result?.structured_content ? str(it.result.structured_content) : '';
      return { kind: 'tool', server: it.server, name: it.tool, input: it.arguments, out: err ?? out, failed: !!err || it.status === 'failed', status: it.status };
    }
    case 'web_search': return { kind: 'tool', name: 'web_search', input: { query: it.query }, out: '', status: it.status };
    case 'file_change': return { kind: 'files', changes: (it.changes ?? []).map((c) => ({ path: c.path, kind: c.kind, diff: c.diff ?? c.unified_diff })), status: it.status, failed: it.status === 'failed' };
    case 'error': return { kind: 'error', text: str(it.message) };
    default: return { kind: 'raw', title: `item: ${it.type}`, obj: it };
  }
}

function codex(lines) {
  const ev = [], meta = {}, byId = new Map();
  let turn = 0, lastPlan = '';
  for (const l of lines) {
    if (l.text != null) { pushLog(ev, l.text); continue; }
    const o = l.obj, t = o.type;
    if (t === 'thread.started') { meta.session = o.thread_id; continue; }
    if (t === 'turn.started') { if (++turn > 1) ev.push({ kind: 'marker', text: `turn ${turn}` }); continue; }
    if (t === 'turn.completed') { meta.usage = addUsage(meta.usage, o.usage); meta.completed = true; continue; }
    if (t === 'turn.failed') { ev.push({ kind: 'error', text: o.error?.message ?? str(o.error) }); meta.failed = true; continue; }
    if (t === 'error') { ev.push({ kind: 'error', text: str(o.message), transient: /^Reconnecting/i.test(o.message ?? '') }); continue; }
    if (t?.startsWith('item.') && o.item) {
      const it = o.item;
      if (it.type === 'todo_list') {
        const key = JSON.stringify(it.items);
        if (key !== lastPlan) ev.push({ kind: 'plan', items: (it.items ?? []).map((x) => ({ text: x.text, done: !!x.completed })), line: l.n });
        lastPlan = key;
        continue;
      }
      const id = `${turn}:${it.id}`;
      const e = codexItem(it);
      const prev = it.id != null && byId.get(id);
      if (prev) Object.assign(prev, e);
      else { e.line = l.n; ev.push(e); if (it.id != null) byId.set(id, e); }
      continue;
    }
    ev.push({ kind: 'raw', title: rawTitle(o), obj: o, line: l.n });
  }
  // Started but never completed: the run ended (or was killed) mid-step.
  for (const e of byId.values()) if (e.status === 'in_progress') e.unfinished = true;
  return { events: ev, meta };
}

// ---- Claude Code / Cursor (`--output-format stream-json`) ------------------

const SHELL_TOOLS = new Set(['Bash', 'bash', 'shell', 'run_shell_command', 'run_command', 'exec_command']);

function claudeToolUse(b) {
  const input = b.input ?? {};
  if (SHELL_TOOLS.has(b.name) && typeof (input.command ?? input.cmd) === 'string') return { kind: 'command', cmd: unwrapShell(input.command ?? input.cmd), note: input.description, out: '', exit: null };
  const m = /^mcp__(.+?)__(.+)$/.exec(b.name ?? '');
  return m ? { kind: 'tool', server: m[1], name: m[2], input, out: '' } : { kind: 'tool', name: b.name, input, out: '' };
}

function cursorTool(tc) {
  const [kind, call] = Object.entries(tc ?? {}).find(([k]) => k.endsWith('ToolCall')) ?? [];
  if (!kind) return { kind: 'raw', title: 'tool_call', obj: tc };
  const args = call?.args ?? {};
  const r = call?.result;
  const ok = r?.success, bad = r?.error ?? r?.failure ?? r?.rejected;
  const resText = (x) => (x == null ? '' : typeof x === 'string' ? x : Array.isArray(x.content) ? x.content.map((c) => c.text?.text ?? c.text ?? str(c)).join('\n') : typeof x.content === 'string' ? x.content : str(x));
  if (kind === 'shellToolCall') {
    const out = ok ? [ok.stdout, ok.stderr].filter(Boolean).join('\n') || resText(ok) : bad ? resText(bad) : '';
    const exit = ok?.exitCode ?? ok?.exit_code ?? null;
    return { kind: 'command', cmd: unwrapShell(args.command ?? ''), out, exit, failed: !!bad || (exit != null && exit !== 0), done: !!r };
  }
  if (kind === 'mcpToolCall') return { kind: 'tool', server: args.providerIdentifier ?? args.serverIdentifier, name: args.toolName ?? args.name, input: args.args ?? {}, out: ok ? resText(ok) : bad ? resText(bad) : '', failed: !!bad, done: !!r };
  if (/^(edit|write|delete|applyPatch)/.test(kind) && args.path) return { kind: 'files', changes: [{ path: args.path, kind: kind.replace(/ToolCall$/, ''), diff: ok?.diffString ?? ok?.diff }], failed: !!bad, done: !!r };
  const { toolCallId, ...input } = args;
  return { kind: 'tool', name: kind.replace(/ToolCall$/, ''), input, out: ok ? resText(ok) : bad ? resText(bad) : '', failed: !!bad, done: !!r };
}

function claude(lines) {
  const ev = [], meta = {}, tools = new Map(), cursorCalls = new Map();
  let thinking = null; // Cursor streams thinking as deltas
  for (const l of lines) {
    if (l.text != null) { pushLog(ev, l.text); continue; }
    const o = l.obj, t = o.type;
    const sub = o.parent_tool_use_id ? { sub: true } : {};
    if (t === 'system') {
      if (o.subtype === 'init') Object.assign(meta, { model: meta.model ?? o.model, session: o.session_id, cwd: o.cwd, version: o.claude_code_version, tools: o.tools });
      else if (o.subtype === 'compact_boundary') ev.push({ kind: 'marker', text: 'context compacted' });
      continue;
    }
    if (t === 'thinking') {
      if (o.subtype === 'delta') {
        if (!thinking) { thinking = { kind: 'reasoning', text: '', line: l.n }; ev.push(thinking); }
        thinking.text += o.text ?? '';
      } else thinking = null;
      continue;
    }
    thinking = null;
    if (t === 'assistant' && o.message) {
      meta.model ??= o.message.model;
      const content = typeof o.message.content === 'string' ? [{ type: 'text', text: o.message.content }] : o.message.content ?? [];
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) ev.push({ kind: 'message', text: b.text, line: l.n, ...sub });
        else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          if (b.thinking?.trim()) ev.push({ kind: 'reasoning', text: b.thinking, line: l.n, ...sub });
          else meta.hiddenThinking = (meta.hiddenThinking ?? 0) + 1;
        } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const e = { ...claudeToolUse(b), status: 'in_progress', line: l.n, ...sub };
          ev.push(e);
          tools.set(b.id, e);
        }
      }
      continue;
    }
    if (t === 'user' && o.message) {
      const content = typeof o.message.content === 'string' ? [{ type: 'text', text: o.message.content }] : o.message.content ?? [];
      for (const b of content) {
        if (b.type === 'tool_result') {
          const e = tools.get(b.tool_use_id);
          const text = blocksText(b.content);
          if (e) Object.assign(e, { out: text, failed: !!b.is_error, status: 'completed' });
          else ev.push({ kind: 'tool', name: 'tool result', input: null, out: text, failed: !!b.is_error, line: l.n });
        } else if (b.type === 'text' && b.text?.trim()) ev.push({ kind: 'user', role: o.isMeta ? 'system' : 'user', text: b.text, line: l.n, ...sub });
      }
      continue;
    }
    if (t === 'tool_call') {
      const id = o.call_id ?? o.tool_call?.toolCallId;
      const e = cursorTool(o.tool_call);
      const prev = cursorCalls.get(id);
      if (prev) Object.assign(prev, e);
      else { e.line = l.n; ev.push(e); cursorCalls.set(id, e); }
      continue;
    }
    if (t === 'result') {
      Object.assign(meta, { result: o.result, cost: o.total_cost_usd, durationMs: o.duration_ms, turns: o.num_turns, usage: o.usage, completed: !o.is_error });
      if (o.is_error) ev.push({ kind: 'error', text: str(o.result ?? o.subtype), line: l.n });
      continue;
    }
    if (t === 'rate_limit_event' || t === 'stream_event') continue;
    ev.push({ kind: 'raw', title: rawTitle(o), obj: o, line: l.n });
  }
  for (const e of [...tools.values(), ...cursorCalls.values()]) {
    if (e.status === 'in_progress' || e.done === false) e.unfinished = true;
    delete e.done;
  }
  return { events: ev, meta };
}

// ---- Antigravity (steps exported by scripts/puppy-bench) -------------------

function antigravity(lines) {
  const ev = [], meta = {};
  for (const l of lines) {
    if (l.text != null) { pushLog(ev, l.text); continue; }
    const o = l.obj;
    if (o.type === 'conversation') { Object.assign(meta, { session: o.id, model: o.servedModel ?? o.tier }); continue; }
    if (o.type !== 'step') { ev.push({ kind: 'raw', title: rawTitle(o), obj: o, line: l.n }); continue; }
    if (o.kind === 'user') ev.push({ kind: 'user', role: 'user', text: str(o.text), line: l.n });
    else if (o.kind === 'model') {
      if (o.thinking?.trim()) ev.push({ kind: 'reasoning', text: o.thinking.trim(), line: l.n });
      if (o.text?.trim()) ev.push({ kind: 'message', text: o.text.trim(), line: l.n });
      for (const c of o.calls ?? []) {
        let args = {};
        try { args = JSON.parse(c.args); } catch { args = c.args; }
        ev.push(c.name === 'call_mcp_tool'
          ? { kind: 'tool', server: args.ServerName, name: args.ToolName, input: args.Arguments ?? {}, out: '', line: l.n, pending: true }
          : c.name === 'run_command' && args?.CommandLine
            ? { kind: 'command', cmd: args.CommandLine, out: '', exit: null, line: l.n, pending: true }
            : { kind: 'tool', name: c.name, input: args, out: '', line: l.n, pending: true });
      }
    } else if (o.kind === 'tool') {
      const e = ev.findLast((x) => x.pending);
      if (e) { e.out = str(o.result); delete e.pending; }
      else ev.push({ kind: 'tool', name: o.name, input: null, out: str(o.result), line: l.n });
    } else ev.push({ kind: 'raw', title: `step ${o.stepType}`, obj: o, line: l.n });
  }
  for (const e of ev) if (e.pending) { e.unfinished = true; delete e.pending; }
  return { events: ev, meta };
}

// ---- chat messages (OpenAI / Anthropic message lists) ----------------------

function chat(lines) {
  const ev = [], meta = {}, calls = new Map();
  for (const l of lines) {
    if (l.text != null) { pushLog(ev, l.text); continue; }
    const o = l.obj;
    if (typeof o.role !== 'string') { ev.push({ kind: 'raw', title: rawTitle(o), obj: o, line: l.n }); continue; }
    const blocks = typeof o.content === 'string' ? [{ type: 'text', text: o.content }] : Array.isArray(o.content) ? o.content : [];
    if (o.role === 'tool' || o.role === 'function') {
      const e = calls.get(o.tool_call_id ?? o.name);
      const text = blocksText(o.content);
      if (e) e.out = text; else ev.push({ kind: 'tool', name: o.name ?? 'tool result', input: null, out: text, line: l.n });
      continue;
    }
    for (const b of blocks) {
      const text = b.text ?? (typeof b === 'string' ? b : null);
      if (b.type === 'thinking' || b.type === 'reasoning') { if ((b.thinking ?? b.text)?.trim()) ev.push({ kind: 'reasoning', text: b.thinking ?? b.text, line: l.n }); }
      else if (b.type === 'tool_use') { const e = { ...claudeToolUse(b), line: l.n }; ev.push(e); calls.set(b.id, e); }
      else if (b.type === 'tool_result') { const e = calls.get(b.tool_use_id); if (e) Object.assign(e, { out: blocksText(b.content), failed: !!b.is_error }); }
      else if (text?.trim()) ev.push(o.role === 'assistant' ? { kind: 'message', text, line: l.n } : { kind: 'user', role: o.role, text, line: l.n });
    }
    if (o.reasoning_content?.trim?.()) ev.push({ kind: 'reasoning', text: o.reasoning_content, line: l.n });
    for (const c of o.tool_calls ?? []) {
      let input = c.function?.arguments;
      try { input = JSON.parse(input); } catch {}
      const e = { ...claudeToolUse({ name: c.function?.name ?? c.name, input }), line: l.n };
      ev.push(e);
      calls.set(c.id, e);
    }
  }
  return { events: ev, meta };
}

function raw(lines) {
  const ev = [];
  for (const l of lines) {
    if (l.text != null) pushLog(ev, l.text);
    else ev.push({ kind: 'raw', title: Array.isArray(l.obj) ? 'array' : rawTitle(l.obj), obj: l.obj, line: l.n });
  }
  return { events: ev, meta: {} };
}

const ADAPTERS = { codex, claude, antigravity, chat, raw };

// ---- run summaries (the per-run .json) -------------------------------------

const pick = (o, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
    if (v != null && v !== '') return v;
  }
  return undefined;
};

// Is this JSON document a run summary (as opposed to a transcript)?
export function isSummary(doc) {
  return doc && typeof doc === 'object' && !Array.isArray(doc) && !Array.isArray(doc.messages) && !Array.isArray(doc.events) && !('role' in doc);
}

export function summarize(doc) {
  const score = pick(doc, 'result.additional_info.score', 'result.score', 'score');
  const max = pick(doc, 'result.additional_info.max', 'result.max', 'max_score');
  const correct = pick(doc, 'result.correct', 'correct', 'success', 'passed', 'solved');
  const tokens = doc.tokens ?? doc.usage;
  return {
    title: pick(doc, 'binary', 'task', 'task_id', 'challenge', 'problem', 'name', 'id'),
    agent: pick(doc, 'agent_label', 'agent'),
    model: pick(doc, 'model'),
    tier: pick(doc, 'tier'),
    chips: [
      pick(doc, 'agent_label', 'agent'), pick(doc, 'model'), doc.effort && `effort ${doc.effort}`,
      pick(doc, 'tier'), pick(doc, 'problem_type'),
      doc.rounds > 1 && `round ${doc.round_num ?? '?'}/${doc.rounds}`,
      doc.no_internet && 'no internet',
    ].filter(Boolean).map(String),
    correct: typeof correct === 'boolean' ? correct : null,
    score: typeof score === 'number' ? score : null,
    max: typeof max === 'number' ? max : null,
    wall: pick(doc, 'wall_time', 'duration', 'elapsed'),
    maxWall: doc.max_wall_time,
    wallLimit: !!doc.wall_time_limit_reached,
    steps: pick(doc, 'steps_used', 'steps', 'num_turns'),
    maxSteps: doc.max_steps,
    reasoning: doc.reasoning_used,
    tokens: tokens && typeof tokens === 'object' ? tokens : null,
    cost: pick(doc, 'cost_usd', 'cost', 'total_cost_usd'),
    final: pick(doc, 'last_message', 'final_message', 'final_answer', 'answer', 'output'),
    trajectoryFile: pick(doc, 'reasoning_file', 'trajectory_file', 'transcript_file', 'events_file', 'log_file'),
  };
}

// ---- pairing files into runs --------------------------------------------------

export const FILE_EXT = /\.(jsonl|ndjson|json|log|txt)(\.gz)?$/i;
const base = (p) => String(p ?? '').split(/[\\/]/).pop();
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// `x.json` + `x_reasoning.jsonl` (or .jsonl.gz) are one run.
export function runKey(name) {
  return name.replace(/\.gz$/i, '').replace(/\.(jsonl|ndjson|json|log|txt)$/i, '').replace(/[_.-](reasoning|trajectory|transcript|events|stream|rollout|trace|log)$/i, '');
}

// items: [{path, name, doc?}] where `doc` is set on summary files. Used by the build (stored
// runs) and the browser (dropped files), so both pair the same way. Returns runs sorted by key.
export function pairRuns(items, existing = []) {
  const runs = new Map(existing.map((r) => [r.key, r]));
  const keyOf = (path) => [dirOf(path), runKey(base(path))].filter(Boolean).join('/');
  const get = (key) => {
    if (!runs.has(key)) runs.set(key, { key, name: base(key), dir: base(dirOf(key)) });
    return runs.get(key);
  };
  const streams = items.filter((x) => !x.doc);
  const claimed = new Set();
  for (const s of items.filter((x) => x.doc)) {
    const run = get(keyOf(s.path));
    Object.assign(run, { json: s, doc: s.doc, sum: summarize(s.doc) });
    // A summary that names its trajectory file wins over name-based pairing.
    const want = base(run.sum.trajectoryFile);
    const match = want && streams.find((x) => x.name.replace(/\.gz$/i, '') === want && dirOf(x.path) === dirOf(s.path));
    if (match) { run.stream = match; delete run.parsed; claimed.add(match); }
  }
  for (const s of streams) {
    if (claimed.has(s)) continue;
    const run = get(keyOf(s.path));
    if (run.stream && run.stream.name !== s.name) get(`${keyOf(s.path)} (${s.name})`).stream = s;
    else { run.stream = s; delete run.parsed; }
  }
  return [...runs.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

// ---- per-run analysis ---------------------------------------------------------

const WRAPPERS = new Set(['timeout', 'env', 'sudo', 'nice', 'nohup', 'time', 'stdbuf', 'command', 'exec', 'unbuffer', 'taskset', 'ionice', 'setsid']);
const NOT_PROGRAMS = new Set(['cd', 'export', 'set', 'source', '.', 'true', 'false', ':', 'unset', 'ulimit', 'trap', 'local', 'pushd', 'popd', 'shopt', 'umask', '[', '[[', 'test']);
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'done', 'fi', 'esac', '}', ')']);
const LOOPS = new Set(['for', 'case', 'select', 'function']);

// The program a shell command runs, past wrappers like `timeout 30s`, `env X=1`, `bash -lc '…'`,
// leading `cd dir &&`, and loop headers.
export function programOf(cmd, depth = 0) {
  cmd = String(cmd ?? '');
  for (const seg of cmd.split(/&&|\|\||;|\||\n/)) {
    const toks = seg.trim().replace(/^[({]\s*/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < toks.length) {
      if (/^[A-Za-z_]\w*=/.test(toks[i]) || KEYWORDS.has(toks[i])) { i++; continue; }
      if (!WRAPPERS.has(toks[i])) break;
      for (i++; i < toks.length && /^(-\S*|\d+(\.\d+)?[smhd]?|0x[\da-f]+|[A-Z]+)$/i.test(toks[i]) && !/^[a-z]/.test(toks[i]); i++);
    }
    const prog = toks[i]?.replace(/^['"]|['"]$/g, '');
    if (!prog || NOT_PROGRAMS.has(prog) || LOOPS.has(prog) || /^[<>&-]|\)$/.test(prog)) continue; // `-d)` is a case pattern
    const name = prog.split('/').pop() || prog;
    // A nested `bash -lc '…'` says nothing; name what it runs instead.
    if (/^(ba|z)?sh$/.test(name) && /^-\w*c$/.test(toks[i + 1] ?? '') && depth < 3) {
      const inner = new RegExp(`${toks[i + 1]}\\s+(['"]?)([\\s\\S]*)`).exec(cmd.slice(cmd.indexOf(seg.trim())));
      if (inner) return programOf(inner[1] ? inner[2].replace(new RegExp(`${inner[1]}\\s*$`), '') : inner[2], depth + 1) ?? name;
    }
    return name;
  }
  return null;
}

const EXIT_MEANING = {
  0: 'ok', 1: 'error', 2: 'usage error', 124: 'timed out', 125: 'timeout failed', 126: 'not executable', 127: 'command not found',
  130: 'interrupted', 134: 'aborted (SIGABRT)', 137: 'killed (SIGKILL)', 139: 'segfault (SIGSEGV)', 141: 'broken pipe', 143: 'terminated (SIGTERM)',
};
export const exitMeaning = (c) => EXIT_MEANING[c] ?? (c > 128 && c < 160 ? `signal ${c - 128}` : 'error');

// Name a step by what it ran: a program for shell commands, server.tool for tool calls.
export const stepTool = (e) =>
  e.kind === 'command' ? programOf(e.cmd) ?? 'shell' : e.kind === 'tool' ? (e.server ? `${e.server}.${e.name}` : e.name) : e.kind === 'files' ? 'file edit' : null;

// Files a step wrote: Codex file changes, Claude Edit/Write calls, and apply_patch headers in commands.
export function editedPaths(e) {
  if (e.kind === 'files') return e.changes.map((c) => c.path).filter(Boolean);
  if (e.kind === 'tool' && e.input && typeof e.input === 'object') {
    const p = e.input.file_path ?? e.input.path ?? e.input.filePath ?? e.input.target_file;
    return /edit|write|patch|create|replace|insert/i.test(e.name ?? '') && typeof p === 'string' ? [p] : [];
  }
  if (e.kind === 'command') return [...new Set([...e.cmd.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim()))];
  return [];
}

export function analyze(events) {
  const steps = events.filter((e) => e.step);
  const tally = () => new Map();
  const tools = tally(), exits = tally(), files = tally();
  const bump = (m, key, failed) => {
    const x = m.get(key) ?? { key, n: 0, failed: 0 };
    x.n++;
    if (failed) x.failed++;
    m.set(key, x);
  };
  let outChars = 0;
  for (const e of steps) {
    bump(tools, stepTool(e), e.failed);
    if (e.kind === 'command' && e.exit != null) bump(exits, e.exit, e.exit !== 0);
    for (const p of editedPaths(e)) bump(files, p, e.failed);
    outChars += (e.out ?? '').length;
  }
  const sorted = (m) => [...m.values()].sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
  return {
    steps: steps.length,
    failed: steps.filter((e) => e.failed).length,
    unfinished: steps.filter((e) => e.unfinished).length,
    messages: events.filter((e) => e.kind === 'message').length,
    tools: sorted(tools),
    exits: sorted(exits).sort((a, b) => (a.key === 0 ? -1 : b.key === 0 ? 1 : b.n - a.n)),
    files: sorted(files),
    outChars,
  };
}
