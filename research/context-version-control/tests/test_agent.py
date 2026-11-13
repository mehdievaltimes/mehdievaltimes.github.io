"""The agent loop with a scripted model: offload, edit, history export, grading, provenance."""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from clmlite.agent import Config, is_ready_command, parse_reply
from clmlite.llm import ScriptedLLM
from clmlite.run import run_one
from clmlite.tasks import make_kv
from ctxvc.blame import History
from ctxvc.store import Run

WORK = Path("/home/user/ctxvc-work/test")


def test_ready_detection():
    assert is_ready_command("echo READY_FOR_NEXT_OP", 0)
    assert is_ready_command("printf 'x'; echo READY_FOR_NEXT_OP", 0)
    assert is_ready_command("python3 - <<'PY' && echo READY_FOR_NEXT_OP\nprint(1)\nPY", 0)
    assert not is_ready_command("grep READY_FOR_NEXT_OP file", 0)
    assert not is_ready_command("python3 - <<'PY'\nprint('x')\necho READY_FOR_NEXT_OP\nPY", 0)
    assert not is_ready_command("echo READY_FOR_NEXT_OP", 1)
    assert parse_reply("THOUGHT: hi\n```bash\nls -la\n```\nmore") == ("hi", "ls -la")
    assert parse_reply("no command here")[1] is None


def test_loop_with_history():
    task = make_kv(seed=3, n_batches=2, per_batch=5, n_get=1)
    q = task.gold["queries"][0]
    delete_turn_1 = ("THOUGHT: drop the first batch from context; it stays in the history.\n```bash\n"
                     "python3 - <<'PY' && echo READY_FOR_NEXT_OP\n"
                     "import re; p='/tmp/.live_ctx/LIVE_CTX_MAIN.txt'; s=open(p).read()\n"
                     "s=re.sub(r'(\\[\\[CTX_TURN 1 [^\\]]*\\]\\]).*?(?=\\n\\[\\[CTX_TURN|\\Z)', r'\\1\\n[batch 0 dropped]', s, flags=re.S)\n"
                     "open(p,'w').write(s)\nPY\n```")
    answer = ("THOUGHT: look the key up in the read-only history.\n```bash\n"
              f"val=$(grep -m1 -h 'SET {q['key']} =' /ctx_history/transcript.txt | sed 's/^SET [^=]* = //'); "
              f"printf '<<<ANSWER key={q['key']}>>>\\n%s\\n<<<ANSWER END>>>\\n' \"$val\"; echo READY_FOR_NEXT_OP\n```")
    tamper = "THOUGHT: try to rewrite history.\n```bash\necho gone > /ctx_history/transcript.txt; echo READY_FOR_NEXT_OP\n```"
    llm = ScriptedLLM([delete_turn_1, tamper, answer])
    cfg = Config(budget=6000, reserve=600, history=True, max_calls=10)
    run_dir, sb = WORK / "run", WORK / "sbx"
    r = run_one(task, cfg, llm, run_dir, sb, {"condition": "history"})
    assert r["terminated_by"] == "stream_exhausted", r
    assert r["reward"] == 1.0, r
    assert r["n_edits"] == 1

    h = History(Run(run_dir))
    assert [t.kind for t in h.transitions] == ["edit", "append", "append"]
    edit = h.transitions[0]
    assert any(q["key"] in l.text or "SET K" in l.text for l in edit.removed)
    assert any("[batch 0 dropped]" in l.text for l in edit.written)
    # the model's attempt to overwrite the history failed, and the transcript is intact
    assert "Read-only file system" in h.transitions[1].observation
    assert f"SET {q['key']} =" in (sb / "history" / "transcript.txt").read_text()
    # the value left the context at call 0 and came back through the history at call 2
    f = h.fate(f"SET {q['key']} = {q['value']}") if q["batch"] == 0 else None
    if f:
        assert f["lost_at_call"] == 0 and f["lost_by"] == "edit"
    ok, msg = h.run.verify()
    assert ok, msg


if __name__ == "__main__":
    test_ready_detection()
    test_loop_with_history()
    shutil.rmtree(WORK, ignore_errors=True)
    print("ok")
