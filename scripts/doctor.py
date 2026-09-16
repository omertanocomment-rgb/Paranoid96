#!/usr/bin/env python3
"""
OMERTA AGENT — doctor. Tells you exactly what works and what to fix.

    python scripts/doctor.py
"""
import importlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import config, router, skills, plugins, mcp, memory, auth, sync  # noqa: E402

OK, BAD, WARN = "\033[92m✓\033[0m", "\033[91m✗\033[0m", "\033[93m!\033[0m"
H = lambda s: print(f"\n\033[93m{s}\033[0m")  # noqa: E731


def main():
    print("\n\033[93m═══ OMERTA AGENT — doctor ═══\033[0m")

    H("Python")
    v = sys.version_info
    print(f"  {OK if v >= (3, 9) else BAD} python {v.major}.{v.minor}.{v.micro}"
          f"{'' if v >= (3, 9) else '  — need 3.9+'}")

    H("Dependencies")
    deps = [("requests", "providers", True), ("yaml", "persona/connectors", True),
            ("rich", "CLI", True), ("fastapi", "web UI", False),
            ("uvicorn", "web server", False), ("anthropic", "Claude SDK (optional - HTTP fallback works)", False)]
    for mod, why, required in deps:
        try:
            importlib.import_module(mod)
            print(f"  {OK} {mod:<12} ({why})")
        except ImportError:
            mark = BAD if required else WARN
            print(f"  {mark} {mod:<12} ({why}) — pip install "
                  f"{'pyyaml' if mod == 'yaml' else mod}")

    H("Model brains")
    net = router.has_internet()
    print(f"  {OK if net else WARN} internet: {'reachable' if net else 'OFFLINE (local brains only)'}")
    ready = []
    for pid, s in router.provider_status().items():
        mark = OK if s["ready"] else WARN
        note = "" if s["ready"] else f"  — {s['why']}"
        print(f"  {mark} {pid:<12} {s['model']}{note}")
        if s["ready"]:
            ready.append(pid)
    if not ready:
        print(f"\n  {BAD} NO BRAIN AVAILABLE. Fix one:")
        print("     online : export ANTHROPIC_API_KEY=sk-ant-...")
        print("     offline: ollama serve && ollama pull qwen2.5-coder:7b")
    else:
        print(f"\n  {OK} usable now: {', '.join(ready)}")

    H("External tools")
    for t, why in [("git", "version control"), ("adb", "Android device"),
                   ("fastboot", "bootloader/flashing"), ("node", "JS builds"),
                   ("npm", "JS builds"), ("gradle", "Android builds"),
                   ("ollama", "offline brain"), ("java", "Android builds"),
                   ("clang", "native/cross builds"), ("cmake", "native builds")]:
        p = shutil.which(t)
        print(f"  {OK if p else WARN} {t:<10} {p or '(not installed — ' + why + ')'}")

    H("Agent subsystems")
    sk = skills.load_all()
    print(f"  {OK if sk else WARN} skills     {len(sk)}: {', '.join(s['name'] for s in sk) or 'none'}")
    pl = plugins.load_all()
    broken = [n for n, d in pl.items() if "error" in d]
    print(f"  {OK if pl and not broken else WARN} plugins    {len(pl)} loaded"
          f"{', BROKEN: ' + ', '.join(broken) if broken else ''}")
    cons = mcp.status()
    print(f"  {OK if cons else WARN} connectors {len(cons)} configured, "
          f"{sum(1 for c in cons if c['enabled'])} enabled")

    H("Memory")
    ms = memory.stats()
    print(f"  {OK} {ms['facts']} facts · {ms['choices']} learned choices · "
          f"{ms['sessions']} sessions")
    print(f"  {OK} db: {config.MEMORY_DB}")
    st = sync.status()
    print(f"  {OK} device id: {st['device']}")
    peers, files = len(st.get("peers", {})), len(st.get("files", {}))
    if peers or files:
        print(f"  {OK} sync: {peers} peer(s), {files} folder(s)")
    elif config.SYNC_DIR:
        print(f"  {OK} sync folder configured: {config.SYNC_DIR}")
    else:
        print(f"  {WARN} sync not configured — set OMERTA_SYNC_DIR "
              f"or use /sync <host:port>")

    H("Mode")
    mode = config._norm_mode(config.get("OMERTA_MODE", config.MODE))
    print(f"  {OK} network mode: {mode}  "
          f"({'local models only' if mode == 'offline' else 'cloud only' if mode == 'online' else 'online if reachable, else local'})")
    print(f"  {OK} chats: unlimited (context window trimmed to "
          f"{config.HISTORY_LIMIT or 'no'} messages)")

    H("Safety")
    print(f"  {OK if config.ALWAYS_ASK else WARN} always-ask: "
          f"{'ON — nothing runs without your approval' if config.ALWAYS_ASK else 'OFF'}")
    print(f"  {OK} {len(config.DENY_PATTERNS)} hard-deny patterns active")
    if auth.enabled():
        print(f"  {OK} server auth ON (loopback exempt: {auth.allow_loopback()})")
    else:
        print(f"  {WARN} server auth OFF — anyone on the network can approve commands")

    print(f"\n\033[93m═══ done ═══\033[0m\n")


if __name__ == "__main__":
    main()
