"""
Codebase intelligence — a real symbol + dependency index, not just file text.

Builds an index of a repository: files, definitions (classes / functions /
methods) with line numbers, and import/include edges (a dependency graph).
Python is parsed with the `ast` module (accurate); other languages use
conservative regex extractors (best-effort, labelled as such). The index is
cached as JSON beside the agent's data so `search` / `symbol` / `deps` are
instant on the next call.

Read-only. Nothing here executes project code; it only reads and parses files.
"""
import ast
import hashlib
import json
import re
import time
from pathlib import Path

from . import config

SKIP_DIRS = {".git", "node_modules", "build", "dist", "__pycache__", ".gradle",
             "venv", ".venv", ".idea", "out", "target", ".mypy_cache", "artifacts",
             "build_pkg"}
MAX_FILE = 400_000
INDEX_DIR = config.DATA_DIR / "index"

# language → (extensions, list of (kind, compiled regex with one capture group))
_LANG = {
    "javascript": ([".js", ".jsx", ".ts", ".tsx", ".mjs"], [
        ("class", re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)")),
        ("function", re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)")),
        ("function", re.compile(r"\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)")),
        ("const", re.compile(r"\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(")),
    ]),
    "go": ([".go"], [
        ("func", re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)", re.M)),
        ("type", re.compile(r"^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)", re.M)),
    ]),
    "rust": ([".rs"], [
        ("fn", re.compile(r"\bfn\s+([A-Za-z_]\w*)")),
        ("struct", re.compile(r"\bstruct\s+([A-Za-z_]\w*)")),
        ("enum", re.compile(r"\benum\s+([A-Za-z_]\w*)")),
        ("trait", re.compile(r"\btrait\s+([A-Za-z_]\w*)")),
    ]),
    "jvm": ([".java", ".kt", ".kts"], [
        ("type", re.compile(r"\b(?:class|interface|enum|object)\s+([A-Za-z_]\w*)")),
        ("fun", re.compile(r"\bfun\s+([A-Za-z_]\w*)")),
    ]),
    "c": ([".c", ".h", ".cc", ".cpp", ".hpp", ".cxx"], [
        ("func", re.compile(r"^[A-Za-z_][\w\s\*]+?\b([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{", re.M)),
        ("struct", re.compile(r"\b(?:struct|enum|union)\s+([A-Za-z_]\w*)\s*\{")),
    ]),
    "shell": ([".sh", ".bash"], [
        ("func", re.compile(r"^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{", re.M)),
    ]),
}
_EXT_LANG = {ext: name for name, (exts, _) in _LANG.items() for ext in exts}

_IMPORT_RE = [
    re.compile(r"^\s*import\s+([\w.]+)", re.M),                 # js/py/go/java
    re.compile(r"""^\s*from\s+([\w.]+)\s+import""", re.M),      # py
    re.compile(r"""(?:require|import)\(\s*['"]([^'"]+)['"]"""),  # js
    re.compile(r'^\s*#include\s+[<"]([^>"]+)[>"]', re.M),       # c
    re.compile(r'^\s*use\s+([\w:]+)', re.M),                    # rust
]


def _index_path(root: Path) -> Path:
    h = hashlib.sha1(str(root.resolve()).encode()).hexdigest()[:16]
    return INDEX_DIR / f"{h}.json"


def _callees(func_node):
    """Names called inside a function body (best-effort: Name/Attribute)."""
    out = set()
    for n in ast.walk(func_node):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                out.add(f.id)
            elif isinstance(f, ast.Attribute):
                out.add(f.attr)
    return sorted(out)


def _py_symbols(text):
    syms, imports, calls = [], set(), {}
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None, None, None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            syms.append(("function", node.name, node.lineno))
            calls[node.name] = sorted(set(calls.get(node.name, []))
                                      | set(_callees(node)))
        elif isinstance(node, ast.ClassDef):
            syms.append(("class", node.name, node.lineno))
            for b in node.body:
                if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    q = f"{node.name}.{b.name}"
                    syms.append(("method", q, b.lineno))
                    calls[q] = _callees(b)
        elif isinstance(node, ast.Import):
            for a in node.names:
                imports.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.add(node.module.split(".")[0])
    return syms, sorted(imports), calls


def _regex_symbols(lang, text):
    syms = []
    for kind, rx in _LANG[lang][1]:
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            syms.append((kind, m.group(1), line))
    imports = set()
    for rx in _IMPORT_RE:
        for m in rx.finditer(text):
            imports.add(m.group(1))
    return syms, sorted(imports)


def build(root=".", save=True) -> dict:
    root = Path(root).resolve()
    files, symbols, deps, calls = [], [], {}, []
    lang_counts = {}
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        if rel.parts and rel.parts[0] in SKIP_DIRS:
            continue
        ext = p.suffix.lower()
        lang = "python" if ext == ".py" else _EXT_LANG.get(ext)
        if not lang:
            continue
        try:
            if p.stat().st_size > MAX_FILE:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        files.append(str(rel))
        lang_counts[lang] = lang_counts.get(lang, 0) + 1
        if lang == "python":
            syms, imports, fcalls = _py_symbols(text)
            if syms is None:
                syms, imports, fcalls = [], [], {}
            for caller, callees in (fcalls or {}).items():
                if callees:
                    calls.append({"caller": caller, "file": str(rel),
                                  "callees": callees})
        else:
            syms, imports = _regex_symbols(lang, text)
        for kind, name, line in syms:
            symbols.append({"name": name, "kind": kind, "file": str(rel),
                            "line": line, "lang": lang})
        if imports:
            deps[str(rel)] = imports

    idx = {"root": str(root), "built_at": time.time(),
           "files": sorted(files), "symbols": symbols, "deps": deps,
           "calls": calls, "languages": lang_counts,
           "counts": {"files": len(files), "symbols": len(symbols),
                      "call_edges": sum(len(c["callees"]) for c in calls)}}
    if save:
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        _index_path(root).write_text(json.dumps(idx))
    return idx


def load(root="."):
    p = _index_path(Path(root).resolve())
    if p.exists():
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _ensure(root="."):
    return load(root) or build(root)


def search(query, root=".", limit=40):
    idx = _ensure(root)
    q = query.lower()
    sym_hits = [s for s in idx["symbols"] if q in s["name"].lower()]
    file_hits = [f for f in idx["files"] if q in f.lower()]
    return {"query": query, "symbols": sym_hits[:limit],
            "files": file_hits[:limit],
            "counts": {"symbols": len(sym_hits), "files": len(file_hits)}}


def symbol(name, root=".", limit=40):
    idx = _ensure(root)
    exact = [s for s in idx["symbols"] if s["name"] == name
             or s["name"].endswith("." + name)]
    if not exact:
        exact = [s for s in idx["symbols"] if name.lower() in s["name"].lower()]
    return {"name": name, "definitions": exact[:limit], "count": len(exact)}


def deps(target=None, root="."):
    idx = _ensure(root)
    if target:
        hit = {f: v for f, v in idx["deps"].items() if target in f}
        return {"target": target, "imports": hit}
    # summarise the most-depended-on modules
    freq = {}
    for imports in idx["deps"].values():
        for m in imports:
            freq[m] = freq.get(m, 0) + 1
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:30]
    return {"files_with_imports": len(idx["deps"]),
            "top_imports": [{"module": m, "used_by": n} for m, n in top]}


def calls(name, root=".", limit=60):
    """Python call graph: who calls `name`, and what `name` calls.

    Best-effort (name-based, not fully resolved), so treat it as LIKELY, not
    proof — matching functions by short or qualified name."""
    idx = _ensure(root)
    edges = idx.get("calls", [])
    short = name.split(".")[-1]
    callees = []
    for e in edges:
        if e["caller"] == name or e["caller"].endswith("." + name) \
                or e["caller"] == short:
            callees.append({"caller": e["caller"], "file": e["file"],
                            "callees": e["callees"]})
    callers = [{"caller": e["caller"], "file": e["file"]}
               for e in edges if short in e["callees"]]
    return {"name": name, "confidence": "LIKELY (name-based)",
            "defines_calls_to": callees[:limit],
            "called_by": callers[:limit],
            "counts": {"as_caller": len(callees), "as_callee": len(callers)}}
