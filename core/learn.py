"""
The learning shelf — give OMERTA material, and take it back.

Two halves, and the second is the one people usually forget to build:

  * **Ingest.** Drop in files (notes, source, docs, transcripts, logs). They are
    stored, chunked and written into memory as `learned` facts tagged with the
    document they came from, so recall surfaces them the same way anything else
    it knows is surfaced.
  * **Unlearn.** Anything learned can be removed — a whole document, a single
    fact, a skill, or a preference OMERTA picked up from watching you approve
    and deny things. If you cannot take something back out, you do not really
    control what it knows, and it slowly drifts into a shape you never chose.

Learned behaviour is not only documents. OMERTA also learns *preferences* from
your approvals and denials (`memory.record_choice`), and that is the part that
changes how it acts. So `forget_behaviour` reaches those too.

Everything here is local — the shelf lives in the agent's own data directory,
nothing is uploaded anywhere.
"""
import hashlib
import json
import os
import re
import shutil
import time

from . import config, memory

DOCS_DIR = config.DATA_DIR / "learned"
INDEX_FILE = DOCS_DIR / "index.json"

# Text-ish things worth reading directly. Anything else is stored and noted,
# but not chunked into memory as if it were prose.
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".html", ".htm",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".kt", ".c", ".h", ".cpp",
    ".hpp", ".rs", ".go", ".rb", ".php", ".sh", ".bash", ".zsh", ".sql",
    ".gradle", ".dts", ".dtsi", ".mk", ".patch", ".diff", "",
}

MAX_FILE_BYTES = int(config.get("OMERTA_LEARN_MAX_BYTES", 8 * 1024 * 1024))
CHUNK_CHARS = int(config.get("OMERTA_LEARN_CHUNK", 1200))
MAX_CHUNKS = int(config.get("OMERTA_LEARN_MAX_CHUNKS", 400))


def _ensure():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)


def _index():
    _ensure()
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except (OSError, ValueError):
            pass
    return {"docs": {}}


def _save(idx):
    _ensure()
    INDEX_FILE.write_text(json.dumps(idx, indent=2))


def _is_text(name, blob):
    if os.path.splitext(name)[1].lower() not in TEXT_SUFFIXES:
        return False
    if b"\x00" in blob[:8192]:
        return False
    try:
        blob[:8192].decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _chunk(text):
    """Split on blank lines, then pack to roughly CHUNK_CHARS.

    Paragraph boundaries beat fixed-size slicing: a chunk that ends mid-sentence
    recalls badly, because the fragment that matches your query is missing the
    half that explains it.
    """
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, cur = [], ""
    for para in paras:
        if len(cur) + len(para) + 2 > CHUNK_CHARS and cur:
            chunks.append(cur)
            cur = para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
        while len(cur) > CHUNK_CHARS * 2:          # one enormous paragraph
            chunks.append(cur[:CHUNK_CHARS])
            cur = cur[CHUNK_CHARS:]
    if cur:
        chunks.append(cur)
    return chunks[:MAX_CHUNKS]


def learn_bytes(name, blob, project="general", note=""):
    """Take a document into the shelf and write it into memory."""
    _ensure()
    if len(blob) > MAX_FILE_BYTES:
        return {"status": "error",
                "reason": f"{name}: {len(blob)} bytes exceeds the "
                          f"{MAX_FILE_BYTES} byte limit"}
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name)) or "document"
    digest = hashlib.sha256(blob).hexdigest()
    doc_id = digest[:16]

    idx = _index()
    if doc_id in idx["docs"]:
        return {"status": "ok", "already_known": True, **idx["docs"][doc_id]}

    stored = DOCS_DIR / f"{doc_id}__{safe}"
    stored.write_bytes(blob)

    text_ok = _is_text(safe, blob)
    facts = []
    if text_ok:
        text = blob.decode("utf-8", "replace")
        for i, chunk in enumerate(_chunk(text)):
            fid = memory.remember(
                chunk, project=project, kind="learned",
                tags=f"doc:{doc_id} source:{safe} chunk:{i}")
            facts.append(fid)

    rec = {"id": doc_id, "name": safe, "original": os.path.basename(name),
           "bytes": len(blob), "sha256": digest, "path": str(stored),
           "project": project, "note": note, "text": text_ok,
           "facts": facts, "chunks": len(facts), "added": time.time()}
    idx["docs"][doc_id] = rec
    _save(idx)
    return {"status": "ok", **rec}


def learn_path(path, project="general", note=""):
    if not os.path.isfile(path):
        return {"status": "error", "reason": f"no such file: {path}"}
    with open(path, "rb") as f:
        return learn_bytes(os.path.basename(path), f.read(),
                           project=project, note=note)


def learn_dir(path, project="general", note="", limit=200):
    if not os.path.isdir(path):
        return {"status": "error", "reason": f"not a directory: {path}"}
    out, skipped = [], []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not d.startswith(".")
                   and d not in ("node_modules", "__pycache__", "build", "dist")]
        for fn in sorted(files):
            if len(out) >= limit:
                break
            r = learn_path(os.path.join(root, fn), project=project, note=note)
            (out if r.get("status") == "ok" else skipped).append(
                {"name": fn, "reason": r.get("reason")} if r.get("status") != "ok"
                else {"name": fn, "id": r["id"], "chunks": r.get("chunks", 0)})
    return {"status": "ok", "learned": out, "skipped": skipped,
            "count": len(out)}


def documents(project=None):
    idx = _index()
    docs = list(idx["docs"].values())
    if project:
        docs = [d for d in docs if d.get("project") == project]
    docs.sort(key=lambda d: d.get("added", 0), reverse=True)
    return {"status": "ok", "count": len(docs), "documents": docs,
            "dir": str(DOCS_DIR)}


def read_document(doc_id, limit=20000):
    idx = _index()
    rec = idx["docs"].get(doc_id)
    if not rec:
        return {"status": "error", "reason": f"no learned document {doc_id!r}"}
    try:
        blob = open(rec["path"], "rb").read()
    except OSError as e:
        return {"status": "error", "reason": str(e)}
    if not rec.get("text"):
        return {"status": "ok", "binary": True, **rec}
    return {"status": "ok", "text": blob.decode("utf-8", "replace")[:limit],
            **rec}


def forget_document(doc_id):
    """Remove a document, its stored copy, and every fact it produced."""
    idx = _index()
    rec = idx["docs"].pop(doc_id, None)
    if not rec:
        return {"status": "error", "reason": f"no learned document {doc_id!r}"}
    removed = 0
    for fid in rec.get("facts", []):
        try:
            memory.forget(fid)
            removed += 1
        except Exception:                          # noqa: BLE001
            pass
    try:
        os.remove(rec["path"])
    except OSError:
        pass
    _save(idx)
    return {"status": "ok", "forgot": rec["name"], "id": doc_id,
            "facts_removed": removed}


# ── unlearning behaviour, not just documents ────────────────────────────────
def learned_behaviour(project=None, limit=200):
    """Everything OMERTA has picked up: taught facts, document chunks, and the
    preferences it inferred from your approvals and denials."""
    facts = memory.recall("", project=project, top_k=limit)
    by_kind = {}
    for f in facts:
        by_kind.setdefault(f.get("kind", "fact"), []).append(f)
    return {"status": "ok",
            "counts": {k: len(v) for k, v in sorted(by_kind.items())},
            "preferences": memory.preference_block(project=project),
            "choices": memory.choice_stats(project=project),
            "kinds": by_kind}


def forget_behaviour(args):
    """Remove learned behaviour by id, by kind, or by matching text.

    Deliberately explicit: one of `id`, `kind` or `match` must be given. A
    'forget everything' that is one stray click away from wiping months of
    accumulated preference is not a feature.
    """
    a = args or {}
    fact_id, kind, match = a.get("id"), a.get("kind"), a.get("match")
    project = a.get("project")
    if not any((fact_id, kind, match)):
        return {"status": "error",
                "reason": "say what to forget: id, kind, or match"}
    if fact_id:
        memory.forget(fact_id)
        return {"status": "ok", "removed": 1, "by": f"id {fact_id}"}

    targets = memory.recall(match or "", project=project, top_k=500,
                            kind=kind if kind else None)
    if match:
        needle = str(match).lower()
        targets = [t for t in targets if needle in str(t.get("content", "")).lower()]
    if kind:
        targets = [t for t in targets if t.get("kind") == kind]
    removed = 0
    for t in targets:
        try:
            memory.forget(t["id"])
            removed += 1
        except Exception:                          # noqa: BLE001
            pass
    return {"status": "ok", "removed": removed,
            "by": f"kind={kind!r} match={match!r}",
            "note": "Documents keep their stored copy; use forget_document to "
                    "remove that too."}


def stats():
    idx = _index()
    docs = list(idx["docs"].values())
    return {"documents": len(docs),
            "chunks": sum(d.get("chunks", 0) for d in docs),
            "bytes": sum(d.get("bytes", 0) for d in docs),
            "dir": str(DOCS_DIR)}
