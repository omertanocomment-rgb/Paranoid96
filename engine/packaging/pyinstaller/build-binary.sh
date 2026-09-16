#!/usr/bin/env bash
# Build a self-contained `omerta` binary with PyInstaller (Linux or Windows).
set -euo pipefail
cd "$(dirname "$0")/../.."
pip install -q -e . pyinstaller
pyinstaller --onefile --clean --noconfirm \
  --name omerta \
  --paths . \
  --collect-submodules omerta \
  packaging/pyinstaller/omerta_entry.py
echo "Binary: engine/dist/omerta"
