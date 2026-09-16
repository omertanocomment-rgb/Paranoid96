# Plugins

Drop a `.py` file here. It becomes agent tools on next start (or when you
run `reload_plugins`).

```python
META  = {"name": "myplugin", "description": "what it does"}
TOOLS = {"my_tool": lambda args: {"result": args["x"] * 2}}
```

Rules:
- A plugin that throws on import is skipped and logged — it can't take the
  agent down with it.
- Files starting with `_` are ignored.
- Tool names are global; a plugin tool with the same name as a built-in
  overrides it. Namespace yours (`myplugin_do_thing`) to avoid surprises.
- If your tool returns `{"status": "awaiting_approval", ...}` it goes
  through the same approval gate as shell commands. Do this for anything
  that writes, deletes, uploads, or spends money.
