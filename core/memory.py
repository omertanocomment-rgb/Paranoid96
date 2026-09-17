"""
Persistent memory + preference learning.

Three layers:
  1. facts      — durable knowledge (decisions, fixes, snippets, project info)
  2. choices    — every approve/deny/edit you make, so the agent learns your
                  patterns ("you always deny fastboot erase", "you always
                  approve git status")
  3. sessions   — rolling session summaries

SQLite + FTS5. No embedding model needed (phone-friendly, fully offline),
but a `vector` BLOB column is reserved so semantic recall can be bolted on
later without a migration.
"""
import sqlite3
import time
import json
import re
import uuid
from contextlib import contextmanager
from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE,
    project TEXT DEFAULT 'general',
    kind TEXT DEFAULT 'fact',
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    weight REAL DEFAULT 1.0,
    created_at REAL,
    updated_at REAL,
    origin TEXT DEFAULT '',
    deleted INTEGER DEFAULT 0,
    vector BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    content, project, tags, content='facts', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, content, project, tags)
    VALUES (new.id, new.content, new.project, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, content, project, tags)
    VALUES ('delete', old.id, old.content, old.project, old.tags);
END;

CREATE TABLE IF NOT EXISTS choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE,
    project TEXT DEFAULT 'general',
    subject TEXT NOT NULL,      -- normalized command / action signature
    raw TEXT,                   -- the exact thing proposed
    decision TEXT NOT NULL,     -- approved | denied | edited
    note TEXT DEFAULT '',       -- user's edit or reason, if any
    created_at REAL,
    origin TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_choices_subject ON choices(subject);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT, started_at REAL, ended_at REAL, summary TEXT
);
"""


@contextmanager
def _conn():
    # timeout lets concurrent writers (e.g. parallel role agents) wait for the
    # lock instead of failing with "database is locked".
    c = sqlite3.connect(config.MEMORY_DB, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        c.execute("PRAGMA busy_timeout=10000")
        yield c
        c.commit()
    finally:
        c.close()


def _device_id():
    """Stable per-install id so synced rows know where they came from."""
    f = config.DATA_DIR / "device.json"
    if f.exists():
        try:
            return json.loads(f.read_text())["device"]
        except Exception:  # noqa: BLE001
            pass
    import socket
    import uuid as _u
    did = f"{socket.gethostname()[:20]}-{_u.uuid4().hex[:8]}"
    f.write_text(json.dumps({"device": did}))
    return did


DEVICE = None


def device():
    global DEVICE
    if DEVICE is None:
        DEVICE = _device_id()
    return DEVICE


def _migrate(c):
    """Add sync columns to databases created before sync existed."""
    for table, cols in (("facts", [("uid", "TEXT"), ("updated_at", "REAL"),
                                   ("origin", "TEXT DEFAULT \'\'"),
                                   ("deleted", "INTEGER DEFAULT 0")]),
                        ("choices", [("uid", "TEXT"), ("origin", "TEXT DEFAULT \'\'")])):
        have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}
        if not have:
            continue
        for col, decl in cols:
            if col not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    # backfill uids for pre-existing rows
    for table in ("facts", "choices"):
        try:
            rows = c.execute(f"SELECT id FROM {table} WHERE uid IS NULL").fetchall()
        except sqlite3.OperationalError:
            continue
        for r in rows:
            c.execute(f"UPDATE {table} SET uid=? WHERE id=?",
                      (uuid.uuid4().hex, r["id"]))
    try:
        c.execute("UPDATE facts SET updated_at=created_at WHERE updated_at IS NULL")
    except sqlite3.OperationalError:
        pass


def init():
    with _conn() as c:
        c.executescript(SCHEMA)
        _migrate(c)


# ── facts ────────────────────────────────────────────────────────────────
def remember(content, project="general", kind="fact", tags="", weight=1.0):
    """Store a fact and return its id.

    The id is the whole point: without it a caller that stores something has
    no way to take it back out again later, and `forget` becomes unusable for
    anything it did not go looking for by hand.
    """
    init()
    with _conn() as c:
        now = time.time()
        cur = c.execute("INSERT INTO facts (uid,project,kind,content,tags,weight,"
                        "created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?,?,?)",
                        (uuid.uuid4().hex, project, kind, content, tags, weight,
                         now, now, device()))
        return cur.lastrowid


def forget(fact_id):
    """Soft-delete: tombstoned so the deletion syncs instead of the row
    being resurrected by the next peer that still has it."""
    with _conn() as c:
        c.execute("UPDATE facts SET deleted=1, updated_at=? WHERE id=?",
                  (time.time(), fact_id))
        c.execute("DELETE FROM facts_fts WHERE rowid=?", (fact_id,))
    return f"forgot fact {fact_id}"


SHARED_PROJECT = "general"


def _project_clause(project, shared):
    """SQL fragment + params for 'this project, plus shared knowledge'.

    Scoping recall to a project is right — notes about one device should not
    bleed into work on another. But scoping it to ONLY that project hides
    everything learned before the project existed, which is how an agent ends
    up asking you something you taught it last week. So `general` rides along
    unless the caller asks for strict isolation.
    """
    if not project:
        return "", []
    if not shared or project == SHARED_PROJECT:
        return "AND project = ? ", [project]
    return "AND project IN (?,?) ", [project, SHARED_PROJECT]


def recall(query="", project=None, top_k=8, kind=None, shared=True):
    init()
    with _conn() as c:
        if query:
            terms = re.findall(r"[A-Za-z0-9_./-]{3,}", query)[:8]
            if terms:
                match = " OR ".join(terms)
                sql = ("SELECT facts.* FROM facts_fts JOIN facts "
                       "ON facts.id = facts_fts.rowid WHERE facts_fts MATCH ? "
                       "AND COALESCE(facts.deleted,0)=0 ")
                params = [match]
                clause, extra = _project_clause(project, shared)
                sql += clause.replace("project", "facts.project", 1)
                params += extra
                if kind:
                    sql += "AND facts.kind = ? "
                    params.append(kind)
                sql += "ORDER BY facts.weight DESC, facts.created_at DESC LIMIT ?"
                params.append(top_k)
                try:
                    return [dict(r) for r in c.execute(sql, params).fetchall()]
                except sqlite3.OperationalError:
                    pass
        sql, params = "SELECT * FROM facts WHERE COALESCE(deleted,0)=0 ", []
        clause, extra = _project_clause(project, shared)
        sql += clause
        params += extra
        if kind:
            sql += "AND kind = ? "
            params.append(kind)
        sql += "ORDER BY weight DESC, created_at DESC LIMIT ?"
        params.append(top_k)
        return [dict(r) for r in c.execute(sql, params).fetchall()]


# ── choice learning ──────────────────────────────────────────────────────
SUBCOMMAND_TOOLS = {
    "git", "fastboot", "adb", "npm", "yarn", "pnpm", "docker", "pip", "pip3",
    "apt", "apt-get", "pkg", "cargo", "go", "gradle", "./gradlew", "systemctl",
    "kubectl", "brew", "conda", "heimdall", "openssl", "keytool",
}


def normalize_subject(raw: str) -> str:
    """Turn a concrete command into a reusable signature so a decision about
    one instance transfers to the whole family.

        rm -rf build                -> rm
        fastboot erase userdata     -> fastboot erase
        git commit -m "fix auth"    -> git commit
    """
    s = raw.strip()
    s = re.sub(r'"[^"]*"|\'[^\']*\'', " ", s)       # drop quoted strings
    s = re.sub(r"-{1,2}[A-Za-z0-9][\w-]*", " ", s)      # drop flags
    toks = [t for t in s.split() if t]
    if not toks:
        return raw.strip()[:40]
    head = toks[0]
    if head in SUBCOMMAND_TOOLS and len(toks) > 1 and re.fullmatch(r"[a-z][\w-]*", toks[1]):
        return f"{head} {toks[1]}"
    return head


def record_choice(raw, decision, project="general", note=""):
    """Called every time you approve / deny / edit a proposed action."""
    init()
    subj = normalize_subject(raw)
    with _conn() as c:
        c.execute("INSERT INTO choices (uid,project,subject,raw,decision,note,"
                  "created_at,origin) VALUES (?,?,?,?,?,?,?,?)",
                  (uuid.uuid4().hex, project, subj, raw, decision, note,
                   time.time(), device()))
    # a denial is a strong signal — promote it to a durable fact too
    if decision == "denied":
        remember(f"User DENIED `{raw}` — do not propose this pattern again "
                 f"without a clear reason.{(' Reason: ' + note) if note else ''}",
                 project=project, kind="preference", tags="denial", weight=2.0)
    elif decision == "edited" and note:
        remember(f"User rewrote `{raw}` as `{note}` — prefer their form.",
                 project=project, kind="preference", tags="correction", weight=2.0)
    return subj


def choice_stats(subject=None, project=None):
    init()
    with _conn() as c:
        sql, params = ("SELECT subject, decision, COUNT(*) n FROM choices WHERE 1=1 ", [])
        if subject:
            sql += "AND subject = ? "
            params.append(subject)
        if project:
            sql += "AND project = ? "
            params.append(project)
        sql += "GROUP BY subject, decision"
        rows = c.execute(sql, params).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r["subject"], {})[r["decision"]] = r["n"]
    return out


def predict(raw, project=None):
    """What would the user probably do with this action? Advisory only —
    ALWAYS_ASK still means we ask. This just lets the agent pre-empt
    ('you've denied this 3 times, want me to try X instead?')."""
    subj = normalize_subject(raw)
    stats = choice_stats(subject=subj, project=project).get(subj, {})
    a, d = stats.get("approved", 0), stats.get("denied", 0)
    total = a + d + stats.get("edited", 0)
    if total == 0:
        return {"subject": subj, "seen": 0, "hint": None}
    if d and d >= a:
        return {"subject": subj, "seen": total, "hint": "likely_deny",
                "detail": f"you've denied this {d}x / approved {a}x"}
    if a >= 3 and d == 0:
        return {"subject": subj, "seen": total, "hint": "routinely_approved",
                "detail": f"you've approved this {a}x with no denials"}
    return {"subject": subj, "seen": total, "hint": "mixed",
            "detail": f"approved {a}x, denied {d}x"}


def preference_block(project=None, top_k=12, shared=True) -> str:
    """Learned preferences rendered for the system prompt.

    Takes `shared` like recall does — strict project isolation has to cover
    preferences too, or the one channel that actually steers behaviour leaks
    across projects while the facts stay separated.
    """
    prefs = recall("", project=project, top_k=top_k, kind="preference",
                   shared=shared)
    stats = choice_stats(project=project)
    lines = []
    if prefs:
        lines.append("[Learned preferences — from your past approvals/denials]")
        lines += [f"- {p['content']}" for p in prefs]
    routine = [s for s, d in stats.items()
               if d.get("approved", 0) >= 3 and d.get("denied", 0) == 0]
    blocked = [s for s, d in stats.items()
               if d.get("denied", 0) >= 2 and d.get("denied", 0) > d.get("approved", 0)]
    if routine:
        lines.append(f"- Routinely approved by this user: {', '.join(sorted(routine)[:12])}")
    if blocked:
        lines.append(f"- Repeatedly REFUSED by this user: {', '.join(sorted(blocked)[:12])}"
                     " — propose an alternative instead.")
    return "\n".join(lines)


# ── sessions ─────────────────────────────────────────────────────────────
def start_session(project="general"):
    init()
    with _conn() as c:
        return c.execute("INSERT INTO sessions (project,started_at) VALUES (?,?)",
                         (project, time.time())).lastrowid


def end_session(sid, summary):
    with _conn() as c:
        c.execute("UPDATE sessions SET ended_at=?, summary=? WHERE id=?",
                  (time.time(), summary, sid))


def context_block(query, project=None, top_k=8, shared=True) -> str:
    hits = recall(query, project=project, top_k=top_k, shared=shared)
    if not hits:
        return ""
    lines = ["[Recalled memory from past sessions]"]
    lines += [f"- ({h['kind']}) {h['content']}" for h in hits]
    return "\n".join(lines)


def stats():
    init()
    with _conn() as c:
        f = c.execute("SELECT COUNT(*) n FROM facts WHERE COALESCE(deleted,0)=0").fetchone()["n"]
        ch = c.execute("SELECT COUNT(*) n FROM choices").fetchone()["n"]
        s = c.execute("SELECT COUNT(*) n FROM sessions").fetchone()["n"]
        projects = [r["project"] for r in
                    c.execute("SELECT DISTINCT project FROM facts WHERE COALESCE(deleted,0)=0").fetchall()]
    return {"facts": f, "choices": ch, "sessions": s, "projects": projects,
            "device": device()}


if __name__ == "__main__":
    init()
    print("memory ready:", stats())
