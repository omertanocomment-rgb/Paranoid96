"""
Codebase intelligence tools for the agent — read-only symbol/dependency search.

Thin wrappers over core.index so the agent can locate a definition or map a
dependency graph without shelling out to grep and guessing. All read-only.
"""
MANIFEST = {
    "name": "code_index",
    "description": "Symbol and dependency search across the repository "
                   "(classes/functions/methods + import graph). Read-only.",
    "version": "1.0",
}


def _idx():
    from core import index
    return index


def code_index(args):
    return _idx().build(args.get("path", "."), save=True)["counts"]


def code_search(args):
    return _idx().search(args.get("query", ""), root=args.get("path", "."))


def code_symbol(args):
    return _idx().symbol(args.get("name", ""), root=args.get("path", "."))


def code_deps(args):
    return _idx().deps(args.get("target"), root=args.get("path", "."))


def code_calls(args):
    return _idx().calls(args.get("name", ""), root=args.get("path", "."))


def register():
    return {
        "code_index": {"fn": code_index, "description":
                       "Build/refresh the repository symbol+dependency index.",
                       "args": {"path": "repo root (default .)"},
                       "side_effects": False},
        "code_search": {"fn": code_search, "description":
                        "Search indexed symbols and file paths by substring.",
                        "args": {"query": "text", "path": "repo root"},
                        "side_effects": False},
        "code_symbol": {"fn": code_symbol, "description":
                        "Find where a class/function/method is defined (file:line).",
                        "args": {"name": "symbol name", "path": "repo root"},
                        "side_effects": False},
        "code_deps": {"fn": code_deps, "description":
                      "Show the import/dependency graph, or imports of one file.",
                      "args": {"target": "optional file substring", "path": "repo root"},
                      "side_effects": False},
        "code_calls": {"fn": code_calls, "description":
                       "Python call graph: who calls a function and what it calls "
                       "(name-based, LIKELY).",
                       "args": {"name": "function name", "path": "repo root"},
                       "side_effects": False},
    }
