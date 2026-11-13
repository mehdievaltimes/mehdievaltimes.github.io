"""The agent loop: one model, one bash tool, a context it can edit, and a history it cannot.

A turn, as in the released CLM harness:

1. snapshot the context about to be sent (this is the version history);
2. ask the model for a THOUGHT and one bash command;
3. mirror the editable context to ``/tmp/.live_ctx/LIVE_CTX_MAIN.txt`` and run the command;
4. read the file back; if it changed, parse it into messages again (edit gate: an
   edit that grows the context must still fit the limit);
5. append the model's reply and the tool result, with a size readout and a receipt.

Everything the loop needs to continue is the message list, three counters and the
sandbox directory, all of which are saved per call, so a run can be resumed from
any step with the context changed -- that is counterfactual replay.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ctxvc.ctxfile import messages_tokens, parse_back, render, rendered_text
from ctxvc.store import RunWriter, messages_sha
from ctxvc.sync import provenance_parse_back

from .sandbox import CTX_FILE, Sandbox
from .tasks import Task

READY = "READY_FOR_NEXT_OP"

SYSTEM_PROMPT = """You are a helpful assistant that can interact with a computer.

Your commands run in a separate sandbox machine. Environment notes that may be attached to
this conversation (a working directory, a "scratchpad directory", proxy or account details)
describe a different machine and do NOT apply here: none of those paths exist in the
sandbox, so never use or mention them. Only `/tmp` and the paths named in this prompt exist.

Every reply must contain a THOUGHT section where you explain your reasoning, followed by
EXACTLY ONE bash command in a fenced block (commands chained with `&&`, `||` or `;` count as
one):

THOUGHT: <your reasoning>
```bash
<your command>
```

A reply with no ```bash block is rejected; if you write several, only the first runs.

## Managing your context

**Goal: maximize task success.** Your context budget is {limit} tokens; each result shows your
current size.

Your conversation is mirrored to `{ctx_file}` (refreshed before every command). The CONTEXT
section of each message you receive is exactly that file. **Free up context by editing that
file** -- replace stale regions (big outputs, dead ends, superseded notes) with a concise,
specific summary. A bloated context wastes budget and dulls your reasoning, so compact as it
grows. Whatever the file holds after your command is your context from then on.

**Locate text with code -- never paste or retype it.** Turns are numbered
`[[CTX_TURN 1 role=...]]`, `[[CTX_TURN 2 role=...]]`, ... from the top of the file (the task
text is pinned and is not in the file). Match a turn by its header, or a block by a short
unique first/last line, for example:

    python3 - <<'PY'
    import re; p="{ctx_file}"; s=open(p).read()
    # collapse turn 7 (its header -> the next header) without retyping its body:
    s=re.sub(r"(\\[\\[CTX_TURN 7 [^\\]]*\\]\\]).*?(?=\\n\\[\\[CTX_TURN|\\Z)",
             r"\\1\\n[summary of what turn 7 established]", s, flags=re.S)
    open(p,"w").write(s)
    PY

**Rules:** don't `cat` this file (its text is already in your context). Keep the
`[[CTX_TURN ...]]` header of any turn you keep; a turn left with no text is dropped. Each
result says whether the file changed.
{extra}"""

HISTORY_PROMPT = """
## History (read-only)

Every version of your context is saved automatically, where you cannot change it, and is
mounted read-only at `/ctx_history/`:

- `/ctx_history/transcript.txt` -- every turn you ever received or wrote, in order and
  unedited; blocks start with `[[HIST call=<n> role=<role>]]`;
- `/ctx_history/versions/v<NNNN>.txt` -- your whole context file as it was before call NNNN;
- `/ctx_history/INDEX.txt` -- one line per version.

So removing text from your context does not lose it. Look it up when you need it, e.g.
`grep -m1 -h 'some exact text' /ctx_history/transcript.txt`. To return to an earlier context,
copy that version over the live file:
`cp /ctx_history/versions/v0012.txt {ctx_file}`.
"""


@dataclass
class Config:
    budget: int = 6000
    reserve: int = 600
    history: bool = False          # expose the read-only history to the model
    fold_roles: bool = True        # released behaviour: an edit turns tool turns into user turns
    sync: str = "released"         # "released": trust the headers; "provenance": roles follow origin
    skill: str = ""                # method text appended to the task (e.g. the paper's offload recipe)
    nudges: tuple[float, ...] = (0.5, 0.75, 0.9)
    max_over: int = 3              # consecutive over-limit calls tolerated before the run ends
    max_calls: int = 120
    obs_max_chars: int = 6000
    save_fs: bool = True
    command_timeout: int = 90

    @property
    def limit(self) -> int:
        return self.budget - self.reserve


@dataclass
class State:
    messages: list[dict[str, Any]]
    call: int = 0
    delivered: int = 0
    nudged: list[float] = field(default_factory=list)
    warned: int = 0                # consecutive calls that started over the limit
    terminated_by: str | None = None


# --------------------------------------------------------------- reply parsing
_FENCE_RE = re.compile(r"```(?:bash|sh|shell)?[ \t]*\n(.*?)\n?```", re.S)
_HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def parse_reply(text: str) -> tuple[str, str | None]:
    """Split a reply into (thought, command). ``command`` is None when there is no block."""
    m = _FENCE_RE.search(text or "")
    if not m:
        return (text or "").strip(), None
    thought = text[: m.start()].strip()
    thought = re.sub(r"^THOUGHT:\s*", "", thought)
    return thought, m.group(1).strip()


def _statements(command: str) -> list[str]:
    """Shell statements of a command: heredoc bodies dropped, split on ; && || newline
    outside quotes."""
    lines, out, i = command.split("\n"), [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        i += 1
        for _q, word in _HEREDOC_RE.findall(line):
            while i < len(lines) and lines[i].strip() != word:
                i += 1
            i += 1
    text = "\n".join(out)
    segs, buf, quote, k = [], [], None, 0
    while k < len(text):
        c = text[k]
        if quote:
            buf.append(c)
            if c == "\\" and quote == '"' and k + 1 < len(text):
                buf.append(text[k + 1]); k += 2; continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c; buf.append(c)
        elif c in ";\n":
            segs.append("".join(buf)); buf = []
        elif text.startswith("&&", k) or text.startswith("||", k):
            segs.append("".join(buf)); buf = []; k += 1
        else:
            buf.append(c)
        k += 1
    segs.append("".join(buf))
    return segs


_READY_STMT = re.compile(rf"""^\s*echo\s+['"]?{READY}['"]?\s*$""")


def is_ready_command(command: str, exit_code: int) -> bool:
    return bool(command) and exit_code == 0 and any(_READY_STMT.match(s) for s in _statements(command))


# -------------------------------------------------------------------- the loop
class Episode:
    def __init__(self, task: Task, cfg: Config, llm: Any, run_dir: Path | str, sandbox_root: Path | str,
                 *, meta: dict[str, Any] | None = None, start: State | None = None,
                 fs_tar: Path | str | None = None, transcript: list[tuple[int, str, str]] | None = None,
                 forced: dict[int, str] | None = None, action_hook: Any = None):
        """``start``/``fs_tar``/``transcript`` resume from a saved step (replay).
        ``forced`` maps a call index to the reply to use instead of asking the model.
        ``action_hook(call, reply_text) -> reply_text`` may rewrite a model reply before it runs."""
        self.task, self.cfg, self.llm = task, cfg, llm
        self.forced = dict(forced or {})
        self.action_hook = action_hook
        self.resumed = start is not None
        self.sandbox = Sandbox(sandbox_root)
        extra = HISTORY_PROMPT.format(ctx_file=CTX_FILE) if cfg.history else ""
        self.system = SYSTEM_PROMPT.format(limit=cfg.limit, ctx_file=CTX_FILE, extra=extra)
        self.instruction = task.instruction_with(cfg.skill)
        self.transcript: list[tuple[int, str, str]] = list(transcript or [])   # (call, role, text)
        if start is None:
            for rel, content in task.files.items():
                self.sandbox.put_file(rel, content)
            msgs = [{"role": "system", "content": self.system},
                    {"role": "user", "content": self.instruction}]
            self.state = State(messages=msgs)
            self._deliver_next(-1, [])
        else:
            self.state = start
            if fs_tar is not None:
                self.sandbox.restore(fs_tar)
        m = {"task": task.name, "family": task.family, "protect": 2, "model": getattr(llm, "model", "?"),
             "config": asdict(cfg), "limit": cfg.limit, "start_call": self.state.call}
        m.update(meta or {})
        self.writer = RunWriter(run_dir, m)
        self.cost = 0.0

    # ----------------------------------------------------------------- pieces
    def _tokens(self) -> int:
        return messages_tokens(self.state.messages[1:])       # the system prompt is not charged

    def _deliver_next(self, call: int, writers: list[str]) -> bool:
        s = self.state
        if s.delivered >= len(self.task.ops):
            return False
        text = self.task.render_op(s.delivered)
        s.messages.append({"role": "user", "content": text})
        self.transcript.append((call, "user", text))
        writers.append("user")
        s.delivered += 1
        return True

    def _render(self) -> str:
        """The context file. Look-alike headers are marked in the model's own turns, and,
        with the provenance read-back, in every turn."""
        roles = ("assistant", "tool", "user") if self.cfg.sync == "provenance" else ("assistant",)
        return render(self.state.messages, protect=2, escape=roles)

    def _prompt(self) -> str:
        s = self.state
        return (f"{self.instruction}\n\n"
                f"---- CONTEXT (live content of {CTX_FILE}; ~{self._tokens()}/{self.cfg.limit} tokens) ----\n"
                f"{self._render()}\n"
                f"---- END OF CONTEXT ----\n\n"
                "Reply with a THOUGHT and exactly one ```bash block.")

    def _export_history(self) -> None:
        s, h = self.state, self.sandbox.hist
        (h / "versions" / f"v{s.call:04d}.txt").write_text(self._render() + "\n", encoding="utf-8")
        with (h / "INDEX.txt").open("a", encoding="utf-8") as fh:
            fh.write(f"v{s.call:04d}  tokens={self._tokens()}  turns={len(s.messages) - 2}\n")
        blocks = [f"[[HIST call={c} role={r}]]\n{t}" for c, r, t in self.transcript]
        (h / "transcript.txt").write_text("\n\n".join(blocks) + "\n", encoding="utf-8")

    def _observation(self, rc: int, out: str, err: str) -> str:
        text = (out + (("\n" + err) if err and out else err)).rstrip()
        n = self.cfg.obs_max_chars
        if len(text) > n:
            half = n // 2
            text = (f"The output of your last command was too long.\n---- HEAD ({half} chars) ----\n"
                    f"{text[:half]}\n---- {len(text) - 2 * half} chars elided ----\n"
                    f"---- TAIL ({half} chars) ----\n{text[-half:]}")
        return f"{text or '(no output)'}\n\n(exit_code={rc})"

    # -------------------------------------------------------------------- run
    def run(self, max_calls: int | None = None) -> State:
        s, cfg, limit = self.state, self.cfg, self.cfg.limit
        stop_at = s.call + (max_calls if max_calls is not None else cfg.max_calls)
        # A resumed context already holds the notices the harness added before that call.
        skip_pre = self.resumed
        while s.terminated_by is None and s.call < stop_at:
            events: list[str] = []
            pre: list[dict[str, Any]] = []
            tokens = self._tokens()
            if skip_pre:
                skip_pre = False
                events.append("resumed")
            elif tokens > limit:
                if s.warned >= cfg.max_over:
                    s.terminated_by = "budget_wall"
                    break
                s.warned += 1
                events.append("over_limit")
                left = cfg.max_over - s.warned
                pre.append({"role": "user", "content":
                            f"[SYSTEM NOTICE] CONTEXT LIMIT: ~{tokens} tokens is over your {limit}-token "
                            f"limit. Your next command must compact {CTX_FILE} to well below the limit"
                            f"{'' if left else ' -- this is the last warning'}, or the run ends."})
            else:
                s.warned = 0
                frac = tokens / limit
                s.nudged = [r for r in s.nudged if frac >= r]          # re-arm after shrinking
                for r in cfg.nudges:
                    if frac >= r and r not in s.nudged:
                        s.nudged.append(r)
                        events.append(f"nudge_{int(r * 100)}")
                        pre.append({"role": "user", "content":
                                    f"[SYSTEM NOTICE] Context is at ~{int(frac * 100)}% of your budget "
                                    f"(~{tokens}/{limit} tokens). Compact {CTX_FILE} before it fills."})
                        break
            for m in pre:
                s.messages.append(m)
                self.transcript.append((s.call - 1, "user", m["content"]))

            if cfg.save_fs:
                self.sandbox.save(self.writer.dir / "fs" / f"call-{s.call:04d}.tar")
            sha = self.writer.snapshot(s.call, s.messages, tokens=self._tokens())
            if cfg.history:
                self._export_history()
            state_before = {"delivered": s.delivered, "nudged": list(s.nudged), "warned": s.warned}

            source, raw_model = "model", None
            if s.call in self.forced:
                reply = {"text": self.forced[s.call], "cost_usd": 0.0, "model": "forced"}
                source = "forced"
            else:
                reply = self.llm.complete(self.system, self._prompt())
                if self.action_hook is not None:
                    changed = self.action_hook(s.call, reply["text"])
                    if changed != reply["text"]:
                        raw_model, source = reply["text"], "hooked"
                        reply = dict(reply, text=changed)
            self.cost += reply.get("cost_usd") or 0.0
            text = reply["text"]
            thought, command = parse_reply(text)
            rec: dict[str, Any] = {
                "call": s.call, "ctx_in": sha, "tokens_in": self._tokens(), "state": state_before,
                "pre_writers": ["harness"] * len(pre), "thought": thought, "command": command,
                "raw": text, "reply_source": source, "raw_model": raw_model, "events": events,
                "usage": {k: reply.get(k) for k in ("input_tokens", "output_tokens", "cost_usd", "model")},
                "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            writers: list[str] = []
            assistant = {"role": "assistant", "content": text}

            if command is None:
                note = ("(No ```bash block in your last reply. Reply with a THOUGHT and exactly one "
                        "```bash block.)")
                s.messages += [assistant, {"role": "user", "content": note}]
                self.transcript += [(s.call, "assistant", text), (s.call, "user", note)]
                writers += ["model", "harness"]
                rec.update(exit_code=None, observation="", n_appended=2, writers=writers)
                self.writer.step(rec)
                s.call += 1
                continue

            rendered = self._render()
            self.sandbox.write_ctx(rendered)
            before = self._tokens()
            rc, out, err = self.sandbox.exec(command, timeout=cfg.command_timeout)
            read_back = self.sandbox.read_ctx()
            note = ""
            edit: dict[str, Any] | None = None
            if read_back is not None and read_back.strip() != rendered.strip():
                if cfg.sync == "provenance":
                    cand = provenance_parse_back(s.messages, read_back, protect=2)
                else:
                    cand = parse_back(read_back, s.messages[:2], fold_roles=cfg.fold_roles)
                after = messages_tokens(cand[1:])
                if after > before and after > limit:
                    note = (f"\n[LIVE_CTX_MAIN.txt: edit REJECTED -- it GREW context ~{before}->{after} "
                            f"tokens, over the {limit}-token limit, so it was NOT applied.]")
                    edit = {"applied": False, "before": before, "after": after}
                else:
                    s.messages[:] = cand
                    note = (f"\n[LIVE_CTX_MAIN.txt: edit applied -- context ~{before}->{after} tokens, "
                            f"{len(cand) - 2} turns]")
                    edit = {"applied": True, "before": before, "after": after}
                    events.append("edit")
            elif "LIVE_CTX_MAIN" in command:
                note = (f"\n[LIVE_CTX_MAIN.txt: NO change -- your edit matched nothing"
                        f"{'' if rc == 0 else f' (exit {rc})'}, context is still ~{before} tokens.]")

            obs = self._observation(rc, out, err)
            s.messages.append(assistant)
            tool = {"role": "tool", "content": obs}
            s.messages.append(tool)
            tool["content"] = obs + f"\n[context: ~{self._tokens()}/{limit} tokens]" + note
            # what the harness itself wrote at the end of the tool result: blank, exit code, readout, receipt
            harness_tail = 3 + note.count("\n")
            self.transcript += [(s.call, "assistant", text), (s.call, "tool", tool["content"])]
            writers += ["model", "tool"]

            if is_ready_command(command, rc):
                if not self._deliver_next(s.call, writers):
                    s.terminated_by = "stream_exhausted"
            elif READY in command and rc == 0:
                msg = (f"[{READY} did NOT advance: it must be a standalone statement "
                       f"(`echo {READY}` on its own or after `;` / `&&`).]")
                s.messages.append({"role": "user", "content": msg})
                self.transcript.append((s.call, "user", msg))
                writers.append("harness")

            rec.update(exit_code=rc, observation=tool["content"], edit=edit,
                       n_appended=len(writers), writers=writers, harness_tail=harness_tail)
            self.writer.step(rec)
            s.call += 1

        if s.terminated_by is None:
            s.terminated_by = "max_calls"
        self.writer.snapshot(s.call, s.messages, kind="final", tokens=self._tokens())
        return s


def editable_text(messages: list[dict[str, Any]]) -> str:
    return "\n".join(rendered_text(m) for m in messages[2:])
