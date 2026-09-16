"""
Connectors — MCP (Model Context Protocol) client.

Lets the agent use external MCP servers as tools: filesystem, GitHub,
Sentry, Cloudflare, Dropbox, Google Drive, or anything else that speaks
MCP. Two transports supported:

  stdio : a local process (npx / python / binary) speaking JSON-RPC on
          stdin/stdout. Works fully offline.
  http  : a remote streamable-HTTP / SSE MCP endpoint.

Configured in connectors.yaml. Tools appear to the agent namespaced as
`mcp.<server>.<tool>`, and every MCP tool call is treated as a side effect
— it goes through the same approval gate as a shell command, because a
remote tool can write to your repos and cloud accounts.
"""
import json
import subprocess
import threading
import time
import os
import requests
import yaml
from . import config

_SERVERS = {}     # name -> {"proc":..., "spec":..., "tools":[...]}
_LOCK = threading.Lock()


def load_config():
    if not config.CONNECTORS_FILE.exists():
        return {}
    try:
        data = yaml.safe_load(config.CONNECTORS_FILE.read_text()) or {}
        return data.get("servers", {}) or {}
    except Exception as e:  # noqa: BLE001
        return {"_error": str(e)}


# ── stdio transport ──────────────────────────────────────────────────────
class StdioClient:
    def __init__(self, name, cmd, args=None, env=None, cwd=None):
        self.name = name
        self._id = 0
        full_env = dict(os.environ)
        full_env.update(env or {})
        self.proc = subprocess.Popen(
            [cmd] + (args or []), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1, env=full_env, cwd=cwd)

    def _rpc(self, method, params=None, timeout=30):
        self._id += 1
        msg = {"jsonrpc": "2.0", "id": self._id, "method": method,
               "params": params or {}}
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                break
            try:
                resp = json.loads(line)
            except json.JSONDecodeError:
                continue
            if resp.get("id") == self._id:
                if "error" in resp:
                    raise RuntimeError(resp["error"].get("message", "mcp error"))
                return resp.get("result", {})
        raise TimeoutError(f"MCP server '{self.name}' did not respond to {method}")

    def initialize(self):
        r = self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "omerta-agent", "version": "1.0"}})
        self.proc.stdin.write(json.dumps(
            {"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.proc.stdin.flush()
        return r

    def list_tools(self):
        return self._rpc("tools/list").get("tools", [])

    def call_tool(self, name, arguments):
        return self._rpc("tools/call", {"name": name, "arguments": arguments}, timeout=120)

    def close(self):
        try:
            self.proc.terminate()
        except Exception:  # noqa: BLE001
            pass


# ── http transport ───────────────────────────────────────────────────────
class HttpClient:
    def __init__(self, name, url, headers=None):
        self.name, self.url = name, url
        self.headers = {"Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream"}
        for k, v in (headers or {}).items():
            self.headers[k] = os.path.expandvars(str(v))
        self._id = 0
        self.session_id = None

    def _rpc(self, method, params=None, timeout=60):
        self._id += 1
        h = dict(self.headers)
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        r = requests.post(self.url, headers=h, timeout=timeout, json={
            "jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}})
        r.raise_for_status()
        if "Mcp-Session-Id" in r.headers:
            self.session_id = r.headers["Mcp-Session-Id"]
        text = r.text.strip()
        # streamable-HTTP may reply as SSE frames
        if text.startswith("event:") or text.startswith("data:"):
            for line in text.splitlines():
                if line.startswith("data:"):
                    payload = json.loads(line[5:].strip())
                    if "error" in payload:
                        raise RuntimeError(payload["error"].get("message", "mcp error"))
                    if payload.get("id") == self._id:
                        return payload.get("result", {})
            return {}
        payload = r.json()
        if "error" in payload:
            raise RuntimeError(payload["error"].get("message", "mcp error"))
        return payload.get("result", {})

    def initialize(self):
        return self._rpc("initialize", {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "omerta-agent", "version": "1.0"}})

    def list_tools(self):
        return self._rpc("tools/list").get("tools", [])

    def call_tool(self, name, arguments):
        return self._rpc("tools/call", {"name": name, "arguments": arguments}, timeout=180)

    def close(self):
        pass


# ── management ───────────────────────────────────────────────────────────
def connect(name, spec):
    transport = spec.get("transport", "stdio")
    if not spec.get("enabled", True):
        return {"name": name, "status": "disabled"}
    try:
        if transport == "stdio":
            c = StdioClient(name, spec["command"], spec.get("args"),
                            spec.get("env"), spec.get("cwd"))
        else:
            c = HttpClient(name, spec["url"], spec.get("headers"))
        c.initialize()
        tools = c.list_tools()
        with _LOCK:
            _SERVERS[name] = {"client": c, "spec": spec, "tools": tools}
        return {"name": name, "status": "connected", "tools": len(tools)}
    except Exception as e:  # noqa: BLE001
        return {"name": name, "status": "failed", "error": str(e)}


def connect_all():
    results = []
    for name, spec in load_config().items():
        if name.startswith("_"):
            continue
        results.append(connect(name, spec))
    return results


def disconnect_all():
    with _LOCK:
        for s in _SERVERS.values():
            s["client"].close()
        _SERVERS.clear()


def status():
    cfg = load_config()
    out = []
    for name, spec in cfg.items():
        if name.startswith("_"):
            continue
        live = _SERVERS.get(name)
        out.append({"name": name, "transport": spec.get("transport", "stdio"),
                    "enabled": spec.get("enabled", True),
                    "connected": bool(live),
                    "tools": [t["name"] for t in (live or {}).get("tools", [])]})
    return out


def tools():
    """All connected MCP tools, namespaced mcp.<server>.<tool>."""
    out = {}
    with _LOCK:
        for sname, s in _SERVERS.items():
            for t in s["tools"]:
                out[f"mcp.{sname}.{t['name']}"] = {
                    "server": sname, "tool": t["name"],
                    "description": t.get("description", ""),
                    "schema": t.get("inputSchema", {}),
                }
    return out


def catalog() -> str:
    t = tools()
    if not t:
        return ""
    lines = ["[Connector (MCP) tools — all require approval before running]"]
    for full, d in list(t.items())[:60]:
        lines.append(f"- {full}: {d['description'][:110]}")
    return "\n".join(lines)


def call(full_name, arguments):
    d = tools().get(full_name)
    if not d:
        return {"status": "error", "reason": f"no MCP tool '{full_name}'"}
    with _LOCK:
        srv = _SERVERS.get(d["server"])
    if not srv:
        return {"status": "error", "reason": f"server '{d['server']}' not connected"}
    try:
        res = srv["client"].call_tool(d["tool"], arguments or {})
        content = res.get("content", res)
        if isinstance(content, list):
            content = "\n".join(c.get("text", json.dumps(c))
                                for c in content if isinstance(c, dict))
        return {"status": "ok", "tool": full_name, "result": content}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "tool": full_name, "reason": str(e)}
