"""
Cross-device memory sync.

One brain across Termux, Kali, the Mac, the Windows box and the phone —
without a cloud account in the middle. Two transports:

  peer  : device-to-device over HTTP on your LAN, using the same token auth
          as the web UI. Nothing leaves your network.
  file  : export a bundle to a path — an SD card, a USB stick, or a folder
          that Syncthing/Dropbox/Drive already replicates. Works fully
          offline and handles the "devices are never on at the same time"
          case.

Merge rules (deliberate, not incidental):
  * rows carry a uid, so re-syncing is idempotent — no duplicate explosion
  * facts merge last-write-wins on updated_at
  * tombstones (deleted=1) propagate, so "forget this" doesn't get undone
    by the next peer that still remembers it
  * choices are append-only history and never overwrite each other; the
    learned preference is recomputed from the merged set
  * a DENIED choice is never silently dropped in a conflict — safety
    signals only ever accumulate
"""
import json
import time
import sqlite3
import hashlib
from pathlib import Path

import requests

from . import config, memory

STATE_FILE = config.DATA_DIR / "sync_state.json"
BUNDLE_VERSION = 1

# A bundle arrives from another device or a shared folder. It is authenticated,
# but it is still input: coerce every field and bound the size so a malformed or
# hostile bundle returns a clean error instead of a traceback or a bloated DB.
MAX_BUNDLE_ROWS = 100_000
MAX_TEXT_LEN = 200_000


def _text(v, limit=MAX_TEXT_LEN):
    """Coerce a bundle field to a bounded string (sqlite binds only scalars)."""
    if v is None:
        return ""
    if not isinstance(v, str):
        if isinstance(v, (int, float, bool)):
            v = str(v)
        else:
            v = json.dumps(v, default=str)
    return v[:limit]


def _num(v, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if f != f or f in (float("inf"), float("-inf")) else f


def _flag(v):
    return 1 if v else 0


def _state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"peers": {}, "files": {}}


def _save_state(s):
    STATE_FILE.write_text(json.dumps(s, indent=2))


def last_sync(kind, key):
    return _state().get(kind, {}).get(key, {}).get("since", 0)


def _mark(kind, key, ts, result):
    s = _state()
    s.setdefault(kind, {})[key] = {"since": ts, "at": time.time(), "last": result}
    _save_state(s)


# ── export ───────────────────────────────────────────────────────────────
def export_bundle(since=0, project=None):
    """Everything changed since `since`, as a portable dict."""
    memory.init()
    con = sqlite3.connect(config.MEMORY_DB)
    con.row_factory = sqlite3.Row
    try:
        fq = ("SELECT uid,project,kind,content,tags,weight,created_at,"
              "COALESCE(updated_at,created_at) updated_at,origin,"
              "COALESCE(deleted,0) deleted FROM facts "
              "WHERE COALESCE(updated_at,created_at) > ?")
        fp = [since]
        cq = ("SELECT uid,project,subject,raw,decision,note,created_at,origin "
              "FROM choices WHERE created_at > ?")
        cp = [since]
        if project:
            fq += " AND project = ?"; fp.append(project)
            cq += " AND project = ?"; cp.append(project)
        facts = [dict(r) for r in con.execute(fq, fp).fetchall()]
        choices = [dict(r) for r in con.execute(cq, cp).fetchall()]
    finally:
        con.close()
    return {"version": BUNDLE_VERSION, "device": memory.device(),
            "exported_at": time.time(), "since": since,
            "facts": facts, "choices": choices}


# ── import / merge ───────────────────────────────────────────────────────
def merge_bundle(bundle):
    """Apply a bundle from another device. Idempotent."""
    if not isinstance(bundle, dict) or "facts" not in bundle:
        return {"status": "error", "reason": "not a valid sync bundle"}
    if _num(bundle.get("version", 1), 1) > BUNDLE_VERSION:
        return {"status": "error",
                "reason": f"bundle version {bundle['version']} newer than this "
                          f"install supports ({BUNDLE_VERSION}) — update first"}
    facts = bundle.get("facts") or []
    choices = bundle.get("choices") or []
    if not isinstance(facts, list) or not isinstance(choices, list):
        return {"status": "error",
                "reason": "malformed bundle: 'facts'/'choices' must be lists"}
    if len(facts) + len(choices) > MAX_BUNDLE_ROWS:
        return {"status": "error",
                "reason": f"bundle carries {len(facts) + len(choices)} rows "
                          f"(cap {MAX_BUNDLE_ROWS}); refusing to merge"}
    memory.init()
    con = sqlite3.connect(config.MEMORY_DB)
    con.row_factory = sqlite3.Row
    added = updated = skipped = tombstoned = 0
    ch_added = ch_skipped = 0
    try:
        for f in facts:
            if not isinstance(f, dict):
                skipped += 1
                continue
            uid = _text(f.get("uid"), 256)
            if not uid:
                continue
            row = con.execute("SELECT id, COALESCE(updated_at,created_at) u, "
                              "COALESCE(deleted,0) d FROM facts WHERE uid=?",
                              (uid,)).fetchone()
            incoming_u = _num(f.get("updated_at")) or _num(f.get("created_at"))
            if row is None:
                con.execute(
                    "INSERT INTO facts (uid,project,kind,content,tags,weight,"
                    "created_at,updated_at,origin,deleted) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (uid, _text(f.get("project") or "general", 256),
                     _text(f.get("kind") or "fact", 64),
                     _text(f.get("content")), _text(f.get("tags"), 4096),
                     _num(f.get("weight"), 1.0),
                     _num(f.get("created_at"), time.time()), incoming_u,
                     _text(f.get("origin") or bundle.get("device") or "", 256),
                     _flag(f.get("deleted"))))
                if f.get("deleted"):
                    tombstoned += 1
                else:
                    added += 1
            # row["u"] may be a string on a DB polluted by a pre-validation sync
            elif incoming_u > _num(row["u"]):
                con.execute("UPDATE facts SET project=?,kind=?,content=?,tags=?,"
                            "weight=?,updated_at=?,origin=?,deleted=? WHERE uid=?",
                            (_text(f.get("project") or "general", 256),
                             _text(f.get("kind") or "fact", 64),
                             _text(f.get("content")), _text(f.get("tags"), 4096),
                             _num(f.get("weight"), 1.0), incoming_u,
                             _text(f.get("origin"), 256),
                             _flag(f.get("deleted")), uid))
                if f.get("deleted") and not row["d"]:
                    con.execute("DELETE FROM facts_fts WHERE rowid=?", (row["id"],))
                    tombstoned += 1
                else:
                    updated += 1
            else:
                skipped += 1

        for c in choices:
            if not isinstance(c, dict):
                ch_skipped += 1
                continue
            uid = _text(c.get("uid"), 256)
            if not uid:
                continue
            if con.execute("SELECT 1 FROM choices WHERE uid=?", (uid,)).fetchone():
                ch_skipped += 1
                continue
            con.execute("INSERT INTO choices (uid,project,subject,raw,decision,"
                        "note,created_at,origin) VALUES (?,?,?,?,?,?,?,?)",
                        (uid, _text(c.get("project") or "general", 256),
                         _text(c.get("subject"), 4096),
                         _text(c.get("raw")),
                         _text(c.get("decision") or "approved", 64),
                         _text(c.get("note"), 4096),
                         _num(c.get("created_at"), time.time()),
                         _text(c.get("origin") or bundle.get("device") or "", 256)))
            ch_added += 1
        con.commit()
    except sqlite3.Error as e:
        # a hostile bundle must never surface as a 500 with a traceback
        con.rollback()
        return {"status": "error", "reason": f"bundle rejected: {e}"}
    finally:
        con.close()
    return {"status": "ok", "from": _text(bundle.get("device"), 256),
            "facts_added": added, "facts_updated": updated,
            "facts_skipped": skipped, "tombstones": tombstoned,
            "choices_added": ch_added, "choices_skipped": ch_skipped}


# ── file transport ───────────────────────────────────────────────────────
def sync_file(path, project=None, full=False):
    """Two-way sync through a shared folder (Syncthing/Dropbox/SD card).

    Each device writes its own bundle file, and reads everyone else's, so
    several devices can share one directory without clobbering each other.
    """
    p = Path(path)
    if p.suffix == ".json":
        directory, mine = p.parent, p
    else:
        directory = p
        mine = directory / f"omerta-sync-{memory.device()}.json"
    directory.mkdir(parents=True, exist_ok=True)

    results = []
    for other in sorted(directory.glob("omerta-sync-*.json")):
        if other.resolve() == mine.resolve():
            continue
        try:
            results.append(merge_bundle(json.loads(other.read_text())))
        except (json.JSONDecodeError, OSError) as e:
            results.append({"status": "error", "file": other.name, "reason": str(e)})

    since = 0 if full else last_sync("files", str(directory))
    bundle = export_bundle(since=since if not full else 0, project=project)
    # merge with what we previously wrote so the file stays a full picture
    if mine.exists() and not full:
        try:
            prev = json.loads(mine.read_text())
            seen = {f["uid"] for f in bundle["facts"]}
            bundle["facts"] += [f for f in prev.get("facts", []) if f["uid"] not in seen]
            cseen = {c["uid"] for c in bundle["choices"]}
            bundle["choices"] += [c for c in prev.get("choices", []) if c["uid"] not in cseen]
        except (json.JSONDecodeError, OSError, KeyError):
            pass
    mine.write_text(json.dumps(bundle, indent=1))
    _mark("files", str(directory), time.time(),
          {"merged": len(results), "exported": len(bundle["facts"])})
    return {"status": "ok", "wrote": str(mine),
            "exported_facts": len(bundle["facts"]),
            "exported_choices": len(bundle["choices"]),
            "merged_from_peers": results}


# ── peer transport ───────────────────────────────────────────────────────
def sync_peer(host, token=None, project=None, full=False, timeout=30):
    """Two-way sync with another OMERTA AGENT over HTTP."""
    from . import auth
    if not host.startswith("http"):
        host = "http://" + host
    host = host.rstrip("/")
    tok = token or auth.get_token()
    since = 0 if full else last_sync("peers", host)
    hdr = {"X-Omerta-Token": tok, "Content-Type": "application/json"}

    try:
        r = requests.get(f"{host}/api/sync/pull",
                         params={"since": since, **({"project": project} if project else {})},
                         headers=hdr, timeout=timeout)
        if r.status_code == 401:
            return {"status": "error",
                    "reason": "peer rejected the token — get it from that device's "
                              "`/token` and pass it with --token"}
        r.raise_for_status()
        pulled = merge_bundle(r.json())
    except requests.RequestException as e:
        return {"status": "error", "reason": f"pull failed: {e}"}

    try:
        bundle = export_bundle(since=since, project=project)
        r2 = requests.post(f"{host}/api/sync/push", json=bundle, headers=hdr, timeout=timeout)
        r2.raise_for_status()
        pushed = r2.json()
    except requests.RequestException as e:
        return {"status": "partial", "pulled": pulled,
                "reason": f"push failed: {e}"}

    _mark("peers", host, time.time(), {"pulled": pulled, "pushed": pushed})
    return {"status": "ok", "peer": host, "pulled": pulled, "pushed": pushed}


def status():
    s = _state()
    return {"device": memory.device(),
            "peers": s.get("peers", {}), "files": s.get("files", {})}
