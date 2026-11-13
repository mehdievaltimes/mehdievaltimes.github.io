"""Where the model's shell commands run.

Each command runs as an unprivileged user inside a private mount and network
namespace:

* ``/tmp`` is this run's own directory (so parallel runs never see each other);
* ``/ctx_history`` is the run's history, mounted read-only;
* ``/home`` and ``/root`` are empty, and there is no network.

The harness (root, outside the namespace) is the only writer of the history, so
"the model cannot rewrite its history" is enforced by the kernel, not by a prompt.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tarfile
from pathlib import Path

CTX_DIR = "/tmp/.live_ctx"
CTX_FILE = f"{CTX_DIR}/LIVE_CTX_MAIN.txt"
NOBODY = 65534

_OUTER = """set -e
mkdir -p /ctx_history /ctx_bin
mount --bind {hist} /ctx_history
mount -o remount,bind,ro /ctx_history
mount --bind {bin} /ctx_bin
mount -o remount,bind,ro /ctx_bin
mount --bind {tmp} /tmp
mount -t tmpfs -o size=1m,mode=755 tmpfs /root
mount -t tmpfs -o size=1m,mode=755 tmpfs /home
exec setpriv --reuid={uid} --regid={uid} --clear-groups --no-new-privs bash /ctx_bin/run.sh
"""

_RUN = """export HOME=/tmp/work PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8
ulimit -t 60 -f 400000 -u 512 2>/dev/null
mkdir -p /tmp/work /tmp/.bash_ctx_state
cd "$(cat /tmp/.bash_ctx_state/cwd 2>/dev/null || echo /tmp/work)" 2>/dev/null || cd /tmp/work
. /ctx_bin/cmd.sh
_ec=$?
pwd > /tmp/.bash_ctx_state/cwd 2>/dev/null
exit $_ec
"""


class Sandbox:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.tmp = self.root / "tmp"
        self.hist = self.root / "history"
        self.bin = self.root / "bin"
        for d in (self.tmp, self.hist, self.bin, self.hist / "versions"):
            d.mkdir(parents=True, exist_ok=True)
        os.chmod(self.root, 0o755)
        os.chmod(self.tmp, 0o1777)
        os.chmod(self.hist, 0o755)
        os.chmod(self.hist / "versions", 0o755)
        os.chmod(self.bin, 0o755)
        (self.bin / "outer.sh").write_text(_OUTER.format(hist=self.hist, bin=self.bin, tmp=self.tmp, uid=NOBODY))
        (self.bin / "run.sh").write_text(_RUN)
        self._own(self.tmp / ".live_ctx", make=True)
        self._own(self.tmp / "work", make=True)

    def _own(self, path: Path, make: bool = False) -> None:
        if make:
            path.mkdir(parents=True, exist_ok=True)
        os.chown(path, NOBODY, NOBODY)

    # ------------------------------------------------------------- context file
    @property
    def ctx_path(self) -> Path:
        return self.tmp / ".live_ctx" / "LIVE_CTX_MAIN.txt"

    def write_ctx(self, text: str) -> None:
        self._own(self.tmp / ".live_ctx", make=True)
        self.ctx_path.unlink(missing_ok=True)
        self.ctx_path.write_text(text, encoding="utf-8")
        self._own(self.ctx_path)

    def read_ctx(self) -> str | None:
        try:
            return self.ctx_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

    def put_file(self, rel: str, content: str, *, writable: bool = False) -> None:
        """Place a task file under the sandbox /tmp (read-only to the model by default)."""
        p = self.tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        os.chmod(p, 0o644)
        if writable:
            self._own(p)

    # ------------------------------------------------------------------- exec
    def exec(self, command: str, timeout: int = 90) -> tuple[int, str, str]:
        (self.bin / "cmd.sh").write_text(command + "\n", encoding="utf-8")
        try:
            p = subprocess.run(["unshare", "-m", "-n", "--", "bash", str(self.bin / "outer.sh")],
                               capture_output=True, timeout=timeout, cwd="/")
            return (p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace"))
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or b"").decode("utf-8", "replace")
            return 124, out, f"[command timed out after {timeout}s]"

    # --------------------------------------------------------------- snapshots
    def save(self, tar_path: Path | str) -> None:
        with tarfile.open(tar_path, "w") as tar:
            tar.add(str(self.tmp), arcname=".")

    def restore(self, tar_path: Path | str) -> None:
        for child in self.tmp.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        with tarfile.open(tar_path, "r") as tar:
            tar.extractall(str(self.tmp), filter="tar")
        os.chmod(self.tmp, 0o1777)
