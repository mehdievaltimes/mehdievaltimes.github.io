"""Counterfactual replay: go back to a saved step, change one thing, run on from there.

A replay point is (context sent at call c, harness counters, sandbox files), all of
which the original run saved. ``replay`` restores them into a fresh run directory and
continues the same loop, optionally

* with a changed context (``edit_messages``),
* with a prescribed reply at given calls (``forced``), or
* with a rule that rewrites the model's own replies (``action_hook``).

Model calls are stochastic, so always compare a changed replay against an unchanged
replay from the same call (the null arm), never against the original run.
"""

from __future__ import annotations

import copy
import re
import shutil
import time
from pathlib import Path
from typing import Any, Callable

from ctxvc.ctxfile import messages_tokens, render
from ctxvc.store import Run

from .agent import Config, Episode, State, parse_reply
from .tasks import MAKERS, Task, grade

_NAME_RE = re.compile(r"^(?P<family>[a-z]+)-b(?P<nb>\d+)x(?P<pb>\d+)-seed(?P<seed>\d+)$")


def task_from_run(run: Run) -> Task:
    """Re-make the task of a run (generation is deterministic in the seed)."""
    spec = run.meta.get("task_spec")
    if not spec:
        m = _NAME_RE.match(str(run.meta.get("task", "")))
        if not m:
            raise ValueError(f"cannot tell the task from meta: {run.meta.get('task')!r}")
        family = m["family"]
        kw: dict[str, Any] = {"n_batches": int(m["nb"]), "per_batch": int(m["pb"])}
        n_q = (run.result or {}).get("total")
        if n_q:
            kw["n_get" if family == "kv" else "n_q"] = int(n_q)
        spec = {"family": family, "seed": int(m["seed"]), "kwargs": kw}
    return MAKERS[spec["family"]](spec["seed"], **spec.get("kwargs", {}))


def config_from_run(run: Run, **overrides: Any) -> Config:
    c = dict(run.meta.get("config") or {})
    c["nudges"] = tuple(c.get("nudges") or ())
    c.update(overrides)
    return Config(**c)


def _snapshot(run: Run, call: int) -> dict[str, Any]:
    for s in run.snapshots:
        if s.get("step") == call and s.get("kind") != "final":
            return s
    raise ValueError(f"no snapshot for call {call}")


def transcript_upto(run: Run, call: int) -> list[tuple[int, str, str]]:
    """Every turn that had entered the conversation before ``call``, in order."""
    out: list[tuple[int, str, str]] = []
    snaps = [s for s in run.snapshots if s.get("step", 0) <= call and s.get("kind") != "final"]
    if not snaps:
        return out
    protect = run.protect
    for m in snaps[0]["messages"][protect:]:
        out.append((-1, m["role"], m["content"]))
    for a, b in zip(snaps, snaps[1:]):
        rec = run.step_record(a["step"]) or {}
        nxt = run.step_record(b["step"]) or {}
        n_new = int(rec.get("n_appended") or 0) + len(nxt.get("pre_writers") or [])
        for m in b["messages"][len(b["messages"]) - n_new:] if n_new else []:
            out.append((a["step"], m["role"], m["content"]))
    return out


def replay(run_dir: Path | str, call: int, llm: Any, out_dir: Path | str, sandbox_root: Path | str, *,
           edit_messages: Callable[[list[dict[str, Any]]], list[dict[str, Any]]] | None = None,
           forced: dict[int, str] | None = None, action_hook: Any = None,
           max_calls: int | None = None, label: str = "replay",
           config_overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    run = Run(run_dir)
    task = task_from_run(run)
    cfg = config_from_run(run, **(config_overrides or {}))
    snap = _snapshot(run, call)
    rec = run.step_record(call) or {}
    st = rec.get("state") or {}
    messages = copy.deepcopy(snap["messages"])
    if edit_messages is not None:
        messages = edit_messages(messages)
    state = State(messages=messages, call=call, delivered=int(st.get("delivered", 0)),
                  nudged=list(st.get("nudged") or []), warned=int(st.get("warned", 0)))
    out_dir, sandbox_root = Path(out_dir), Path(sandbox_root)
    for d in (out_dir, sandbox_root):
        if d.exists():
            shutil.rmtree(d)
    fs_tar = Path(run_dir) / "fs" / f"call-{call:04d}.tar"
    meta = {"condition": run.meta.get("condition"), "seed": run.meta.get("seed"),
            "replay_of": str(run_dir), "replay_from_call": call, "intervention": label}
    t0 = time.time()
    ep = Episode(task, cfg, llm, out_dir, sandbox_root, meta=meta, start=state,
                 fs_tar=fs_tar if fs_tar.exists() else None, transcript=transcript_upto(run, call),
                 forced=forced, action_hook=action_hook)
    if cfg.history:                       # versions that existed before the replay point
        hist = ep.sandbox.hist
        for s in run.snapshots:
            if s.get("step", 0) < call and s.get("kind") != "final":
                (hist / "versions" / f"v{s['step']:04d}.txt").write_text(
                    render(s["messages"], protect=run.protect) + "\n", encoding="utf-8")
                with (hist / "INDEX.txt").open("a", encoding="utf-8") as fh:
                    fh.write(f"v{s['step']:04d}  tokens={messages_tokens(s['messages'][1:])}  "
                             f"turns={len(s['messages']) - 2}\n")
    final = ep.run(max_calls=max_calls)

    # Grade on the original run's snapshots before the replay point plus the replayed ones.
    before = [s for s in run.snapshots if s.get("step", 0) < call and s.get("kind") != "final"]
    replayed = Run(out_dir)
    g = grade(task, before + replayed.snapshots)
    result = {"task": task.name, "family": task.family, **meta,
              "phase1_reward": g.get("phase1_reward"), "reward": g["reward"], "correct": g["correct"],
              "answered": g["answered"], "total": g["total"], "per_query": g["per_query"],
              "terminated_by": final.terminated_by, "n_calls": final.call - call,
              "cost_usd": round(ep.cost, 5), "seconds": round(time.time() - t0, 1)}
    ep.writer.result(result)
    return result


# ------------------------------------------------------------- action rewriting
OFFLOAD_DIR = "/tmp/ctx_offload"


def offload_before_edit(call: int, reply: str) -> str:
    """Hindsight relabel of a context edit: the same edit, but the context is saved first.

    Applied to a reply whose command edits the context file; other replies pass through.
    The result is an action the model could have taken itself, which is what makes it
    usable as a fine-tuning target."""
    thought, command = parse_reply(reply)
    if not command or "LIVE_CTX_MAIN" not in command or OFFLOAD_DIR in command:
        return reply
    dest = f"{OFFLOAD_DIR}/context-before-call-{call:04d}.txt"
    new_thought = (f"{thought.rstrip()} Before editing, I save the current context to {dest}, so "
                   "anything I remove can still be looked up later.")
    new_command = f"mkdir -p {OFFLOAD_DIR} && cp /tmp/.live_ctx/LIVE_CTX_MAIN.txt {dest}\n{command}"
    return f"THOUGHT: {new_thought}\n```bash\n{new_command}\n```"
