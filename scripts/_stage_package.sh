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
PY
find build_pkg -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
echo "staged build_pkg/"
