# Writing plugins

Drop a `.py` file in `plugins/`. Minimum viable plugin:

```python
MANIFEST = {"name": "myplugin", "description": "What it does", "version": "1.0"}

def _do_thing(args):
    return {"result": args["value"].upper()}

def register():
    return {
        "do_thing": {
            "fn": _do_thing,
            "description": "Uppercase a string",
            "args": {"value": "text to transform"},
            "side_effects": False,   # True -> routed through approval
        },
    }
```

Reload without restarting: `/plugins reload`.

## side_effects

Set `side_effects: True` for anything that writes files, hits a network
endpoint that mutates state, talks to a device, or spends money. Those tools
suspend the loop for approval exactly like a shell command. Read-only tools
(`False`) run freely so the agent can gather context without nagging you.

Setting `False` on something destructive is the one way to punch a hole in the
always-ask guarantee — don't.

## Accepted conventions

The loader is permissive about metadata so older plugins keep working:
`MANIFEST`, `PLUGIN`, or `META` for the manifest; `register()` returning a
dict, or a bare `TOOLS = {...}` dict. Bare callables are normalized into full
tool specs automatically.

## Errors

A plugin that raises on import is isolated — it's listed as failed in
`/plugins` and `doctor.py`, and the rest still load. Check the traceback with
`python scripts/doctor.py`.

## Bundled examples

| plugin | tools | notes |
|---|---|---|
| `project_scan` | `project_scan` | detects stack/build system/entrypoints |
| `devinfo` | `dev_environment` | OS, arch, which build tools exist |
| `http_fetch` | `http_fetch` | pull docs/raw source |
| `notes` | `note_add`, `note_list` | scratch TODOs beside memory |
