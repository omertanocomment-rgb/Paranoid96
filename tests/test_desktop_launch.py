#!/usr/bin/env python3
"""The desktop app can actually start on a clean machine.

This exists because the desktop build shipped in a state where it could not
run anywhere it had not been set up by hand:

  * main.js spawned server.py, which imports FastAPI and uvicorn. Nothing in
    the .deb, the AppImage or the Windows build installs them, so the backend
    died on import on any machine that had not pip-installed them first.
  * omerta_entry.py -- the entry point that falls back to the stdlib server
    when those are absent -- was explicitly EXCLUDED from the packaged
    resources, so the working path was not even present to be used.
  * On Windows the launcher's answer to "no Python" was a dialog telling the
    owner to go and install it from python.org. An application that requires
    you to install a language runtime first is the Termux problem again.

So the properties guarded here are that the launcher runs the entry point that
degrades rather than the one that hard-fails, that the entry point is actually
packaged, that Windows carries its own interpreter, and -- the part that
matters -- that the stdlib path really does serve with FastAPI absent.
"""
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "desktop" / "main.js"
PKG = ROOT / "desktop" / "package.json"

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


print("=== desktop launch ===")

js = MAIN.read_text()
check("the launcher runs omerta_entry.py, not server.py",
      "'omerta_entry.py'" in js and "'server.py'" not in js)
check("it asks that entry point to serve", "'serve'" in js)
check("a bundled interpreter is preferred over PATH", "bundledPython" in js)

pkg = json.loads(PKG.read_text())
build = pkg["build"]
res = build["extraResources"][0]
check("omerta_entry.py is packaged", "!omerta_entry.py" not in res["filter"])
check("the staged runtime is not copied in twice",
      "!desktop/runtime/**" in res["filter"])

win = build.get("win", {})
wres = win.get("extraResources") or []
check("Windows ships its own interpreter",
      any(r.get("to") == "pyruntime" for r in wres), wres)
# python311._pth resolves "..\\app" relative to python.exe, so the runtime has
# to sit BESIDE the app directory, not inside it.
check("and it sits beside the app, where its path file expects it",
      all(r.get("to") == "pyruntime" for r in wres))

arches = {a for t in win.get("target", []) if isinstance(t, dict)
          for a in t.get("arch", [])}
check("no architecture is offered that the staged runtime cannot serve",
      arches <= {"x64"}, sorted(arches))

staged = ROOT / "desktop" / "runtime" / "win-x64"
if staged.is_dir():
    check("the staged runtime has an interpreter", (staged / "python.exe").is_file())
    pth = staged / "python311._pth"
    check("its path file exists", pth.is_file())
    if pth.is_file():
        body = pth.read_text()
        check("the path file puts the app on sys.path", "..\\app" in body, body)
        check("and enables site so .pth files are honoured", "import site" in body)
else:
    print("  – runtime not staged (run scripts/fetch_win_runtime.sh) — skipping")

# ── the part that actually matters: does it serve with FastAPI absent? ──────
port = free_port()
runner = f'''
import os, sys
class Block:
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in ("fastapi", "uvicorn"):
            raise ImportError("blocked: " + name)
        return None
sys.path.insert(0, {str(ROOT)!r})
sys.meta_path.insert(0, Block())
os.environ["OMERTA_PORT"] = "{port}"
os.chdir({str(ROOT)!r})
sys.argv = ["omerta_entry.py", "serve"]
exec(open({str(ROOT / "omerta_entry.py")!r}).read(),
     {{"__name__": "__main__", "__file__": {str(ROOT / "omerta_entry.py")!r}}})
'''
env = dict(os.environ, OMERTA_DATA_DIR=os.path.join(
    os.environ.get("TMPDIR", "/tmp"), f"omerta-desktop-test-{port}"))
proc = subprocess.Popen([sys.executable, "-c", runner], cwd=str(ROOT),
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        text=True, env=env)
try:
    code = None
    for _ in range(60):
        if proc.poll() is not None:
            break
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/status", timeout=2) as r:
                code = r.status
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    check("the backend serves with FastAPI and uvicorn absent", code == 200,
          f"status={code}, exited={proc.poll()}")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nDESKTOP LAUNCH TESTS PASSED")
