"""
Importers — bring existing knowledge into the agent's memory.

Supported:
  claude   : claude.ai data export (conversations.json) or a single chat JSON
  chatgpt  : ChatGPT export (conversations.json)
  markdown : any .md notes directory
  repo     : summarize a codebase's structure into memory

Imports are deduplicated and tagged with their origin, so the agent can
tell you where something came from. Nothing is uploaded anywhere — this
reads local export files and writes to your local SQLite.
"""
import json
import hashlib
from pathlib import Path

from core import memory

_seen = set()


def _dedupe(text):
    h = hashlib.sha1(text.encode("utf-8", "ignore")).hexdigest()
    if h in _seen:
        return False
    _seen.add(h)
    return True


def _store(content, project, kind, tags):
    if len(content.strip()) < 40 or not _dedupe(content):
        return 0
    memory.remember(content[:1500], project=project, kind=kind, tags=tags)
    return 1


def import_claude(path, project="imported", max_items=5000):
    """claude.ai export: conversations.json (list of conversations)."""
    p = Path(path)
    if not p.exists():
        return {"status": "error", "reason": f"no such file: {path}"}
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = [data]
    n, convos = 0, 0
    for conv in data[:max_items]:
        convos += 1
        name = conv.get("name") or conv.get("title") or "untitled"
        msgs = conv.get("chat_messages") or conv.get("messages") or []
        pairs = []
        for m in msgs:
            role = m.get("sender") or m.get("role") or "?"
            text = m.get("text") or ""
            if not text and isinstance(m.get("content"), list):
                text = " ".join(c.get("text", "") for c in m["content"]
                                if isinstance(c, dict))
            if text:
                pairs.append(f"{role}: {text}")
        if pairs:
            n += _store(f"[from Claude chat '{name}'] " + " | ".join(pairs)[:1400],
                        project, "imported", "claude-export")
    return {"status": "ok", "source": "claude", "conversations": convos, "stored": n}


def import_chatgpt(path, project="imported", max_items=5000):
    p = Path(path)
    if not p.exists():
        return {"status": "error", "reason": f"no such file: {path}"}
    data = json.loads(p.read_text(encoding="utf-8"))
    n, convos = 0, 0
    for conv in (data if isinstance(data, list) else [data])[:max_items]:
        convos += 1
        title = conv.get("title", "untitled")
        mapping = conv.get("mapping", {})
        parts = []
        for node in mapping.values():
            msg = (node or {}).get("message") or {}
            role = (msg.get("author") or {}).get("role", "?")
            content = msg.get("content") or {}
            chunks = content.get("parts") or []
            text = " ".join(c for c in chunks if isinstance(c, str))
            if text.strip():
                parts.append(f"{role}: {text}")
        if parts:
            n += _store(f"[from ChatGPT chat '{title}'] " + " | ".join(parts)[:1400],
                        project, "imported", "chatgpt-export")
    return {"status": "ok", "source": "chatgpt", "conversations": convos, "stored": n}


def import_markdown(directory, project="imported"):
    d = Path(directory)
    if not d.exists():
        return {"status": "error", "reason": f"no such dir: {directory}"}
    n = 0
    for f in d.rglob("*.md"):
        try:
            n += _store(f"[from {f.name}] {f.read_text(encoding='utf-8')[:1400]}",
                        project, "imported", "markdown")
        except Exception:  # noqa: BLE001
            continue
    return {"status": "ok", "source": "markdown", "stored": n}


def import_repo(directory, project=None):
    """Summarize a codebase's shape into memory so the agent orients fast."""
    d = Path(directory)
    if not d.exists():
        return {"status": "error", "reason": f"no such dir: {directory}"}
    project = project or d.name
    skip = {"node_modules", ".git", "build", "dist", "__pycache__", ".gradle", "venv"}
    exts = {}
    entry = []
    for f in d.rglob("*"):
        if any(s in f.parts for s in skip):
            continue
        if f.is_file():
            exts[f.suffix] = exts.get(f.suffix, 0) + 1
            if f.name in ("package.json", "build.gradle", "build.gradle.kts",
                          "CMakeLists.txt", "Makefile", "pyproject.toml",
                          "Cargo.toml", "go.mod", "capacitor.config.json",
                          "AndroidManifest.xml", "Package.swift"):
                entry.append(str(f.relative_to(d)))
    top = sorted(exts.items(), key=lambda x: -x[1])[:10]
    main_types = ", ".join(f"{e or 'noext'}({c})" for e, c in top)
    build_files = ", ".join(entry[:10]) or "none found"
    summary = (f"Repo '{project}' at {d}: {sum(exts.values())} files. "
               f"Main types: {main_types}. Build files: {build_files}.")
    memory.remember(summary, project=project, kind="fact", tags="repo-scan", weight=2.0)
    return {"status": "ok", "source": "repo", "project": project, "summary": summary}


def auto(path, project="imported"):
    """Guess the format and import it."""
    p = Path(path)
    if p.is_dir():
        if (p / ".git").exists() or any(p.glob("*.gradle")) or (p / "package.json").exists():
            return import_repo(p, project=None)
        return import_markdown(p, project)
    try:
        data = json.loads(p.read_text(encoding="utf-8")[:200000])
    except Exception:  # noqa: BLE001
        return {"status": "error", "reason": "unrecognized file format"}
    sample = data[0] if isinstance(data, list) and data else data
    if isinstance(sample, dict) and "mapping" in sample:
        return import_chatgpt(p, project)
    return import_claude(p, project)
