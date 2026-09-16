"""Phase 6 — Codebase intelligence.

Indexes a repository into SQLite: files, and simple symbol definitions extracted by
language-agnostic regexes. Search uses ripgrep when present, else a Python fallback.
"""
from __future__ import annotations

import os
import re
import shutil
import sqlite3
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "build", "dist", ".gradle",
             "__pycache__", ".idea", "out", ".omerta"}
TEXT_EXT = {".py", ".kt", ".java", ".js", ".ts", ".tsx", ".jsx", ".c", ".h", ".cc",
            ".cpp", ".hpp", ".rs", ".go", ".sh", ".rb", ".swift", ".gradle", ".kts",
            ".toml", ".md", ".txt", ".json", ".yml", ".yaml", ".dts", ".dtsi"}

SYMBOL_RE = re.compile(
    r"^\s*(?:pub\s+|public\s+|private\s+|export\s+|async\s+|final\s+|static\s+)*"
    r"(?:def|class|fn|func|function|interface|struct|enum|object|trait)\s+([A-Za-z_][A-Za-z0-9_]*)",
)


@dataclass
class Hit:
    path: str
    line: int
    text: str


class Index:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.dir = self.root / ".omerta"
        self.dir.mkdir(exist_ok=True)
        self.db = sqlite3.connect(str(self.dir / "index.db"))
        self._schema()

    def _schema(self):
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, size INTEGER, mtime REAL, lines INTEGER);
            CREATE TABLE IF NOT EXISTS symbols(name TEXT, path TEXT, line INTEGER);
            CREATE INDEX IF NOT EXISTS idx_sym ON symbols(name);
            CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
            """
        )
        self.db.commit()

    def build(self) -> tuple[int, int]:
        self.db.execute("DELETE FROM files")
        self.db.execute("DELETE FROM symbols")
        nfiles = nsym = 0
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                fp = Path(dirpath) / fn
                if fp.suffix.lower() not in TEXT_EXT:
                    continue
                try:
                    text = fp.read_text(errors="ignore")
                except OSError:
                    continue
                rel = str(fp.relative_to(self.root))
                lines = text.splitlines()
                st = fp.stat()
                self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?,?)",
                                (rel, st.st_size, st.st_mtime, len(lines)))
                nfiles += 1
                for i, ln in enumerate(lines, 1):
                    m = SYMBOL_RE.match(ln)
                    if m:
                        self.db.execute("INSERT INTO symbols VALUES(?,?,?)", (m.group(1), rel, i))
                        nsym += 1
        self.db.execute("INSERT OR REPLACE INTO meta VALUES('built_at', ?)", (str(time.time()),))
        self.db.commit()
        return nfiles, nsym

    def stats(self) -> tuple[int, int]:
        f = self.db.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        s = self.db.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
        return f, s

    def symbol(self, name: str) -> list[Hit]:
        rows = self.db.execute(
            "SELECT path, line FROM symbols WHERE name=? ORDER BY path", (name,)).fetchall()
        return [Hit(p, ln, name) for p, ln in rows]

    def search(self, term: str, max_hits: int = 100) -> list[Hit]:
        rg = shutil.which("rg")
        if rg:
            try:
                out = subprocess.run(
                    [rg, "-n", "--no-heading", "-S", term, str(self.root)],
                    capture_output=True, text=True, timeout=60)
                hits = []
                for line in out.stdout.splitlines()[:max_hits]:
                    parts = line.split(":", 2)
                    if len(parts) == 3:
                        hits.append(Hit(os.path.relpath(parts[0], self.root),
                                        int(parts[1]), parts[2].strip()))
                return hits
            except Exception:  # noqa: BLE001
                pass
        # Python fallback
        hits: list[Hit] = []
        for row in self.db.execute("SELECT path FROM files"):
            fp = self.root / row[0]
            try:
                for i, ln in enumerate(fp.read_text(errors="ignore").splitlines(), 1):
                    if term.lower() in ln.lower():
                        hits.append(Hit(row[0], i, ln.strip()))
                        if len(hits) >= max_hits:
                            return hits
            except OSError:
                continue
        return hits

    def close(self):
        self.db.close()
