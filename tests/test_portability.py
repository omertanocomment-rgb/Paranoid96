#!/usr/bin/env python3
"""The backend imports and reads files correctly off Linux.

This exists because the desktop app could never have run on Windows, and two
separate faults were in the way:

  * core/terminal.py imported fcntl and termios at module scope. Both are
    POSIX-only, and core/api.py imports terminal, so the ENTIRE backend was
    unimportable on Windows. The module already degrades to pipes when a PTY
    cannot be had; it just never got the chance.
  * 42 calls read or wrote text files without naming an encoding. Python uses
    the LOCALE default there, which is UTF-8 on Linux and cp1252 on Windows.
    Serving the web UI did (config.WEBUI_DIR / "index.html").read_text(), and
    index.html is UTF-8, so on Windows that raised UnicodeDecodeError -- a
    ValueError, which the handler's `except OSError` did not catch. The
    browser got an empty reply and no explanation.

The second one is the more dangerous of the two because it is silent and
data-dependent: a chat containing an em-dash would fail to save, and only on
some machines. So this pins the rule rather than the single instance.
"""
import ast
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


FILES = sorted((ROOT / "core").glob("*.py")) + [
    ROOT / p for p in ("cli.py", "server.py", "omerta_entry.py",
                       "omerta_android.py") if (ROOT / p).exists()]

POSIX_ONLY = {"fcntl", "termios", "pty", "pwd", "grp", "resource", "posix",
              "tty", "crypt", "syslog", "fcntl"}

print("=== portability ===")

# ── 1. no POSIX-only module imported unguarded at module scope ─────────────
unguarded = []
for f in FILES:
    tree = ast.parse(f.read_text(encoding="utf-8"))
    for node in tree.body:                      # module scope only
        names = []
        if isinstance(node, ast.Import):
            names = [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            names = [node.module.split(".")[0]]
        for n in names:
            if n in POSIX_ONLY:
                unguarded.append(f"{f.name}: import {n}")
check("no POSIX-only module is imported unguarded at module scope",
      not unguarded, unguarded)

# ── 2. every text read/write names an encoding ─────────────────────────────
missing = []
for f in FILES:
    tree = ast.parse(f.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        kw = {k.arg for k in node.keywords}
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else (
            fn.id if isinstance(fn, ast.Name) else "")
        if name in ("read_text", "write_text") and "encoding" not in kw:
            missing.append(f"{f.name}:{node.lineno} {name}()")
        elif name == "open" and "encoding" not in kw:
            # binary mode needs no encoding; anything else does
            mode = ""
            if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                mode = str(node.args[1].value)
            for k in node.keywords:
                if k.arg == "mode" and isinstance(k.value, ast.Constant):
                    mode = str(k.value.value)
            binary = "b" in mode
            dynamic = (len(node.args) > 1
                       and not isinstance(node.args[1], ast.Constant))
            if not binary and not dynamic and isinstance(fn, ast.Name):
                missing.append(f"{f.name}:{node.lineno} open(mode={mode!r})")
check("every text read/write names an encoding", not missing, missing)

# ── 3. the UI is actually UTF-8, so the rule above is not academic ─────────
raw = (ROOT / "webui" / "index.html").read_bytes()
check("the web UI really is UTF-8, not ASCII",
      any(b > 127 for b in raw))
try:
    raw.decode("cp1252")
    cp1252_ok = True
except UnicodeDecodeError:
    cp1252_ok = False
check("and would NOT decode under a Windows locale (so this was a real break)",
      not cp1252_ok)
check("it does decode as UTF-8", bool(raw.decode("utf-8")))

# ── 4. core.terminal imports with the POSIX modules absent ────────────────
# This is what Windows looks like from Python's side.
class Block:
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in ("fcntl", "termios", "pty"):
            raise ImportError("blocked: " + name)
        return None


for mod in [m for m in list(sys.modules) if m.startswith("core")]:
    del sys.modules[mod]
for m in ("fcntl", "termios", "pty"):
    sys.modules.pop(m, None)

sys.meta_path.insert(0, Block())
try:
    import core.terminal as term
    ok = True
    err = ""
except Exception as e:  # noqa: BLE001
    ok, err, term = False, f"{type(e).__name__}: {e}", None
check("core.terminal imports with fcntl/termios/pty unavailable", ok, err)
if term is not None:
    check("and reports that it has no POSIX tty", term.POSIX_TTY is False)
    check("a session leader hook is not offered without one",
          term._become_session_leader(0) is None)

try:
    import core.api  # noqa: F401
    ok2, err2 = True, ""
except Exception as e:  # noqa: BLE001
    ok2, err2 = False, f"{type(e).__name__}: {e}"
check("the whole API layer imports too (this is what broke the desktop app)",
      ok2, err2)
sys.meta_path.remove(Block) if False else sys.meta_path.pop(0)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nPORTABILITY TESTS PASSED")
