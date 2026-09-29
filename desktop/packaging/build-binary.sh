#!/usr/bin/env bash
# Build a self-contained single-file binary with PyInstaller: bundles Python + Tk +
# the app. No system Python or python3-tk needed at runtime. Requires pyinstaller and
# Tk dev headers at BUILD time:  pip install pyinstaller  (and OS tk, e.g. tk-dev).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/bundle
cp omerta_desktop.py ../brain/omerta_brain.py build/bundle/
[ -f ../brain/brains/omerta.brain ] && cp ../brain/brains/omerta.brain build/bundle/ || true
cd build/bundle
ADD=""
[ -f omerta.brain ] && ADD="--add-data omerta.brain:."
pyinstaller --onefile --name omerta-ai --windowed \
  --hidden-import tkinter $ADD omerta_desktop.py
mkdir -p ../../dist
cp dist/omerta-ai ../../dist/omerta-ai
echo "Binary: desktop/dist/omerta-ai"
