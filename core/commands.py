"""
Top-level `omerta <verb>` subcommands beyond the core (serve/doctor/sync).

These realise the OMERTA AI command set on top of subsystems that already
exist — memory/learning, the repo importer/index, and the firmware plugin —
so there is no parallel implementation to drift. Every entry point routes
through dispatch() first; it returns an exit code when it handled the verb, or
None to let the interactive CLI take over.

Design rule (same as the agent): read-only by default, never guess, and never
claim success without evidence. Destructive device work is not exposed here —
it stays behind the agent's approval gate.
"""
import json
import sys

HANDLED = {"firmware", "teach", "learn", "memory", "forget", "rules",
           "index", "search", "symbol", "deps", "sandbox"}


def _plugin_tool(name):
    from . import plugins
    plugins.load_all()
    t = plugins.tools().get(name)
    return t["fn"] if t else None


def _emit(obj):
    print(json.dumps(obj, indent=2, default=str) if not isinstance(obj, str) else obj)


# ── firmware ────────────────────────────────────────────────────────────────
def _firmware(argv):
    sub = argv[0] if argv else "help"
    rest = argv[1:]
    if sub == "inspect" and rest:
        fn = _plugin_tool("inspect_image")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"path": rest[0]}))
        return 0
    if sub in ("analyze", "dtb") and rest:
        fn = _plugin_tool("analyze_dtb")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"path": rest[0]}))
        return 0
    if sub in ("report", "board") and rest:
        fn = _plugin_tool("board_report")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"dir": rest[0]}))
        return 0
    if sub == "extract" and rest:
        fn = _plugin_tool("extract_image")
        _emit(fn({"path": rest[0], "out": rest[1] if len(rest) > 1 else ""}))
        return 0
    if sub == "plan":
        fn = _plugin_tool("collect_evidence_plan")
        _emit(fn({"out": rest[0]} if rest else {}))
        return 0
    print("usage: omerta firmware <inspect <img> | analyze <dtb|dtbo|boot.img> | "
          "extract <img> [out] | report <dir> | plan>")
    return 0


# ── learning / memory ────────────────────────────────────────────────────────
def _teach(argv):
    scope = "general"
    if argv and argv[0] == "--scope" and len(argv) > 1:
        scope, argv = argv[1], argv[2:]
    text = " ".join(argv).strip()
    if not text:
        print('usage: omerta teach [--scope <project>] "a durable project rule"')
        return 1
    from . import memory
    memory.remember(text, project=scope, kind="preference",
                    tags="taught", weight=2.0)
    print(f"learned (scope={scope}): {text}")
    return 0


def _memory(argv):
    from . import memory
    sub = argv[0] if argv else "show"
    if sub == "show":
        _emit(memory.stats())
        pb = memory.preference_block()
        if pb:
            print("\n" + pb)
        return 0
    if sub == "search":
        q = " ".join(argv[1:])
        hits = memory.recall(q, top_k=25)
        for h in hits:
            print(f"- ({h['kind']}) {h['content']}")
        if not hits:
            print("no matches")
        return 0
    print("usage: omerta memory <show|search \"query\">")
    return 0


def _forget(argv):
    q = " ".join(argv).strip()
    if not q:
        print('usage: omerta forget "text to match"'); return 1
    from . import memory
    hits = memory.recall(q, top_k=10)
    if not hits:
        print("nothing matched"); return 0
    for h in hits:
        memory.forget(h["id"])
    print(f"forgot {len(hits)} fact(s) matching: {q}")
    return 0


def _rules(argv):
    from . import memory
    project = argv[0] if argv else None
    pb = memory.preference_block(project=project)
    print(pb or "no learned rules yet — teach one with: omerta teach \"...\"")
    return 0


# ── code index / search / symbol / deps ──────────────────────────────────────
def _index(argv):
    from . import index
    path = argv[0] if argv else "."
    idx = index.build(path, save=True)
    print(f"indexed {idx['counts']['files']} files, "
          f"{idx['counts']['symbols']} symbols "
          f"({', '.join(f'{k}:{v}' for k, v in sorted(idx['languages'].items()))})")
    # also let the agent's memory learn the repo shape
    try:
        from tools import importers
        importers.auto(path, project="general")
    except Exception:  # noqa: BLE001
        pass
    return 0


def _search(argv):
    q = " ".join(argv).strip()
    if not q:
        print('usage: omerta search "symbol-or-file"'); return 1
    from . import index
    r = index.search(q)
    for s in r["symbols"]:
        print(f"  {s['file']}:{s['line']}  {s['kind']} {s['name']}")
    for f in r["files"]:
        print(f"  {f}")
    if not r["symbols"] and not r["files"]:
        print("no code matches. Run `omerta index` first, or try `omerta memory search`.")
    return 0


def _symbol(argv):
    name = " ".join(argv).strip()
    if not name:
        print('usage: omerta symbol "Name"'); return 1
    from . import index
    r = index.symbol(name)
    if not r["definitions"]:
        print(f"no definition of '{name}' found (run `omerta index` first)")
        return 0
    for s in r["definitions"]:
        print(f"  {s['file']}:{s['line']}  {s['kind']} {s['name']}")
    return 0


def _deps(argv):
    from . import index
    _emit(index.deps(argv[0] if argv else None))
    return 0


# ── sandbox (isolation + snapshots) ──────────────────────────────────────────
def _sandbox(argv):
    from . import isolate
    sub = argv[0] if argv else "status"
    rest = argv[1:]
    if sub == "status":
        _emit(isolate.status()); return 0
    if sub == "snapshot":
        _emit(isolate.snapshot(rest[0] if rest else ".",
                               note=" ".join(rest[1:]))); return 0
    if sub == "list":
        for s in isolate.list_snapshots():
            print(f"  {s['id']}  {s['files']} files  {s['src']}"
                  f"{('  · ' + s['note']) if s.get('note') else ''}")
        return 0
    if sub == "rollback":
        _emit(isolate.rollback(rest[0] if rest else "latest",
                               dest=rest[1] if len(rest) > 1 else None))
        return 0
    if sub == "wrap" and rest:
        print(isolate.wrap(" ".join(rest))); return 0
    print("usage: omerta sandbox <status | snapshot [dir] [note] | list | "
          "rollback [id] [dest] | wrap <cmd>>")
    return 0


def dispatch(argv):
    """Handle a top-level verb. Returns an int exit code, or None if the verb
    isn't one of ours (let the interactive CLI handle it)."""
    if not argv:
        return None
    verb, rest = argv[0], argv[1:]
    if verb not in HANDLED:
        return None
    return {
        "firmware": _firmware,
        "teach": _teach,
        "learn": _teach,
        "memory": _memory,
        "forget": _forget,
        "rules": _rules,
        "index": _index,
        "search": _search,
        "symbol": _symbol,
        "deps": _deps,
        "sandbox": _sandbox,
    }[verb](rest)
