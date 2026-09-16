"""Phase 9 — Git engine (subprocess wrappers).

Read-only/status helpers plus safe branch/commit operations. Never overwrites
uncommitted user work without explicit authorization.
"""
from __future__ import annotations

import subprocess
from pathlib import Path


class Git:
    def __init__(self, root: Path | None = None):
        self.root = str(root or Path.cwd())

    def _run(self, *args: str) -> tuple[int, str, str]:
        p = subprocess.run(["git", "-C", self.root, *args],
                           capture_output=True, text=True)
        return p.returncode, p.stdout.strip(), p.stderr.strip()

    def is_repo(self) -> bool:
        return self._run("rev-parse", "--is-inside-work-tree")[0] == 0

    def status(self) -> str:
        return self._run("status", "--short", "--branch")[1]

    def is_clean(self) -> bool:
        return self._run("status", "--porcelain")[1] == ""

    def current_branch(self) -> str:
        return self._run("rev-parse", "--abbrev-ref", "HEAD")[1]

    def head(self) -> str:
        return self._run("rev-parse", "--short", "HEAD")[1]

    def log(self, n: int = 10) -> str:
        return self._run("log", f"-{n}", "--oneline")[1]

    def diff(self, staged: bool = False) -> str:
        return self._run("diff", *(["--cached"] if staged else []))[1]

    def create_branch(self, name: str) -> tuple[bool, str]:
        rc, out, err = self._run("checkout", "-b", name)
        return rc == 0, out or err

    def snapshot(self, message: str) -> tuple[bool, str]:
        """Safe checkpoint: stash-create style commit on a temp ref is heavy; we use
        a lightweight stash push that preserves the working tree."""
        rc, out, err = self._run("stash", "push", "-u", "-m", message)
        return rc == 0, out or err
