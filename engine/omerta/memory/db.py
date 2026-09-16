"""Phase 5 — Learning & Memory.

Persistent SQLite memory with explicit teach/forget/show/search. Every item stores
scope, type, source/provenance, timestamp, confidence and status.
"""
from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..config import home_dir

SCOPES = ("global", "project", "session")
TYPES = ("FACT", "LESSON", "PROCEDURE", "FAILURE", "SUCCESS", "RULE", "NOTE")


@dataclass
class MemoryItem:
    id: int
    scope: str
    type: str
    key: str
    value: str
    source: str
    confidence: float
    status: str
    created_at: float

    def render(self) -> str:
        return (f"#{self.id} [{self.scope}/{self.type}] {self.key}: {self.value} "
                f"(src={self.source}, conf={self.confidence:.2f}, {self.status})")


class Memory:
    def __init__(self, db_path: Optional[Path] = None):
        self.path = db_path or (home_dir() / "memory.db")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                type TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'user',
                confidence REAL NOT NULL DEFAULT 1.0,
                status TEXT NOT NULL DEFAULT 'active',
                created_at REAL NOT NULL
            )
            """
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_scope_type ON memory(scope, type)")
        self.conn.commit()

    def teach(self, key: str, value: str, scope: str = "project", type: str = "LESSON",
              source: str = "user", confidence: float = 1.0) -> int:
        if scope not in SCOPES:
            raise ValueError(f"scope must be one of {SCOPES}")
        if type not in TYPES:
            raise ValueError(f"type must be one of {TYPES}")
        cur = self.conn.execute(
            "INSERT INTO memory(scope,type,key,value,source,confidence,status,created_at) "
            "VALUES(?,?,?,?,?,?, 'active', ?)",
            (scope, type, key, value, source, confidence, time.time()),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def forget(self, item_id: int) -> bool:
        cur = self.conn.execute(
            "UPDATE memory SET status='forgotten' WHERE id=? AND status='active'", (item_id,)
        )
        self.conn.commit()
        return cur.rowcount > 0

    def show(self, scope: Optional[str] = None, type: Optional[str] = None,
             include_inactive: bool = False) -> list[MemoryItem]:
        q = "SELECT * FROM memory WHERE 1=1"
        args: list = []
        if not include_inactive:
            q += " AND status='active'"
        if scope:
            q += " AND scope=?"; args.append(scope)
        if type:
            q += " AND type=?"; args.append(type)
        q += " ORDER BY created_at DESC"
        return [self._row(r) for r in self.conn.execute(q, args)]

    def search(self, term: str) -> list[MemoryItem]:
        like = f"%{term}%"
        rows = self.conn.execute(
            "SELECT * FROM memory WHERE status='active' AND (key LIKE ? OR value LIKE ?) "
            "ORDER BY created_at DESC", (like, like),
        )
        return [self._row(r) for r in rows]

    def record_outcome(self, ok: bool, key: str, value: str, source: str = "buildloop") -> int:
        """Store a SUCCESS/FAILURE for the recovery engine (Phase 12)."""
        return self.teach(key, value, scope="project",
                          type="SUCCESS" if ok else "FAILURE", source=source)

    def learned_context(self, limit: int = 40) -> str:
        """Format durable teachings (RULE/LESSON/FACT/PROCEDURE) for the system prompt,
        so the model applies what the operator has taught it."""
        rows = self.conn.execute(
            "SELECT scope,type,key,value FROM memory "
            "WHERE status='active' AND type IN ('RULE','LESSON','FACT','PROCEDURE') "
            "ORDER BY CASE type WHEN 'RULE' THEN 0 WHEN 'PROCEDURE' THEN 1 "
            "WHEN 'FACT' THEN 2 ELSE 3 END, created_at DESC LIMIT ?", (limit,)).fetchall()
        if not rows:
            return ""
        lines = ["Operator-taught knowledge (apply unless it conflicts with safety):"]
        for r in rows:
            lines.append(f"- [{r['type']}] {r['key']}: {r['value']}")
        return "\n".join(lines)

    @staticmethod
    def _row(r: sqlite3.Row) -> MemoryItem:
        return MemoryItem(
            id=r["id"], scope=r["scope"], type=r["type"], key=r["key"], value=r["value"],
            source=r["source"], confidence=r["confidence"], status=r["status"],
            created_at=r["created_at"],
        )

    def close(self) -> None:
        self.conn.close()
