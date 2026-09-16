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
           "index", "search"}


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
    if sub == "plan":
        fn = _plugin_tool("collect_evidence_plan")
        _emit(fn({"out": rest[0]} if rest else {}))
        return 0
    print("usage: omerta firmware <inspect <img> | analyze <dtb|dtbo|boot.img> | "
          "report <dir> | plan>")
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


# ── index / search ───────────────────────────────────────────────────────────
def _index(argv):
    from tools import importers
    path = argv[0] if argv else "."
    res = importers.auto(path, project="general")
    _emit(res)
    return 0 if res.get("status") == "ok" else 1


def _search(argv):
    q = " ".join(argv).strip()
    if not q:
        print('usage: omerta search "query"'); return 1
    from . import memory
    hits = memory.recall(q, top_k=25)
    if not hits:
        print("no matches in the index/memory. Run `omerta index` first.")
        return 0
    for h in hits:
        print(f"- ({h['kind']}) {h['content']}")
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
    }[verb](rest)
