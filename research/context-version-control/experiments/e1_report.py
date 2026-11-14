"""E1 report: surprise recall under plain / self-backup / read-only history. No model calls.

    python experiments/e1_report.py [runs_dir]
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

from common import WORK, dump, mean

from clmlite.forensics import files_with, per_query
from ctxvc.store import Run


def backup_compliance(run_dir: Path, run: Run) -> dict:
    """Of the applied context edits, how many were preceded by a new backup file?"""
    edits = [s for s in run.steps if (s.get("edit") or {}).get("applied")]
    in_cmd = sum(1 for s in edits if "compaction_backup" in (s.get("command") or ""))
    return {"edits": len(edits), "edits_with_backup_in_command": in_cmd,
            "compliance": in_cmd / len(edits) if edits else None}


def main() -> None:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / "runs" / "e1"
    per_cond = defaultdict(list)
    classes = defaultdict(Counter)
    lost_examples = []
    for d in sorted(root.iterdir()):
        if not (d / "result.json").exists():
            continue
        run = Run(d)
        r = dict(run.result)
        cond = r["condition"]
        tok = [s.get("tokens") or 0 for s in run.snapshots]
        r["mean_tokens"] = mean(tok)
        if cond == "backup":
            r["backup"] = backup_compliance(d, run)
        rows = per_query(d)
        r["query_classes"] = dict(Counter(x["class"] for x in rows))
        for x in rows:
            classes[cond][x["class"]] += 1
            if x["class"] == "unrecoverable" and x.get("lost_thought") and len(lost_examples) < 40:
                lost_examples.append({"run": d.name, "qid": x["qid"], "lost_at_call": x["lost_at_call"],
                                      "lost_by": x["lost_by"], "thought": x["lost_thought"][:600],
                                      "command": x["lost_command"][:300]})
        per_cond[cond].append(r)

    table = []
    print(f"{'condition':9} {'n':>2} {'surprise recall':>16} {'announced task':>15} {'calls':>6} {'in tok':>8} {'out tok':>8} {'$':>6} {'mean ctx':>8} {'ended ok':>8}")
    for cond in ("plain", "backup", "history"):
        rs = per_cond.get(cond, [])
        if not rs:
            continue
        t = {"condition": cond, "n": len(rs), "surprise_recall": mean([r["reward"] for r in rs]),
             "surprise_recall_per_run": [r["reward"] for r in rs],
             "announced_task": mean([r["phase1_reward"] for r in rs]),
             "calls": mean([r["n_calls"] for r in rs]), "input_tokens": mean([r["sum_input_tokens"] for r in rs]),
             "output_tokens": mean([r["sum_output_tokens"] for r in rs]), "cost_usd": mean([r["cost_usd"] for r in rs]),
             "mean_context_tokens": mean([r["mean_tokens"] for r in rs]),
             "completed": sum(1 for r in rs if r["terminated_by"] == "stream_exhausted"),
             "query_classes": dict(classes[cond])}
        if cond == "backup":
            comp = [r["backup"]["compliance"] for r in rs if r["backup"]["compliance"] is not None]
            t["backup_compliance"] = mean(comp)
            t["backup_compliance_per_run"] = comp
        table.append(t)
        print(f"{cond:9} {t['n']:>2} {t['surprise_recall']:>16.2f} {t['announced_task']:>15.2f} {t['calls']:>6.1f} "
              f"{t['input_tokens']:>8.0f} {t['output_tokens']:>8.0f} {t['cost_usd']:>6.3f} {t['mean_context_tokens']:>8.0f} "
              f"{t['completed']:>5}/{t['n']}")
    print("\nWhere each surprise question's answer came from, or why it failed:")
    for cond, c in classes.items():
        print(f"  {cond:8} {dict(c)}")
    for t in table:
        if "backup_compliance" in t:
            print(f"\nself-backup: {t['backup_compliance']:.0%} of context edits carried a backup command "
                  f"(per run: {[round(x, 2) for x in t['backup_compliance_per_run']]})")
    print(f"\n{len(lost_examples)} unrecoverable losses with the thought at the losing edit; first three:")
    for e in lost_examples[:3]:
        print(f"  {e['run']} q{e['qid']} lost at call {e['lost_at_call']} ({e['lost_by']}): {e['thought'][:260]!r}")
    dump(Path(__file__).resolve().parents[1] / "results" / "e1_recall.json",
         {"table": table, "lost_examples": lost_examples,
          "runs": {c: [{k: r.get(k) for k in ("task", "seed", "reward", "phase1_reward", "n_calls", "n_edits",
                                               "terminated_by", "cost_usd", "query_classes", "backup")}
                       for r in rs] for c, rs in per_cond.items()}})


if __name__ == "__main__":
    main()
