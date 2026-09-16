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

    # ---- builtins ----
    def _register_builtins(self):
        self.register(Tool("fs.read", "filesystem", "Read a file", False, False, self._read))
        self.register(Tool("fs.list", "filesystem", "List a directory", False, False, self._list))
        self.register(Tool("fs.write", "filesystem", "Write a file", True, False, self._write))
        self.register(Tool("terminal.run", "terminal", "Run a command in the sandbox",
                           True, True, self._run))
        self.register(Tool("search.grep", "search", "Search text in the workspace",
                           False, False, self._grep))

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
