"""Shared helpers for the experiment scripts."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

WORK = Path("/home/user/ctxvc-work")


def run_jobs(jobs: list[tuple[str, Callable[[], dict[str, Any]]]], n_parallel: int = 6) -> list[dict[str, Any]]:
    """Run named thunks in parallel; a failed job is reported and skipped."""
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=n_parallel) as pool:
        futs = {pool.submit(fn): name for name, fn in jobs}
        for fut in as_completed(futs):
            name = futs[fut]
            try:
                r = fut.result()
                results.append(r)
                extra = "".join(f" {k}={r[k]}" for k in ("obey_rate", "phase1_reward") if r.get(k) is not None)
                print(f"{name:52s} reward={r['reward']:.2f}{extra} calls={r['n_calls']} "
                      f"end={r['terminated_by']} ${r['cost_usd']:.3f}", flush=True)
            except Exception as exc:
                print(f"{name:52s} FAILED {type(exc).__name__}: {exc}", flush=True)
    return results


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else float("nan")


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, default=str) + "\n", encoding="utf-8")
