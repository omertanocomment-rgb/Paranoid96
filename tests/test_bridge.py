#!/usr/bin/env python3
"""The Java <-> Python launch bridge.

This exists because of a specific failure. `omerta_android.start()` gained a
`native_lib_dir` parameter and Java was updated to pass it, but the Chaquopy
shim in between -- `omerta_boot.start()` -- was not. Chaquopy binds callAttr()
positionally, so every launch raised TypeError inside the try block that Java
closes with `catch (Throwable)`. The app reported "backend didn't come up" and
nothing else. It shipped that way, on every architecture, for four releases,
because the whole failure lived in one unchecked signature.

So the properties guarded here are: the shim really forwards what it is given,
the two ends of the bridge agree, and -- the part that actually matters -- the
audit gate REFUSES a build where they disagree. A check that only passes on
correct code proves nothing; this deliberately breaks the shim and requires
the gate to catch it.
"""
import ast
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

BOOT = ROOT / "android-native/app/src/main/python/omerta_boot.py"
BACKEND = ROOT / "omerta_android.py"
JAVA = ROOT / "android-native/app/src/main/java/com/omerta/agent/OmertaPython.java"

ok = 0


def check(label, cond, detail=""):
    global ok
    if cond:
        ok += 1
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label} {detail}")
        sys.exit(1)


def sigs(path):
    out = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.FunctionDef):
            out[node.name] = [a.arg for a in node.args.args]
    return out


print("java/python bridge")

boot = sigs(BOOT)
back = sigs(BACKEND)

# ── 1. the regression itself ────────────────────────────────────────────────
check("omerta_boot.start accepts native_lib_dir",
      "native_lib_dir" in boot.get("start", []), boot.get("start"))

src = BOOT.read_text()


def call_args(text, marker):
    """Argument text of `marker(...)`, honouring nested parens.

    int(port) inside the call means a [^)]* regex truncates the list; the whole
    point here is counting arguments, so the scanner has to balance.
    """
    i = text.find(marker)
    if i < 0:
        return None
    depth, out = 1, []
    for ch in text[i + len(marker):]:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                break
        out.append(ch)
    return "".join(out)


fwd = call_args(src, "omerta_android.start(")
check("omerta_boot.start forwards native_lib_dir",
      fwd is not None and "native_lib_dir" in fwd,
      fwd if fwd is not None else "no forwarding call")

# ── 2. every Java call site matches the shim ───────────────────────────────
def java_call_sites(text):
    """(name, args-text) for each callAttr, balancing parentheses.

    A regex that stops at the first ")" undercounts a call whose arguments
    contain calls of their own, which is most of them.
    """
    out = []
    for m in re.finditer(r'callAttr\(\s*"([A-Za-z_]\w*)"', text):
        out.append((m.group(1), _balance(text, m.end())))
    return out


def _balance(text, start):
    depth, buf = 1, []
    for ch in text[start:]:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                break
        buf.append(ch)
    return "".join(buf)


jsrc = JAVA.read_text()
sites = java_call_sites(jsrc)
check("Java has call sites to verify", len(sites) >= 2, sites)
for name, rest in sites:
    check(f"Java calls a function that exists: {name}", name in boot)
    depth, args = 0, 0
    for ch in rest:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            args += 1
    params = boot[name]
    node = next(n for n in ast.parse(src).body
                if isinstance(n, ast.FunctionDef) and n.name == name)
    required = len(node.args.args) - len(node.args.defaults)
    check(f"arity matches for {name}: Java passes {args}, shim takes "
          f"{required}-{len(params)}", required <= args <= len(params))

# ── 3. the shim never drops a backend parameter ────────────────────────────
for name in ("start", "put_secret"):
    if name in back and name in boot:
        dropped = [p for p in back[name]
                   if p not in boot[name] and p != "home_dir"]
        check(f"{name}: shim drops nothing the backend accepts",
              not dropped, dropped)

# ── 4. a failure must be reportable, not just logged ───────────────────────
check("the launch failure is retained, not only logged",
      "lastError" in jsrc and "lastError = describe(t)" in jsrc)
check("a diagnose entry point exists", "diagnose" in boot)
# The interface is Compose now, so the failure screen lives in OmertaRoot.kt
# rather than in the Activity.
root_kt = (ROOT / "android-native/app/src/main/java/com/omerta/agent"
           / "OmertaRoot.kt").read_text(encoding="utf-8")
check("the failure screen shows the reason",
      "OmertaPython.lastError()" in root_kt)
check("and still offers the diagnostics report",
      "OmertaPython.diagnostics" in root_kt)

# ── 5. THE GATE MUST CATCH IT ──────────────────────────────────────────────
# Recreate the exact 1.6.0-1.9.0 bug in a scratch copy of the tree and require
# the auditor to refuse it. Without this, the check above is untested code.
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td) / "tree"
    shutil.copytree(ROOT, tmp, symlinks=True, ignore=shutil.ignore_patterns(
        ".git", "build", "dist", "artifacts", "__pycache__", "*.apk",
        "build_pkg", "desktop", "node_modules", "toolchain", "android-sdk"))
    broken = tmp / "android-native/app/src/main/python/omerta_boot.py"
    broken.write_text(broken.read_text().replace(
        "def start(files_dir, home_dir, port=8787, native_lib_dir=None):",
        "def start(files_dir, home_dir, port=8787):").replace(
        "return omerta_android.start(files_dir, home_dir, int(port), native_lib_dir)",
        "return omerta_android.start(files_dir, home_dir, int(port))"))
    r = subprocess.run([sys.executable, "scripts/audit.py", "--quick"],
                       cwd=tmp, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    check("the gate refuses the reintroduced bug", r.returncode != 0,
          f"exit={r.returncode}")
    check("and names it as a bridge finding", "[bridge]" in out)
    check("and says which signature disagrees",
          "native_lib_dir" in out or "accepts 2-3" in out, out[-400:])

# ── 6. the boot path actually boots ────────────────────────────────────────
# The gate compares signatures; this runs the thing. Everything shipped since
# 1.6.0 rode through start() without that path ever completing on a device, so
# the launch sequence gets exercised for real: env setup, the toolbox install
# that is deliberately wrapped in `except Exception: pass`, and the server
# coming up and answering.
import json
import os
import urllib.request

env_keys = ("OMERTA_DATA_DIR", "OMERTA_HOME", "OMERTA_HOST", "OMERTA_PORT",
            "OMERTA_BUNDLED", "OMERTA_ALLOW_SECRET_API", "OMERTA_COMPACT",
            "OMERTA_NATIVE_LIB_DIR", "OMERTA_ANDROID_HTTP")
saved = {k: os.environ.get(k) for k in env_keys}
try:
    with tempfile.TemporaryDirectory() as td:
        files_dir = Path(td) / "files"
        natives = Path(td) / "natives"
        files_dir.mkdir()
        natives.mkdir()
        sys.path.insert(0, str(BOOT.parent))
        import omerta_boot

        # ── default: no socket at all ──────────────────────────────────
        res = omerta_boot.start(str(files_dir), str(ROOT), 0, str(natives))
        info = json.loads(res)
        check("start() comes up in bridge mode by default",
              info.get("mode") == "bridge", info)
        check("and opens no port", info.get("port") is None, info)
        check("start() reports running", info.get("running") is True, info)
        check("native_lib_dir reached the environment",
              os.environ.get("OMERTA_NATIVE_LIB_DIR") == str(natives),
              os.environ.get("OMERTA_NATIVE_LIB_DIR"))
        check("the app is marked as bundled",
              os.environ.get("OMERTA_BUNDLED") == "1")

        # the UI's requests, with nothing on the wire
        r = json.loads(omerta_boot.request(str(ROOT), "GET", "/api/status"))
        check("an in-process GET is served", r.get("status") == 200, r)
        check("and carries a real payload", isinstance(r.get("body"), dict)
              and bool(r["body"]), str(r)[:120])
        r = json.loads(omerta_boot.request(str(ROOT), "GET", "/api/version"))
        check("the version endpoint answers in-process",
              r["status"] == 200 and r["body"].get("version"), str(r)[:120])
        r = json.loads(omerta_boot.request(str(ROOT), "GET", "/api/nope"))
        check("an unknown route is a 404, not a crash", r.get("status") == 404, r)
        r = json.loads(omerta_boot.request(str(ROOT), "POST", "/api/usage",
                                           json.dumps({"action": "summary"})))
        check("a POST body reaches the route", r.get("status") in (200, 400), r)
        # a hostile path must not escape the route table
        r = json.loads(omerta_boot.request(str(ROOT), "GET", "/../../etc/passwd"))
        check("a traversal path finds no route", r.get("status") == 404, r)

        check("start() is idempotent",
              json.loads(omerta_boot.start(str(files_dir), str(ROOT), 0,
                                           str(natives)))["mode"] == "bridge")
        check("info() agrees the backend is up",
              json.loads(omerta_boot.info(str(ROOT)))["running"] is True)
        check("stop() winds it down", omerta_boot.stop(str(ROOT)) is True)

        # ── opt-in: the loopback server, for reaching this app from the LAN ──
        import omerta_android
        omerta_android._STATE.update(server=None, thread=None, ready=False,
                                     port=None, token=None)
        os.environ["OMERTA_ANDROID_HTTP"] = "1"
        try:
            info2 = json.loads(omerta_boot.start(str(files_dir), str(ROOT), 0,
                                                 str(natives)))
            check("http mode still available when asked for",
                  info2.get("mode") == "http", info2)
            check("and it binds a real port",
                  isinstance(info2.get("port"), int) and info2["port"] > 0, info2)
            url = f"http://127.0.0.1:{info2['port']}/api/status"
            with urllib.request.urlopen(url, timeout=10) as resp:
                body = resp.read().decode()
                check("the loopback server answers", resp.status == 200, resp.status)
            check("and answers with JSON", body.lstrip().startswith("{"), body[:80])
            check("stop() shuts it down", omerta_boot.stop(str(ROOT)) is True)
        finally:
            os.environ.pop("OMERTA_ANDROID_HTTP", None)
finally:
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

print(f"\n{ok} checks passed")
print("BRIDGE TESTS PASSED")
