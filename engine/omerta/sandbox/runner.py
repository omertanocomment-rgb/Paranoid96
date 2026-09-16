"""Phase 8 — Sandbox.

Sandbox is the default execution layer. Detects docker/podman/bubblewrap and runs
commands with resource/network limits. OMERTA reports honestly when no isolation
backend is available rather than pretending a command was sandboxed.
"""
from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import Config


@dataclass
class RunResult:
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str
    duration: float
    backend: str
    isolated: bool


def _daemon_ok(exe: str) -> bool:
    """docker/podman need a reachable daemon, not just the client binary."""
    try:
        return subprocess.run([exe, "info"], capture_output=True,
                              timeout=6).returncode == 0
    except Exception:  # noqa: BLE001
        return False


def detect_backend(preferred: str = "auto") -> str:
    candidates = ["docker", "podman", "bwrap"] if preferred == "auto" else [preferred]
    for c in candidates:
        exe = "bwrap" if c in ("bwrap", "bubblewrap") else c
        if not shutil.which(exe):
            continue
        if exe in ("docker", "podman") and not _daemon_ok(exe):
            continue  # binary present but daemon unreachable — report honestly, keep looking
        return "bubblewrap" if exe == "bwrap" else exe
    return "none"


class Sandbox:
    def __init__(self, config: Config | None = None, workspace: Path | None = None):
        self.config = config or Config.load()
        self.workspace = (workspace or Path.cwd()).resolve()
        self.backend = detect_backend(self.config.sandbox_backend)

    def status(self) -> dict:
        return {
            "configured": self.config.sandbox_backend,
            "active_backend": self.backend,
            "isolated": self.backend != "none",
            "network": self.config.sandbox_network,
            "workspace": str(self.workspace),
        }

    def run(self, command: list[str], timeout: int = 600, memory_mb: int = 2048,
            cpus: str = "2", allow_network: bool | None = None) -> RunResult:
        net = self.config.sandbox_network == "allow" if allow_network is None else allow_network
        start = time.time()
        argv = self._wrap(command, memory_mb, cpus, net)
        try:
            p = subprocess.run(argv, cwd=str(self.workspace), capture_output=True,
                               text=True, timeout=timeout)
            rc, out, err = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired as e:
            rc, out, err = 124, e.stdout or "", f"timeout after {timeout}s"
        return RunResult(argv, rc, out, err, time.time() - start,
                         self.backend, self.backend != "none")

    def _wrap(self, command: list[str], memory_mb: int, cpus: str, net: bool) -> list[str]:
        if self.backend in ("docker", "podman"):
            args = [self.backend, "run", "--rm", "-w", "/ws",
                    "-v", f"{self.workspace}:/ws",
                    f"--memory={memory_mb}m", f"--cpus={cpus}", "--pids-limit=512"]
            if not net:
                args += ["--network=none"]
            args += ["python:3.12-slim", "sh", "-lc", " ".join(_q(c) for c in command)]
            return args
        if self.backend == "bubblewrap":
            args = ["bwrap", "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib",
                    "--ro-bind", "/lib64", "/lib64", "--ro-bind", "/bin", "/bin",
                    "--bind", str(self.workspace), str(self.workspace),
                    "--chdir", str(self.workspace), "--proc", "/proc", "--dev", "/dev",
                    "--die-with-parent"]
            if not net:
                args += ["--unshare-net"]
            args += command
            return args
        # No backend: run directly (reported as not isolated).
        return command


def _q(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"
