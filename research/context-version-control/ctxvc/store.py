"""Append-only run store.

A run directory holds exactly what a CLM harness already writes, plus one small
sidecar::

    meta.json
    context_snapshots/turn-0000.json   the full message list sent at LM call 0, 1, ...
                                       (same shape as the CLM / ContextBench snapshots)
    steps.jsonl                        one line per LM call: thought, command, exit
                                       code, observation, harness events, usage
    fs/call-0000.tar                   the sandbox before call c (only needed for replay)
    result.json                        the grade, written once at the end

The writer lives in the harness process. The model's shell runs somewhere else (a
container, or an unprivileged user in a private mount namespace) and has no write
path to this directory, so the history is out of the model's reach by construction.
On top of that every record carries the hash of the one before it, so a history
that was altered after the fact no longer verifies.
"""

from __future__ import annotations

import hashlib
import json
import tarfile
import time
from pathlib import Path
from typing import Any

SNAP_DIR = "context_snapshots"


def _sha(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def messages_sha(messages: list[dict[str, Any]]) -> str:
    return _sha(json.dumps(messages, sort_keys=True, ensure_ascii=False, default=str))[:16]


class RunWriter:
    """Harness-side writer. Every write is a new file or an appended line."""

    def __init__(self, run_dir: Path | str, meta: dict[str, Any] | None = None, *, resume: bool = False):
        self.dir = Path(run_dir)
        (self.dir / SNAP_DIR).mkdir(parents=True, exist_ok=True)
        (self.dir / "fs").mkdir(exist_ok=True)
        self._steps = self.dir / "steps.jsonl"
        if resume and self._steps.exists():
            lines = self._steps.read_text(encoding="utf-8").splitlines()
            self._prev = _sha(lines[-1]) if lines else _sha(json.dumps(meta or {}, sort_keys=True))
        else:
            meta = dict(meta or {})
            meta.setdefault("created", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            meta.setdefault("format", "ctxvc-run-v1")
            (self.dir / "meta.json").write_text(json.dumps(meta, indent=2, default=str) + "\n", encoding="utf-8")
            self._prev = _sha(json.dumps(meta, sort_keys=True, default=str))

    def snapshot(self, call: int, messages: list[dict[str, Any]], *, kind: str = "agent",
                 tokens: int | None = None, extra: dict[str, Any] | None = None) -> str:
        """Write the exact message list about to be sent at LM call ``call``."""
        payload: dict[str, Any] = {"step": call, "kind": kind, "tokens": tokens,
                                   "n_messages": len(messages)}
        if extra:
            payload.update(extra)
        payload["messages"] = messages
        path = self.dir / SNAP_DIR / f"turn-{call:04d}.json"
        with path.open("x", encoding="utf-8") as fh:  # "x": never overwrite a version
            fh.write(json.dumps(payload, indent=1, ensure_ascii=False, default=str) + "\n")
        return messages_sha(messages)

    def step(self, record: dict[str, Any]) -> None:
        record = dict(record)
        record["prev"] = self._prev
        line = json.dumps(record, ensure_ascii=False, default=str)
        with self._steps.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        self._prev = _sha(line)

    def fs_snapshot(self, call: int, root: Path | str) -> None:
        path = self.dir / "fs" / f"call-{call:04d}.tar"
        with tarfile.open(path, "x") as tar:
            tar.add(str(root), arcname=".")

    def result(self, result: dict[str, Any]) -> None:
        (self.dir / "result.json").write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")


class Run:
    """Read side: snapshots in call order, plus the sidecar when there is one."""

    def __init__(self, run_dir: Path | str):
        self.dir = Path(run_dir)
        self.meta: dict[str, Any] = self._json("meta.json") or {}
        self.result: dict[str, Any] = self._json("result.json") or {}
        self.snapshots: list[dict[str, Any]] = []
        snap_dir = self.dir / SNAP_DIR
        if not snap_dir.is_dir():
            raise FileNotFoundError(f"{snap_dir} not found: not a run directory")
        for p in sorted(snap_dir.glob("turn-*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            if "messages" not in d:
                continue
            # The released CLM harness also leaves untagged duplicates; keep tagged ones.
            if d.get("kind") is None and any(s.get("step") == d.get("step") for s in self.snapshots):
                continue
            self.snapshots.append(d)
        self.steps: list[dict[str, Any]] = []
        sp = self.dir / "steps.jsonl"
        if sp.exists():
            self.steps = [json.loads(l) for l in sp.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.protect = int(self.meta.get("protect", 2))

    def _json(self, name: str) -> Any:
        p = self.dir / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def step_record(self, call: int) -> dict[str, Any] | None:
        for s in self.steps:
            if s.get("call") == call:
                return s
        return None

    def verify(self) -> tuple[bool, str]:
        """Recompute the hash chain of the sidecar and the snapshot hashes it names."""
        sp = self.dir / "steps.jsonl"
        if not sp.exists():
            return True, "no sidecar: nothing to verify (snapshots only)"
        prev = _sha(json.dumps(self.meta, sort_keys=True, default=str))
        by_call = {s.get("step"): s for s in self.snapshots}
        for n, line in enumerate(sp.read_text(encoding="utf-8").splitlines()):
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("prev") != prev:
                return False, f"chain broken at record {n} (call {rec.get('call')})"
            want = rec.get("ctx_in")
            snap = by_call.get(rec.get("call"))
            if want and snap is not None and messages_sha(snap["messages"]) != want:
                return False, f"snapshot of call {rec.get('call')} does not match its recorded hash"
            prev = _sha(line)
        return True, f"{len(self.steps)} records, chain intact"
