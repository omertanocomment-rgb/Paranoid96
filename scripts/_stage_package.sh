#!/usr/bin/env bash
# Stage the importable package layout that the wheel is built from.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf build_pkg/omerta_agent
mkdir -p build_pkg/omerta_agent
cp -r core tools skills plugins webui assets persona.yaml connectors.yaml build_pkg/omerta_agent/
cp pyproject.toml README.md build_pkg/
printf '"""OMERTA AGENT."""\n__version__ = "1.0.0"\n' > build_pkg/omerta_agent/__init__.py
python3 - <<'PY'
from pathlib import Path
src = Path("cli.py").read_text().replace('if __name__ == "__main__":\n    sys.exit(main())', '')
Path("build_pkg/omerta_agent/cli_main.py").write_text(src)
srv = Path("server.py").read_text()
Path("build_pkg/omerta_agent/server_main.py").write_text(srv)
doc = Path("scripts/doctor.py").read_text().replace(
    'sys.path.insert(0, str(Path(__file__).resolve().parent.parent))',
    'sys.path.insert(0, str(Path(__file__).resolve().parent))')
Path("build_pkg/omerta_agent/doctor_main.py").write_text(doc)

# Unified console-script entry point (pyproject: omerta_agent.__main__:main).
Path("build_pkg/omerta_agent/__main__.py").write_text('''\
"""Unified entry point for the installed package."""
import sys, os
_PKG = os.path.dirname(os.path.abspath(__file__))
if _PKG not in sys.path:
    sys.path.insert(0, _PKG)


def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv and not argv[0].startswith("-") else None
    if cmd == "serve":
        sys.argv = [sys.argv[0]] + argv[1:]
        try:
            from omerta_agent import server_main
            return server_main.run()
        except ImportError:
            from core import httpd          # stdlib fallback, no FastAPI needed
            return httpd.run()
    if cmd == "doctor":
        from omerta_agent import doctor_main
        return doctor_main.main()
    if cmd == "sync":
        from core import sync, config
        t = argv[1] if len(argv) > 1 else None
        if t and ":" in t and "/" not in t:
            print(sync.sync_peer(t, token=argv[2] if len(argv) > 2 else None))
        elif t:
            print(sync.sync_file(t))
        elif config.SYNC_DIR:
            print(sync.sync_file(config.SYNC_DIR))
        else:
            print("set OMERTA_SYNC_DIR, or: omerta sync <host:port|/path>")
        return 0
    if cmd in ("version", "--version", "-V"):
        from omerta_agent import __version__
        print(f"omerta-agent {__version__}")
        return 0
    sys.argv = [sys.argv[0]] + argv
    from omerta_agent import cli_main
    return cli_main.main()


if __name__ == "__main__":
    sys.exit(main() or 0)
''')
PY
find build_pkg -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
echo "staged build_pkg/"
