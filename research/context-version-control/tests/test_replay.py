"""Replay from a saved step: unchanged, with a forced reply, and with a rewritten action."""
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from clmlite.agent import Config
from clmlite.llm import ScriptedLLM
from clmlite.replay import offload_before_edit, replay
from clmlite.run import run_one
from clmlite.tasks import make_ledger
from ctxvc.blame import History
from ctxvc.store import Run

WORK = Path("/home/user/ctxvc-work/test-replay")

DROP = ("THOUGHT: batch answered; drop its raw lines.\n```bash\n"
        "python3 - <<'PY' && echo READY_FOR_NEXT_OP\n"
        "import re; p='/tmp/.live_ctx/LIVE_CTX_MAIN.txt'; s=open(p).read()\n"
        "s=re.sub(r'(\\[\\[CTX_TURN 1 [^\\]]*\\]\\]).*?(?=\\n\\[\\[CTX_TURN|\\Z)', r'\\1\\n[batch 0 done]', s, flags=re.S)\n"
        "open(p,'w').write(s)\nPY\n```")


def lookup(q, where):
    return ("THOUGHT: look for the raw line.\n```bash\n"
            f"v=$(grep -rh '{q['txn']} |' {where} 2>/dev/null | head -1 | sed -n 's/.*{q['field']}=\\([^ |]*\\).*/\\1/p'); "
            f"printf '<<<ANSWER audit={q['qid']}>>>\\n%s\\n<<<ANSWER END>>>\\n' \"${{v:-UNAVAILABLE}}\"; echo READY_FOR_NEXT_OP\n```")


def test_replay():
    task = make_ledger(seed=5, n_batches=1, per_batch=6, n_q=1)
    q = task.gold["queries"][0]
    cfg = Config(budget=6000, reserve=600, max_calls=8)
    base, sb = WORK / "base", WORK / "sbx"
    r = run_one(task, cfg, ScriptedLLM([DROP, lookup(q, "/tmp")]), base, sb,
                {"condition": "plain", "seed": 5,
                 "task_spec": {"family": "ledger", "seed": 5, "kwargs": {"n_batches": 1, "per_batch": 6, "n_q": 1}}})
    assert r["reward"] == 0.0 and r["terminated_by"] == "stream_exhausted", r
    h = History(Run(base))
    f = h.fate(q["line"])
    assert f["lost_at_call"] == 0 and f["lost_by"] == "edit"

    # null arm: same replies from call 0 -> still wrong
    null = replay(base, 0, ScriptedLLM([DROP, lookup(q, "/tmp")]), WORK / "null", WORK / "sbx-null", label="null")
    assert null["reward"] == 0.0, null

    # relabel the edit at call 0: same edit, context saved first -> the later lookup finds the line
    hooked = replay(base, 0, ScriptedLLM([DROP, lookup(q, "/tmp")]), WORK / "hook", WORK / "sbx-hook",
                    action_hook=offload_before_edit, label="offload_before_edit")
    assert hooked["reward"] == 1.0, hooked
    steps = Run(WORK / "hook").steps
    assert steps[0]["reply_source"] == "hooked" and "ctx_offload" in steps[0]["command"]
    assert steps[0]["raw_model"] == DROP                      # the model's own reply is kept beside it
    assert steps[1]["reply_source"] == "model"

    # replay from the later call with the context changed: put the lost line back
    def restore(messages):
        messages = list(messages)
        messages.insert(2, {"role": "user", "content": "[restored from history]\n" + q["line"]})
        return messages
    fixed = replay(base, 1, ScriptedLLM([lookup(q, "/tmp/.live_ctx")]), WORK / "restore", WORK / "sbx-restore",
                   edit_messages=restore, label="restore_line")
    assert fixed["reward"] == 1.0, fixed


if __name__ == "__main__":
    test_replay()
    shutil.rmtree(WORK, ignore_errors=True)
    print("ok")
