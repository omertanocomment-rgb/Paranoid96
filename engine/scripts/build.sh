#!/usr/bin/env bash
# Build all Linux artifacts: PyInstaller binary, .deb, AppImage.
set -euo pipefail
cd "$(dirname "$0")/.."
. .venv/bin/activate 2>/dev/null || { python3 -m venv .venv && . .venv/bin/activate; }
pip install -q -e . pyinstaller
bash packaging/pyinstaller/build-binary.sh
bash packaging/deb/build-deb.sh
bash packaging/appimage/build-appimage.sh || echo "AppImage step skipped (see log)"
echo "Artifacts in engine/dist/"
