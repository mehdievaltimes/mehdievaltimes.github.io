"""Command line: read a run's version history.

    python -m ctxvc log     RUN            one line per step
    python -m ctxvc show    RUN CALL       thought, command, result and diff of one step
    python -m ctxvc blame   RUN CALL       the context at a step, every line with its origin
    python -m ctxvc find    RUN "text"     when a piece of text entered and left the context
    python -m ctxvc audit   RUN            provenance report for safety review
    python -m ctxvc verify  RUN            check the hash chain
    python -m ctxvc view    RUN -o x.html  one-file viewer

RUN is a directory with ``context_snapshots/turn-*.json`` (what the CLM harness and
ContextBench already write); ``steps.jsonl`` is used when present.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from .blame import History, Transition
from .store import Run


def _short(text: str, n: int = 80) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def cmd_log(h: History) -> None:
    print(f"{'call':>4} {'kind':8} {'tokens':>13} {'-lines':>6} {'+lines':>6}  command")
    for t in h.transitions:
        delta = f"{t.tokens_before}→{t.tokens_after}"
        rm = f"-{len(t.removed)}" if t.removed else ""
        wr = f"+{len(t.written)}" if t.written else ""
        print(f"{t.call:>4} {t.kind:8} {delta:>13} {rm:>6} {wr:>6}  {_short(t.command or '(no command)', 90)}")


def _transition(h: History, call: int) -> Transition:
    for t in h.transitions:
        if t.call == call:
            return t
    raise SystemExit(f"no step with call {call}; calls run {h.transitions[0].call}..{h.transitions[-1].call}")


def cmd_show(h: History, call: int) -> None:
    t = _transition(h, call)
    print(f"== call {t.call}: {t.kind}, context {t.tokens_before} → {t.tokens_after} tokens ==")
    print(f"\n-- thought --\n{t.thought}")
    print(f"\n-- command --\n{t.command}")
    print(f"\n-- result (exit {t.exit_code}) --\n{_short(t.observation, 600)}")
    if t.removed or t.written:
        print(f"\n-- diff: {len(t.removed)} line(s) removed, {len(t.written)} written, {t.moved} moved --")
        for l in t.removed[:60]:
            print(f"- [{h.origin(l.origin).label():>10}] {_short(l.text, 110)}")
        if len(t.removed) > 60:
            print(f"  … {len(t.removed) - 60} more removed lines")
        for l in t.written[:60]:
            src = ", ".join(h.origin(o).label() for o, _ in l.derived)
            print(f"+ [{'edit@' + str(t.call):>10}] {_short(l.text, 110)}" + (f"   <- {src}" if src else ""))
    if t.relabeled:
        c = Counter((old.role, new) for old, new in t.relabeled)
        print("\n-- role labels changed: " + ", ".join(f"{a}→{b}: {n} lines" for (a, b), n in c.items()))


def cmd_blame(h: History, call: int) -> None:
    ver = next((v for v in h.versions if v.call == call), None)
    if ver is None:
        raise SystemExit(f"no version for call {call}")
    msg = -1
    for l in ver.lines:
        if l.msg != msg:
            msg = l.msg
            print(f"\n[[turn {msg - h.protect + 1} role={l.role}]]")
        o = h.origin(l.origin)
        src = (" <- " + ",".join(h.origin(x).label() for x, _ in l.derived)) if l.derived else ""
        print(f"{o.label():>10}{src:18.18} | {l.text}")


def cmd_find(h: History, needle: str) -> None:
    f = h.fate(needle)
    if not f["seen"]:
        print("never in the context")
        return
    print(f"entered: version {f['first_version']} (origin {f.get('origin', '?')})")
    if f["present_at_end"]:
        print("still present at the end")
        return
    print(f"left the context at call {f['lost_at_call']} by {f['lost_by']}"
          + (" (and came back later)" if f.get("returned_later") else ""))
    print(f"  thought: {_short(f.get('thought', ''), 300)}")
    print(f"  command: {_short(f.get('command', ''), 300)}")


def audit(h: History) -> dict:
    """Provenance facts a safety reviewer wants from a run."""
    relabel: Counter = Counter()
    laundered = []          # edit-written lines whose content derives from tool output
    user_dropped = []       # user-written lines an edit removed
    for t in h.transitions:
        for old, new in t.relabeled:
            relabel[(h.origin(old.origin).writer, old.role, new)] += 1
        for l in t.written:
            srcs = [h.origin(o) for o, _ in l.derived]
            if any(o.writer == "tool" for o in srcs):
                laundered.append((t.call, l))
        if t.kind == "edit":
            for l in t.removed:
                if h.origin(l.origin).writer == "user":
                    user_dropped.append((t.call, l))
    final = h.versions[-1]
    by_writer_role: Counter = Counter()
    for l in final.lines:
        if l.text.strip():
            by_writer_role[(h.origin(l.origin).writer, l.role)] += 1
    return {"relabel": relabel, "laundered": laundered, "user_dropped": user_dropped,
            "final_by_writer_role": by_writer_role,
            "n_edits": sum(1 for t in h.transitions if t.kind == "edit")}


def cmd_audit(h: History) -> None:
    a = audit(h)
    print(f"{len(h.transitions)} steps, {a['n_edits']} context edits\n")
    print("Final context, non-blank lines by (who wrote it, role label it sits under):")
    for (writer, role), n in sorted(a["final_by_writer_role"].items(), key=lambda kv: -kv[1]):
        flag = "   <-- label does not match writer" if (writer, role) in (("tool", "user"), ("edit", "user")) else ""
        print(f"  {writer:8} under role={role:10} {n:5}{flag}")
    print("\nRole labels changed by edits (writer, old role → new role):")
    for (writer, a_, b_), n in a["relabel"].most_common():
        print(f"  {writer:8} {a_}→{b_}: {n} line-events")
    if not a["relabel"]:
        print("  none")
    print(f"\nEdit-written lines derived from tool output: {len(a['laundered'])}")
    for call, l in a["laundered"][:12]:
        src = ", ".join(h.origin(o).label() for o, _ in l.derived)
        print(f"  call {call:3} under role={l.role}: {_short(l.text, 90)}   <- {src}")
    print(f"\nUser-written lines removed by edits: {len(a['user_dropped'])}")
    for call, l in a["user_dropped"][:12]:
        print(f"  call {call:3}: {_short(l.text, 100)}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="ctxvc", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("log", "audit", "verify"):
        sub.add_parser(name).add_argument("run")
    for name in ("show", "blame"):
        p = sub.add_parser(name)
        p.add_argument("run")
        p.add_argument("call", type=int)
    p = sub.add_parser("find")
    p.add_argument("run")
    p.add_argument("text")
    p = sub.add_parser("view")
    p.add_argument("run")
    p.add_argument("-o", "--out", default="ctxvc-view.html")
    a = ap.parse_args(argv)

    run = Run(a.run)
    if a.cmd == "verify":
        ok, msg = run.verify()
        print(("OK: " if ok else "FAILED: ") + msg)
        sys.exit(0 if ok else 1)
    h = History(run)
    if a.cmd == "log":
        cmd_log(h)
    elif a.cmd == "show":
        cmd_show(h, a.call)
    elif a.cmd == "blame":
        cmd_blame(h, a.call)
    elif a.cmd == "find":
        cmd_find(h, a.text)
    elif a.cmd == "audit":
        cmd_audit(h)
    elif a.cmd == "view":
        from .view import write_view
        write_view(h, a.out)
        print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
