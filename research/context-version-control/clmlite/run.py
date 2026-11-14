"""Run episodes: one task under one condition, graded, with its version history kept."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ctxvc.store import Run                                   # noqa: E402
from clmlite.agent import Config, Episode                     # noqa: E402
from clmlite.llm import ClaudeCLI                             # noqa: E402
from clmlite.tasks import MAKERS, Task, grade                 # noqa: E402

PAPER_SKILL_DIR = Path("/home/user/RulinShao/ContextBench/clm_exp/skills/clm")
PAPER_SKILL_FILES = {"kv": "kv_store.md", "log": "log_triage.md"}


#: The CLM paper's own backup mechanism: one sentence appended to the task (its Appendix E).
BACKUP_SENTENCE = ("Before every edit to your context, you must back up the current context file into a "
                   "new file inside a new folder named compaction_backup; never overwrite or delete "
                   "earlier backups.")


def paper_skill(family: str) -> str:
    """The method text of the CLM paper's own ContextBench runs (read as data, if present)."""
    p = PAPER_SKILL_DIR / PAPER_SKILL_FILES.get(family, "")
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def condition(name: str, family: str, **overrides: Any) -> Config:
    """plain: edit only.  history: + read-only version history.  skill: + the paper's offload recipe."""
    cfg = Config(**overrides)
    if name == "history":
        cfg.history = True
    elif name == "backup":
        cfg.skill = BACKUP_SENTENCE
    elif name == "skill":
        cfg.skill = paper_skill(family)
        if not cfg.skill:
            raise FileNotFoundError(f"paper skill for {family} not found under {PAPER_SKILL_DIR}")
    elif name != "plain":
        raise ValueError(f"unknown condition {name!r}")
    return cfg


def run_one(task: Task, cfg: Config, llm: Any, run_dir: Path, sandbox_root: Path,
            meta: dict[str, Any] | None = None, **episode_kwargs: Any) -> dict[str, Any]:
    for d in (run_dir, sandbox_root):
        if d.exists():
            shutil.rmtree(d)
    t0 = time.time()
    ep = Episode(task, cfg, llm, run_dir, sandbox_root, meta=meta, **episode_kwargs)
    state = ep.run()
    run = Run(run_dir)
    g = grade(task, run.snapshots)
    tok = [s.get("tokens") or 0 for s in run.snapshots]
    result = {"task": task.name, "family": task.family, **(meta or {}),
              "obeyed": g.get("obeyed"), "obey_rate": g.get("obey_rate"),
              "phase1_reward": g.get("phase1_reward"),
              "reward": g["reward"], "correct": g["correct"], "answered": g["answered"], "total": g["total"],
              "per_query": g["per_query"], "terminated_by": state.terminated_by,
              "n_calls": state.call, "ops_delivered": state.delivered, "n_ops": len(task.ops),
              "n_edits": sum(1 for s in run.steps if (s.get("edit") or {}).get("applied")),
              "peak_tokens": max(tok) if tok else 0,
              "sum_input_tokens": sum((s.get("usage") or {}).get("input_tokens") or 0 for s in run.steps),
              "sum_output_tokens": sum((s.get("usage") or {}).get("output_tokens") or 0 for s in run.steps),
              "cost_usd": round(ep.cost, 5), "seconds": round(time.time() - t0, 1)}
    ep.writer.result(result)
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--family", default="kv", choices=sorted(MAKERS))
    ap.add_argument("--conditions", default="plain,history,skill")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default="/home/user/ctxvc-work/sandboxes")
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--budget", type=int, default=8000)
    ap.add_argument("--reserve", type=int, default=800)
    ap.add_argument("--batches", type=int, default=12)
    ap.add_argument("--per-batch", type=int, default=30)
    ap.add_argument("--queries", type=int, default=12)
    ap.add_argument("--max-calls", type=int, default=120)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()

    out, work = Path(a.out), Path(a.work)
    llm = ClaudeCLI(a.model)
    jobs = []
    for seed in [int(s) for s in a.seeds.split(",")]:
        kw = {"n_batches": a.batches, "per_batch": a.per_batch}
        kw["n_get" if a.family == "kv" else "n_q"] = a.queries
        task = MAKERS[a.family](seed, **kw)
        for cond in a.conditions.split(","):
            cfg = condition(cond, a.family, budget=a.budget, reserve=a.reserve, max_calls=a.max_calls)
            name = f"{task.name}-{cond}"
            jobs.append((task, cfg, out / name, work / name,
                         {"condition": cond, "seed": seed,
                          "task_spec": {"family": a.family, "seed": seed, "kwargs": kw}}))

    results = []
    with ThreadPoolExecutor(max_workers=a.jobs) as pool:
        futs = {pool.submit(run_one, t, c, llm, rd, sb, m): (t.name, m["condition"]) for t, c, rd, sb, m in jobs}
        for fut in as_completed(futs):
            name, cond = futs[fut]
            try:
                r = fut.result()
                results.append(r)
                p1 = f" p1={r['phase1_reward']:.2f}" if r.get("phase1_reward") is not None else ""
                print(f"{name:28s} {cond:8s} reward={r['reward']:.2f} ({r['correct']}/{r['total']}){p1} "
                      f"calls={r['n_calls']} edits={r['n_edits']} peak={r['peak_tokens']} "
                      f"end={r['terminated_by']} ${r['cost_usd']:.3f} {r['seconds']:.0f}s", flush=True)
            except Exception as exc:  # one failed run must not lose the others
                print(f"{name:28s} {cond:8s} FAILED: {type(exc).__name__}: {exc}", flush=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(results, indent=1, default=str) + "\n")
    print(f"total model cost ${llm.cost_usd:.2f} over {llm.calls} calls")


if __name__ == "__main__":
    main()
