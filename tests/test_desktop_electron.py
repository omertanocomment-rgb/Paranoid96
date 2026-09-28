#!/usr/bin/env python3
"""The Electron desktop shell talks to Python over a pipe, not a socket.

It used to start `server.py` on port 8787 and point the window at
http://127.0.0.1:8787/. Two processes that already have a pipe between them
were talking over a listening socket instead -- one that can be taken, can be
firewalled, and is reachable by anything else running as the same user. The
window also could not open at all unless that socket bound, which is the same
failure that produced "backend didn't come up" on Android.

The shell now spawns `omerta bridge` and speaks line-delimited JSON over
stdin/stdout, routed by core/dispatch exactly as every other transport is. The
UI is served from a custom scheme registered as secure, so the page is a secure
context and clipboard and microphone work.

This runs the REAL app under a virtual display and asks the backend through it.
It is skipped, not failed, where Electron or a display is unavailable.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT / "desktop"

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


print("=== electron desktop shell ===")

main_js = (DESKTOP / "main.js").read_text(encoding="utf-8")
preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

# ── the shape of it, which holds even without a display ────────────────────
def code_of(text):
    """The source with // comments stripped.

    The file still MENTIONS http://127.0.0.1 -- in the comment explaining why
    it no longer uses it. Searching the raw text for that string would fail on
    the explanation, which is the opposite of what this is checking.
    """
    out = []
    for line in text.splitlines():
        i = line.find("//")
        out.append(line if i < 0 else line[:i])
    return "\n".join(out)


main_code = code_of(main_js)
check("the shell starts the pipe backend, not a server",
      "'bridge'" in main_code and "http://127.0.0.1" not in main_code)
check("and does not spawn server.py", "server.py" not in main_code)
check("nothing in the code opens an http URL",
      "http://" not in main_code, [l for l in main_code.splitlines() if "http://" in l])
check("and no longer polls a port to decide it is up",
      "http.get" not in main_code)
check("the window loads the private scheme",
      "win.loadURL(BASE)" in main_js)
check("which is registered as a secure context",
      "registerSchemesAsPrivileged" in main_js and "secure: true" in main_js)
check("context isolation stays on", "contextIsolation: true" in main_js)
check("node is kept out of the page", "nodeIntegration: false" in main_js)
check("the page gets a preload bridge and nothing else",
      "preload.js" in main_js and "ipcRenderer" not in main_js.split("preload")[0])
check("the preload exposes only named functions",
      "exposeInMainWorld" in preload and "ipcRenderer.invoke" in preload)
check("a dead backend fails the requests waiting on it",
      "for (const [id, slot] of pending)" in main_js)
check("the test hook cannot ship in a packaged build",
      "!app.isPackaged" in main_js)

rpc = (ROOT / "core" / "stdio_rpc.py").read_text(encoding="utf-8")
check("the protocol drains in-flight work before exiting", "def drain" in rpc)
check("and keeps stdout for replies only", "sys.stdout = sys.stderr" in rpc)
check("it routes through the shared dispatcher", "dispatch.handle" in rpc)

# ── the protocol itself, without Electron ──────────────────────────────────
msgs = "\n".join(json.dumps(m) for m in [
    {"id": 1, "method": "GET", "path": "/api/version"},
    {"id": 2, "method": "GET", "path": "/api/nope"},
    {"id": 3, "op": "ping"},
    {"id": 4, "op": "asset", "path": "/theme.css"},
    {"id": 5, "method": "GET", "path": "/../../etc/passwd"},
]) + "\n"
r = subprocess.run([sys.executable, str(ROOT / "omerta_entry.py"), "bridge"],
                   input=msgs, capture_output=True, text=True, timeout=300,
                   cwd=str(ROOT))
replies = {}
for line in r.stdout.splitlines():
    try:
        d = json.loads(line)
    except ValueError:
        continue
    replies[d.get("id")] = d
check("every request is answered", set(replies) >= {1, 2, 3, 4, 5},
      sorted(k for k in replies if k is not None))
check("a version comes back",
      (replies.get(1, {}).get("body") or {}).get("version"), replies.get(1))
check("an unknown route is 404, not a crash",
      replies.get(2, {}).get("status") == 404, replies.get(2))
check("the generated stylesheet is served",
      (replies.get(4, {}).get("body") or {}).get("ctype") == "text/css",
      replies.get(4))
check("a traversal path finds no route",
      replies.get(5, {}).get("status") == 404, replies.get(5))
check("malformed input does not take the bridge down", r.returncode == 0)

# ── the real app, when this machine can run one ────────────────────────────
have_electron = (DESKTOP / "node_modules" / "electron").is_dir()
if not have_electron or not shutil.which("xvfb-run"):
    print("  – electron or a display unavailable — skipping the window "
          "(not a failure)")
else:
    probe = ROOT / "build_pkg" / "e2e-probe.js"
    probe.parent.mkdir(parents=True, exist_ok=True)
    probe.write_text("""
(async () => {
  try {
    const v = await get('/api/version');
    const s = await get('/api/status');
    const p = await post('/api/chats/action', {action: 'list'});
    console.log('PROBE ' + JSON.stringify({
      version: v.version, providers: Object.keys(s.providers || {}).length,
      post: p ? 'ok' : 'none', secure: window.isSecureContext,
      title: document.title,
      tabs: document.querySelectorAll('nav button').length}));
  } catch (e) { console.log('PROBE ' + JSON.stringify({error: String(e)})); }
})();
""", encoding="utf-8")
    env = dict(os.environ, OMERTA_E2E=str(probe))
    run = subprocess.run(["xvfb-run", "-a", "npx", "electron", ".", "--no-sandbox"],
                         cwd=str(DESKTOP), capture_output=True, text=True,
                         timeout=420, env=env)
    got = {}
    for line in (run.stdout or "").splitlines():
        if line.startswith("PROBE "):
            got = json.loads(line[len("PROBE "):])
    check("the app window loads the UI", got.get("title") == "OMERTA AI",
          got or (run.stdout + run.stderr)[-300:])
    check("with its tabs rendered", got.get("tabs") == 6, got)
    check("a GET reaches the backend over the pipe",
          str(got.get("version", "")).startswith("1."), got)
    check("a POST body reaches it too", got.get("post") == "ok", got)
    check("the page is a secure context, so clipboard and mic work",
          got.get("secure") is True, got)
    check("providers are listed, so the agent really booted",
          (got.get("providers") or 0) >= 5, got)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nELECTRON SHELL TESTS PASSED")
