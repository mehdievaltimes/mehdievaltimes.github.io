"""E3: counterfactual replay of single context edits, checked against what the history predicts.

For a run that failed the surprise questions, every edit that removed raw lines is
re-run once with one change: the same edit, but the context is saved to a file first
(``offload_before_edit``). Everything after that call is left to the model.

Prediction from the version history, with no model calls: saving the context at call e
makes exactly the facts that were still in the context at call e recoverable.
Observation from replay: which questions the model then gets right.

Arms, all starting from a saved step of the original run:
* ``null``     the original reply is replayed at the edit call, then the model runs on;
* ``relabel``  the relabelled reply is used at that one call, then the model runs on;
* ``policy``   every edit from the first one on is relabelled (a full demonstration).

    python experiments/e3_replay.py run [n_runs] [samples]
    python experiments/e3_replay.py report
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from common import WORK, dump, mean, run_jobs

from clmlite.forensics import per_query
from clmlite.llm import ClaudeCLI
from clmlite.replay import offload_before_edit, replay, task_from_run
from ctxvc.blame import History
from ctxvc.store import Run

SRC = WORK / "runs" / "e1"
OUT = WORK / "runs" / "e3"


def losing_edits(run_dir: Path) -> tuple[dict[int, set[int]], dict[int, set[int]]]:
    """(edit call -> questions whose fact it removed, edit call -> questions whose fact was
    still in the context when that call was made)."""
    run = Run(run_dir)
    h = History(run)
    task = task_from_run(run)
    removed: dict[int, set[int]] = defaultdict(set)
    present: dict[int, set[int]] = defaultdict(set)
    facts = {q["qid"]: q["line"] for q in task.gold["queries"]}
    for qid, fact in facts.items():
        f = h.fate(fact)
        if f.get("seen") and f.get("lost_by") == "edit":
            removed[f["lost_at_call"]].add(qid)
    by_call = {v.call: v for v in h.versions}
    for call in removed:
        text = by_call[call].text()
        present[call] = {qid for qid, fact in facts.items() if fact in text}
    return dict(removed), dict(present)


def pick_runs(n: int) -> list[Path]:
    runs = []
    for d in sorted(SRC.iterdir()):
        r = d / "result.json"
        if d.name.endswith("-plain") and r.exists():
            res = json.loads(r.read_text())
            if res["reward"] <= 0.2 and res["terminated_by"] == "stream_exhausted":
                runs.append(d)
    return runs[:n]


def jobs(n_runs: int, samples: int):
    llm = ClaudeCLI("haiku")
    out = []
    for src in pick_runs(n_runs):
        run = Run(src)
        removed, _ = losing_edits(src)
        edits = sorted(removed)
        raw = {s["call"]: s["raw"] for s in run.steps}
        first = edits[0]
        for k in range(samples):
            name = f"{src.name}__null@{first}__s{k}"
            out.append((name, lambda s=src, c=first, n=name: replay(
                s, c, llm, OUT / n, WORK / "sandboxes-e3" / n, forced={c: raw[c]}, label="null")))
            name = f"{src.name}__policy@{first}__s{k}"
            out.append((name, lambda s=src, c=first, n=name: replay(
                s, c, llm, OUT / n, WORK / "sandboxes-e3" / n,
                forced={c: offload_before_edit(c, raw[c])}, action_hook=offload_before_edit, label="policy")))
        for e in edits:
            for k in range(samples):
                name = f"{src.name}__relabel@{e}__s{k}"
                out.append((name, lambda s=src, c=e, n=name: replay(
                    s, c, llm, OUT / n, WORK / "sandboxes-e3" / n,
                    forced={c: offload_before_edit(c, raw[c])}, label="relabel")))
    return out, llm


def report() -> None:
    cells = []           # one row per (source run, edit, question) for the relabel arm
    arms = defaultdict(list)
    imitation = defaultdict(list)
    sft = []
    for d in sorted(OUT.iterdir()):
        if not (d / "result.json").exists():
            continue
        res = json.loads((d / "result.json").read_text())
        src_name, arm_at, _ = d.name.split("__")
        arm, at = arm_at.split("@")
        arms[(src_name, arm, int(at))].append(res)
        steps = Run(d).steps
        own_edits = [s for s in steps if (s.get("edit") or {}).get("applied") and s.get("reply_source") == "model"]
        if own_edits:
            imitation[arm].append(mean([float("ctx_offload" in (s.get("command") or "") or "cp " in (s.get("command") or ""))
                                        for s in own_edits]))
        if arm == "policy" and res["reward"] >= 0.9:
            sft += [{"source": d.name, "call": s["call"], "model_reply": s["raw_model"], "target_reply": s["raw"]}
                    for s in steps if s.get("reply_source") == "hooked"]

    summary = defaultdict(list)
    for (src_name, arm, at), rs in arms.items():
        summary[arm] += [r["reward"] for r in rs]
        if arm != "relabel":
            continue
        _, present = losing_edits(SRC / src_name)
        for qid in range(rs[0]["total"]):
            obs = mean([float(next(q["correct"] for q in r["per_query"] if q["qid"] == qid)) for r in rs])
            cells.append({"run": src_name, "edit_call": at, "qid": qid,
                          "predicted_recoverable": qid in present.get(at, set()), "observed": obs, "n": len(rs)})

    print("arm       replays  mean surprise recall")
    for arm in ("null", "relabel", "policy"):
        if summary[arm]:
            print(f"{arm:9} {len(summary[arm]):>7}  {mean(summary[arm]):.2f}")
    if cells:
        pos = [c["observed"] for c in cells if c["predicted_recoverable"]]
        neg = [c["observed"] for c in cells if not c["predicted_recoverable"]]
        agree = mean([float((c["observed"] >= 0.5) == c["predicted_recoverable"]) for c in cells])
        print(f"\nrelabel one edit: {len(cells)} (edit, question) cells")
        print(f"  history says recoverable     -> answered correctly in {mean(pos):.2f} of replays (n={len(pos)} cells)")
        print(f"  history says not recoverable -> answered correctly in {mean(neg):.2f} of replays (n={len(neg)} cells)")
        print(f"  agreement between prediction and majority outcome: {agree:.2f}")
    for arm, xs in imitation.items():
        print(f"share of the model's own later edits that also saved the context, {arm}: {mean(xs):.2f} (n={len(xs)} replays)")
    print(f"\nverified fine-tuning pairs from policy replays that scored >= 0.9: {len(sft)}")
    root = Path(__file__).resolve().parents[1] / "results"
    dump(root / "e3_replay.json", {
        "arms": {a: {"n": len(v), "mean_reward": mean(v), "rewards": v} for a, v in summary.items()},
        "cells": cells, "imitation": {a: mean(v) for a, v in imitation.items()}, "n_sft_pairs": len(sft)})
    if sft:
        with (root / "e3_sft_pairs.sample.jsonl").open("w", encoding="utf-8") as fh:
            for row in sft[:20]:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    if sys.argv[1:2] == ["run"]:
        n_runs = int(sys.argv[2]) if len(sys.argv) > 2 else 2
        samples = int(sys.argv[3]) if len(sys.argv) > 3 else 3
        js, llm = jobs(n_runs, samples)
        print(f"{len(js)} replays planned", flush=True)
        run_jobs(js, n_parallel=6)
        print(f"model cost ${llm.cost_usd:.2f} over {llm.calls} calls")
    report()
