"""Turn a sequence of context snapshots into a history with per-line provenance.

For every LM call ``c`` the harness saved the exact context it sent. Comparing
snapshot ``c`` with snapshot ``c+1`` tells us what that call did:

* **append**  the context only grew: the model's reply, the tool output, and
  whatever the harness or the user added;
* **edit**    the model's command rewrote the context file, so earlier text was
  deleted, moved or replaced;
* **rollback** the harness dropped the newest turns.

While walking the snapshots we give every line an *origin*: the call after which
it entered the context, and who wrote it (``user``, ``tool``, ``model``,
``harness``, or ``edit`` for text a context edit wrote). A line that survives an
edit keeps its origin no matter which role label it ends up under. A line an edit
wrote also gets ``derived`` links to the earlier lines it shares rare words with,
so a note that paraphrases a tool output still points back at that tool output.

Origins of appended text are exact. Links for edit-written text are lexical
overlap, a heuristic: good at catching copied identifiers, values and
instructions, blind to a paraphrase that shares no rare word.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from .ctxfile import est_tokens, rendered_text
from .store import Run

#: Lines the harness writes into a turn. Used when a run has no sidecar to say so.
HARNESS_LINE_RE = re.compile(
    r"^\[(context: ~|LIVE_CTX_MAIN\.txt:|SYSTEM NOTICE\]|submit ignored|history:)"
    r"|^\(No tool call in your last turn"
    r"|^\(exit_code=-?\d+\)$"
)
_WORD_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_\-./:#@]*[A-Za-z0-9_]|[A-Za-z0-9_]{3,}")
_MIN_MOVE_CHARS = 12


@dataclass(frozen=True)
class Origin:
    id: int
    step: int      # LM call after which the text entered the context (-1: before the first call)
    writer: str    # user | tool | model | harness | edit
    role: str      # role of the turn it arrived in

    def label(self) -> str:
        return f"{self.writer}@{self.step}"


@dataclass
class Line:
    text: str
    msg: int                       # index of the message that holds it
    role: str                      # role label it currently sits under
    origin: int                    # Origin.id
    derived: tuple[tuple[int, float], ...] = ()   # (origin id, overlap) for edit-written lines


@dataclass
class Version:
    call: int
    kind: str
    lines: list[Line]
    n_messages: int

    @property
    def tokens(self) -> int:
        return sum(est_tokens(l.text) for l in self.lines)

    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)


@dataclass
class Transition:
    call: int
    kind: str                                  # append | edit | rollback
    thought: str = ""
    command: str = ""
    exit_code: int | None = None
    observation: str = ""
    events: list[str] = field(default_factory=list)
    removed: list[Line] = field(default_factory=list)      # lines of the old version that are gone
    written: list[Line] = field(default_factory=list)      # lines the edit wrote
    moved: int = 0
    appended: list[Line] = field(default_factory=list)
    relabeled: list[tuple[Line, str]] = field(default_factory=list)  # (old line, new role)
    tokens_before: int = 0
    tokens_after: int = 0


def _words(text: str) -> list[str]:
    return [w.lower() for w in _WORD_RE.findall(text) if len(w) >= 3]


def _flatten(messages: list[dict[str, Any]], start: int, protect: int) -> list[tuple[int, str, str]]:
    out: list[tuple[int, str, str]] = []
    for i in range(max(start, protect), len(messages)):
        m = messages[i]
        role = str(m.get("role", "user"))
        for text in rendered_text(m).split("\n"):
            out.append((i, role, text))
    return out


def _appended_count(a: list[dict], b: list[dict], rec: dict | None, protect: int) -> int:
    """How many messages at the tail of ``b`` were appended after call (not edited base)."""
    if rec is not None and rec.get("n_appended") is not None:
        return min(int(rec["n_appended"]), max(len(b) - protect, 0))
    ra = [(m.get("role"), rendered_text(m)) for m in a]
    rb = [(m.get("role"), rendered_text(m)) for m in b]
    if len(b) >= len(a) and rb[: len(a)] == ra:
        return len(b) - len(a)
    # After an edit the base is plain role+text; only this call's reply still carries
    # a structured tool call.
    for i in range(len(b) - 1, protect - 1, -1):
        if b[i].get("role") == "assistant" and b[i].get("tool_calls"):
            return len(b) - i
    for i in range(len(b) - 1, protect - 1, -1):
        if b[i].get("role") == "assistant":
            return len(b) - i
    return 0


class History:
    """Versions, transitions and origins of one run."""

    def __init__(self, run: Run):
        self.run = run
        self.protect = run.protect
        self.origins: list[Origin] = []
        self.versions: list[Version] = []
        self.transitions: list[Transition] = []
        self._build()

    # ------------------------------------------------------------------ build
    def _origin(self, step: int, writer: str, role: str) -> int:
        o = Origin(len(self.origins), step, writer, role)
        self.origins.append(o)
        return o.id

    def _fresh_lines(self, messages: list[dict], start: int, step: int,
                     writers: list[str] | None, harness_tail: int | None = None) -> list[Line]:
        """Lines of newly appended messages, each message with its own origin.

        Who wrote a message comes from the sidecar when there is one. What the harness
        added at the end of a tool result (exit code, size readout, edit receipt) is
        ``harness_tail`` lines, also from the sidecar. Without a sidecar those are
        guessed from their wording, but only at the very end of a tool result: a line
        in the middle of a tool output that imitates a harness notice stays tool text.
        """
        lines: list[Line] = []
        for k, i in enumerate(range(max(start, self.protect), len(messages))):
            m = messages[i]
            role = str(m.get("role", "user"))
            body = rendered_text(m).split("\n")
            if writers and k < len(writers):
                writer = writers[k]
            else:
                writer = {"assistant": "model", "tool": "tool"}.get(role, "user")
                if writer == "user" and HARNESS_LINE_RE.match(body[0].lstrip()):
                    writer = "harness"                      # inferred: no sidecar
            oid = self._origin(step, writer, role)
            n_tail = 0
            if writer == "tool":
                if harness_tail is not None:
                    n_tail = min(harness_tail, len(body))
                else:
                    while n_tail < len(body) and (not body[-1 - n_tail].strip()
                                                  or HARNESS_LINE_RE.match(body[-1 - n_tail])):
                        n_tail += 1
            hid = self._origin(step, "harness", role) if n_tail else None
            for j, text in enumerate(body):
                lines.append(Line(text, i, role, hid if (hid is not None and j >= len(body) - n_tail) else oid))
        return lines

    def _build(self) -> None:
        snaps = self.run.snapshots
        if not snaps:
            return
        first = snaps[0]["messages"]
        self.versions.append(Version(
            call=int(snaps[0].get("step", 0)), kind=str(snaps[0].get("kind") or "agent"),
            lines=self._fresh_lines(first, self.protect, -1, None), n_messages=len(first)))

        for n in range(len(snaps) - 1):
            a, b = snaps[n]["messages"], snaps[n + 1]["messages"]
            call = int(snaps[n].get("step", n))
            rec = self.run.step_record(call)
            # Messages the harness added just before the NEXT call (nudges, notices) are in
            # the next snapshot too; the next call's record says how many.
            nxt = self.run.step_record(int(snaps[n + 1].get("step", n + 1)))
            pre = list((nxt or {}).get("pre_writers") or [])
            if rec is not None and rec.get("n_appended") is not None:
                rec = dict(rec, n_appended=int(rec["n_appended"]) + len(pre),
                           writers=list(rec.get("writers") or []) + pre)
            n_new = _appended_count(a, b, rec, self.protect)
            base_end = len(b) - n_new
            prev = self.versions[-1]
            tr = Transition(call=call, kind="append", tokens_before=prev.tokens)

            base_flat = _flatten(b[:base_end], self.protect, self.protect)
            new_lines = self._carry(prev.lines, base_flat, call, tr)
            if tr.removed or tr.written or tr.moved:
                tr.kind = "rollback" if rec and "rollback" in (rec.get("events") or []) else "edit"
            appended = self._fresh_lines(b, base_end, call, (rec or {}).get("writers"),
                                         (rec or {}).get("harness_tail"))
            tr.appended = appended
            new_lines.extend(appended)

            if rec is not None:
                tr.thought = rec.get("thought") or ""
                tr.command = rec.get("command") or ""
                tr.exit_code = rec.get("exit_code")
                tr.observation = rec.get("observation") or ""
                tr.events = list(rec.get("events") or [])
            else:
                self._infer_action(b[base_end:], tr)

            ver = Version(call=int(snaps[n + 1].get("step", n + 1)),
                          kind=str(snaps[n + 1].get("kind") or "agent"),
                          lines=new_lines, n_messages=len(b))
            tr.tokens_after = ver.tokens
            self.versions.append(ver)
            self.transitions.append(tr)

    @staticmethod
    def _infer_action(tail: list[dict], tr: Transition) -> None:
        for m in tail:
            if m.get("role") == "assistant" and not tr.thought and not tr.command:
                parts = [p for p in (m.get("reasoning_content"), m.get("content")) if isinstance(p, str) and p]
                tr.thought = "\n".join(parts)
                for tc in m.get("tool_calls") or []:
                    args = ((tc or {}).get("function") or {}).get("arguments")
                    if isinstance(args, str):
                        try:
                            import json
                            args = json.loads(args)
                        except Exception:
                            args = {"command": args}
                    if isinstance(args, dict):
                        tr.command = str(args.get("command") or "")
                    break
            elif m.get("role") == "tool" and not tr.observation:
                tr.observation = rendered_text(m)

    def _carry(self, old: list[Line], base_flat: list[tuple[int, str, str]],
               call: int, tr: Transition) -> list[Line]:
        """Blame for the (possibly edited) base of the next version."""
        old_texts = [l.text for l in old]
        new_texts = [t for _, _, t in base_flat]
        out: list[Line | None] = [None] * len(base_flat)

        def keep(j: int, src: Line) -> None:
            mi, role, text = base_flat[j]
            if role != src.role and text.strip():
                tr.relabeled.append((src, role))
            out[j] = Line(text, mi, role, src.origin, src.derived)

        if old_texts == new_texts:
            for j, src in enumerate(old):
                keep(j, src)
            return [l for l in out if l is not None]

        sm = SequenceMatcher(None, old_texts, new_texts, autojunk=False)
        gone: list[int] = []       # old indices not matched in place
        fresh: list[int] = []      # new indices not matched in place
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    keep(j1 + k, old[i1 + k])
            else:
                gone.extend(range(i1, i2))
                fresh.extend(range(j1, j2))

        # Moves and copies: a new line whose exact text existed before keeps that origin.
        pool: dict[str, list[int]] = defaultdict(list)
        for i in gone:
            pool[old_texts[i]].append(i)
        anywhere: dict[str, int] = {}
        for i, t in enumerate(old_texts):
            anywhere.setdefault(t, i)
        reused: set[int] = set()
        still_fresh: list[int] = []
        for j in fresh:
            text = new_texts[j]
            if len(text.strip()) >= _MIN_MOVE_CHARS:
                if pool.get(text):
                    i = pool[text].pop(0)
                    reused.add(i)
                    keep(j, old[i])
                    tr.moved += 1
                    continue
                if text in anywhere:
                    keep(j, old[anywhere[text]])
                    tr.moved += 1
                    continue
            still_fresh.append(j)

        tr.removed = [old[i] for i in gone if i not in reused and old[i].text.strip()]

        if still_fresh:
            oid = self._origin(call, "edit", "")
            index = _OverlapIndex(old)
            for j in still_fresh:
                mi, role, text = base_flat[j]
                line = Line(text, mi, role, oid, index.sources(text))
                out[j] = line
                if text.strip():
                    tr.written.append(line)
        return [l for l in out if l is not None]

    # ---------------------------------------------------------------- queries
    def origin(self, oid: int) -> Origin:
        return self.origins[oid]

    def sources(self, line: Line) -> list[Origin]:
        """Where a line's content comes from: its own origin, or, for text an edit
        wrote, the origins it overlaps with (followed transitively)."""
        seen: dict[int, Origin] = {}
        stack = [line.origin] + [oid for oid, _ in line.derived]
        while stack:
            oid = stack.pop()
            if oid in seen:
                continue
            seen[oid] = self.origins[oid]
        return list(seen.values())

    def presence(self, needle: str) -> list[bool]:
        """For each version, whether ``needle`` occurs in the editable context."""
        return [needle in v.text() for v in self.versions]

    def fate(self, needle: str) -> dict[str, Any]:
        """When a piece of text entered the context and when (and how) it left."""
        pres = self.presence(needle)
        if not any(pres):
            return {"seen": False}
        first = pres.index(True)
        out: dict[str, Any] = {"seen": True, "first_version": first, "present_at_end": pres[-1]}
        ver = self.versions[first]
        hit = next((l for l in ver.lines if needle in l.text), None)
        if hit is not None:
            out["origin"] = self.origins[hit.origin].label()
        if not pres[-1]:
            last = len(pres) - 1 - pres[::-1].index(True)
            tr = self.transitions[last]            # transition from version `last` to `last+1`
            out.update(lost_at_call=tr.call, lost_by=tr.kind, thought=tr.thought, command=tr.command)
            out["returned_later"] = any(pres[last + 1:])
        return out

    def first_version_where(self, predicate) -> int | None:
        for i, v in enumerate(self.versions):
            if predicate(v):
                return i
        return None


class _OverlapIndex:
    """Lexical overlap between a newly written line and the previous version."""

    def __init__(self, old: list[Line]):
        self.old = old
        self.n = max(len(old), 1)
        self.post: dict[str, set[int]] = defaultdict(set)
        for i, l in enumerate(old):
            for w in set(_words(l.text)):
                self.post[w].add(i)

    def sources(self, text: str, top: int = 5) -> tuple[tuple[int, float], ...]:
        words = set(_words(text))
        if not words:
            return ()
        weight = {w: math.log(1 + self.n / len(self.post[w])) if w in self.post
                  else math.log(1 + self.n) for w in words}
        total = sum(weight.values())
        score: dict[int, float] = defaultdict(float)
        rare: set[int] = set()
        for w in words:
            lines = self.post.get(w)
            if not lines:
                continue
            for i in lines:
                score[i] += weight[w]
                if len(lines) <= 2 and len(w) >= 5:
                    rare.add(i)
        best: dict[int, float] = {}
        for i, s in score.items():
            frac = s / total
            if frac >= 0.25 or i in rare:
                oid = self.old[i].origin
                best[oid] = max(best.get(oid, 0.0), round(frac, 3))
                for doid, _ in self.old[i].derived:   # a note derived from a note keeps the root
                    best.setdefault(doid, round(frac, 3))
        return tuple(sorted(best.items(), key=lambda kv: -kv[1])[:top])
