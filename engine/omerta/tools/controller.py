"""Phase 7 — Tool system.

Typed operations with declared permissions, validation and approval requirements —
not unrestricted shell text. Destructive/host operations require approval.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..sandbox.runner import Sandbox, RunResult


@dataclass
class Tool:
    name: str
    group: str
    description: str
    requires_approval: bool
    sandboxed: bool
    fn: Callable


class ApprovalRequired(Exception):
    pass


class ToolController:
    def __init__(self, root: Path | None = None, approver: Callable[[Tool, dict], bool] | None = None):
        self.root = (root or Path.cwd()).resolve()
        self.sandbox = Sandbox(workspace=self.root)
        # approver returns True to allow; default denies approval-required tools.
        self.approver = approver or (lambda tool, args: False)
        self._tools: dict[str, Tool] = {}
        self._register_builtins()

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def list(self) -> list[Tool]:
        return sorted(self._tools.values(), key=lambda t: (t.group, t.name))

    def call(self, name: str, **kwargs):
        tool = self._tools[name]
        if tool.requires_approval and not self.approver(tool, kwargs):
            raise ApprovalRequired(f"tool '{name}' requires approval")
        return tool.fn(**kwargs)

    # ---- builtins (Phase 7 tool groups) ----
    def _register_builtins(self):
        # filesystem
        self.register(Tool("fs.read", "filesystem", "Read a file", False, False, self._read))
        self.register(Tool("fs.list", "filesystem", "List a directory", False, False, self._list))
        self.register(Tool("fs.write", "filesystem", "Write a file", True, False, self._write))
        # terminal / process
        self.register(Tool("terminal.run", "terminal", "Run a command in the sandbox",
                           True, True, self._run))
        self.register(Tool("process.list", "process", "List running processes", False, False, self._ps))
        # search
        self.register(Tool("search.grep", "search", "Search text in the workspace",
                           False, False, self._grep))
        # git
        self.register(Tool("git.status", "git", "Git status of the workspace", False, False, self._git_status))
        self.register(Tool("git.diff", "git", "Git working-tree diff", False, False, self._git_diff))
        # build / test / package
        self.register(Tool("build.run", "build", "Run a build command (evidence-captured)",
                           True, True, self._build))
        self.register(Tool("test.run", "test", "Run tests (evidence-captured)", True, True, self._test))
        self.register(Tool("package.build", "package", "Run a packaging command",
                           True, True, self._build))
        # firmware-analysis
        self.register(Tool("firmware.inspect", "firmware-analysis", "Inspect a firmware image",
                           False, False, self._fw_inspect))
        self.register(Tool("firmware.tool", "firmware-analysis", "Run a firmware toolchain binary",
                           True, True, self._fw_tool))
        # device-I/O (adb/fastboot) — never flashes without approval
        self.register(Tool("device.adb", "device-io", "Run an adb command", True, True, self._adb))
        self.register(Tool("device.fastboot", "device-io", "Run a fastboot command (destructive!)",
                           True, True, self._fastboot))

    def _safe(self, rel: str) -> Path:
        p = (self.root / rel).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError("path escapes workspace")
        return p

    def _read(self, path: str) -> str:
        return self._safe(path).read_text(errors="ignore")

    def _list(self, path: str = ".") -> list[str]:
        return sorted(p.name for p in self._safe(path).iterdir())

    def _write(self, path: str, content: str) -> int:
        p = self._safe(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p.write_text(content)

    def _run(self, command: list[str], timeout: int = 600) -> RunResult:
        return self.sandbox.run(command, timeout=timeout)

    def _grep(self, term: str) -> list[str]:
        from ..codebase.index import Index
        idx = Index(self.root)
        hits = idx.search(term, max_hits=50)
        idx.close()
        return [f"{h.path}:{h.line}: {h.text}" for h in hits]

    def _ps(self) -> str:
        import subprocess
        return subprocess.run(["ps", "-eo", "pid,comm,args"], capture_output=True,
                              text=True, timeout=15).stdout[-8000:]

    def _git_status(self) -> str:
        from ..gitengine.engine import Git
        return Git(self.root).status()

    def _git_diff(self, staged: bool = False) -> str:
        from ..gitengine.engine import Git
        return Git(self.root).diff(staged)[:20000]

    def _build(self, command: list[str], artifact: list[str] | None = None):
        from ..buildloop.loop import BuildLoop
        ev = BuildLoop(root=self.root).run(command, artifacts=artifact or [])
        return ev.evidence().render() + ("\n" + ev.stderr_tail if not ev.ok else "")

    def _test(self, command: list[str] | None = None):
        return self._build(command or ["pytest", "-q"])

    def _fw_inspect(self, image: str):
        from ..firmware.inspect import inspect_image
        return inspect_image(image)

    def _fw_tool(self, name: str, args: list[str] | None = None):
        from ..firmware.inspect import run_tool
        return run_tool(name, args or [], cwd=str(self.root))

    def _adb(self, args: list[str]):
        return self.sandbox.run(["adb", *args], timeout=120)

    def _fastboot(self, args: list[str]):
        return self.sandbox.run(["fastboot", *args], timeout=120)
