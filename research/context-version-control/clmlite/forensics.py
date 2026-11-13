"""For every graded question of a run: was the needed fact still reachable when the question
arrived, and if not, which step removed it and what the model said it was doing."""

from __future__ import annotations

import tarfile
from pathlib import Path
from typing import Any

from ctxvc.blame import History
from ctxvc.store import Run

from .agent import is_ready_command
from .replay import task_from_run

_SKIP = (".live_ctx/LIVE_CTX_MAIN.txt", ".bash_ctx_state/")


def files_with(run_dir: Path | str, call: int, needle: str) -> list[str]:
    """Sandbox files (as they were before ``call``) that contain ``needle``."""
    tar_path = Path(run_dir) / "fs" / f"call-{call:04d}.tar"
    if not tar_path.exists():
        return []
    hits = []
    with tarfile.open(tar_path) as tar:
        for m in tar.getmembers():
            if not m.isfile() or any(s in m.name for s in _SKIP) or m.size > 5_000_000:
                continue
            f = tar.extractfile(m)
            if f is not None and needle.encode() in f.read():
                hits.append(m.name.lstrip("./"))
    return hits


def _facts(task) -> list[dict[str, Any]]:
    if task.family == "ledger":
        return [{"qid": q["qid"], "fact": q["line"], "marker": f"AUDIT {q['qid']}:"} for q in task.gold["queries"]]
    if task.family == "kv":
        return [{"qid": q["qid"], "fact": f"SET {q['key']} = {q['value']}", "marker": f"GET {q['key']}\n"}
                for q in task.gold["queries"]]
    raise ValueError(f"no fact model for family {task.family}")


def per_query(run_dir: Path | str) -> list[dict[str, Any]]:
    run = Run(run_dir)
    h = History(run)
    task = task_from_run(run)
    graded = {q["qid"]: q for q in (run.result.get("per_query") or [])}
    has_history = bool((run.meta.get("config") or {}).get("history"))
    rows = []
    for f in _facts(task):
        g = graded.get(f["qid"], {})
        row: dict[str, Any] = {"qid": f["qid"], "correct": bool(g.get("correct")), "answered": bool(g.get("answered"))}
        v_q = h.first_version_where(lambda v: f["marker"] in v.text() + "\n")
        if v_q is None:
            row["class"] = "not_reached"
            rows.append(row)
            continue
        call_q = h.versions[v_q].call
        in_ctx = f["fact"] in h.versions[v_q].text()
        on_disk = files_with(run_dir, call_q, f["fact"])
        window = []
        for t in h.transitions[v_q:]:
            window.append(t)
            if is_ready_command(t.command or "", t.exit_code if t.exit_code is not None else 1):
                break
        used_history = any("/ctx_history" in (t.command or "") for t in window)
        row.update(asked_at_call=call_q, in_context=in_ctx, on_disk=on_disk[:3], history=has_history,
                   used_history=used_history, calls_to_answer=len(window))
        fate = h.fate(f["fact"])
        if fate.get("seen") and "lost_at_call" in fate:
            row.update(lost_at_call=fate["lost_at_call"], lost_by=fate["lost_by"],
                       lost_thought=fate.get("thought", ""), lost_command=fate.get("command", ""))
        if row["correct"]:
            row["class"] = ("from_context" if in_ctx else "from_history" if used_history
                            else "from_disk" if on_disk else "other")
        elif not in_ctx and not on_disk and not has_history:
            row["class"] = "unrecoverable"
        else:
            row["class"] = "reachable_but_missed"
        rows.append(row)
    return rows
