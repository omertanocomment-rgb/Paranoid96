"""
Plugins — drop-in Python modules that add new tools to the agent.

A plugin is plugins/<name>.py exposing:

    MANIFEST = {"name": "...", "description": "...", "version": "1.0"}

    def register():
        return {
            "tool_name": {
                "fn": callable(args: dict) -> anything,
                "description": "what it does",
                "args": {"argname": "description"},
                "side_effects": True,   # True -> routed through confirmation
            },
        }

Plugins are loaded at startup and hot-reloadable with /plugins reload.
Any tool with side_effects=True is proposed for approval before it runs,
same as a shell command — plugins cannot bypass the always-ask rule.
"""
import importlib.util
import sys
import traceback
from . import config

_LOADED = {}
_TOOLS = {}


def load_all(verbose=False):
    global _LOADED, _TOOLS
    _LOADED, _TOOLS = {}, {}
    config.PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    dirs = [config.PLUGINS_DIR]
    if config.USER_PLUGINS_DIR.exists():
        dirs.append(config.USER_PLUGINS_DIR)
    candidates = []
    for d0 in dirs:
        candidates += list(d0.glob("*.py"))
        candidates += [d / "tools.py" for d in d0.iterdir()
                       if d.is_dir() and (d / "tools.py").exists()]
    for path in sorted(candidates):
        if path.name.startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                f"omerta_plugin_{path.parent.name}_{path.stem}", path)
            mod = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod
            spec.loader.exec_module(mod)
            default_name = (path.parent.name if path.name == "tools.py" else path.stem)
            manifest = (getattr(mod, "MANIFEST", None) or getattr(mod, "PLUGIN", None)
                        or getattr(mod, "META", None) or {})
            ymlf = path.parent / "plugin.yaml"
            if not manifest and ymlf.exists():
                try:
                    import yaml as _y
                    manifest = _y.safe_load(ymlf.read_text()) or {}
                except Exception:  # noqa: BLE001
                    manifest = {}
            manifest.setdefault("name", default_name)
            manifest.setdefault("description", "")
            # accept either register() -> {name: {...}} or a plain TOOLS dict
            if hasattr(mod, "register"):
                tools = mod.register() or {}
            else:
                tools = getattr(mod, "TOOLS", {}) or {}
            # a plugin.yaml may declare which tools mutate state
            declared = {}
            for t in (manifest.get("tools") or []):
                if isinstance(t, dict) and "name" in t:
                    declared[t["name"]] = bool(t.get("mutating", False))
            # normalize bare callables into the full tool spec
            norm = {}
            for tname, tdef in tools.items():
                if callable(tdef):
                    norm[tname] = {"fn": tdef, "description": "", "args": {},
                                   "side_effects": declared.get(tname, False)}
                else:
                    tdef.setdefault("args", {})
                    tdef.setdefault("description", "")
                    tdef.setdefault("side_effects", declared.get(tname, False))
                    norm[tname] = tdef
            tools = norm
            _LOADED[manifest.get("name", path.stem)] = {
                "manifest": manifest, "tools": list(tools), "path": str(path)}
            for tname, tdef in tools.items():
                _TOOLS[tname] = tdef
        except Exception:  # noqa: BLE001
            _LOADED[path.parent.name if path.name == "tools.py" else path.stem] = {
                "manifest": {"name": path.stem,
                                               "description": "[FAILED TO LOAD]"},
                                  "error": traceback.format_exc(limit=3),
                                  "tools": [], "path": str(path)}
            if verbose:
                print(f"[plugin error] {path.name}\n{traceback.format_exc(limit=3)}")
    return _LOADED


def tools():
    if not _TOOLS:
        load_all()
    return _TOOLS


def loaded():
    if not _LOADED:
        load_all()
    return _LOADED


def catalog() -> str:
    t = tools()
    if not t:
        return ""
    lines = ["[Plugin tools]"]
    for name, d in t.items():
        args = ", ".join(d.get("args", {}))
        mark = " (needs approval)" if d.get("side_effects") else ""
        lines.append(f"- {name}({args}): {d.get('description','')}{mark}")
    return "\n".join(lines)
