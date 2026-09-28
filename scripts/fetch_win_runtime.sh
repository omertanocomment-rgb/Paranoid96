#!/usr/bin/env bash
# Stage a self-contained CPython for the Windows desktop build.
#
# Without this the .exe is not an application, it is a prerequisite: the
# launcher looks for python on PATH and, when it does not find one, shows a
# dialog telling the owner to go and install it from python.org. That is the
# same "install this other thing first" problem the APK removed by embedding
# CPython, and it has no more business on Windows than it did on Android.
#
# python.org's "embeddable package" is the official, redistributable build
# intended exactly for this. It is ~11 MB and needs no installer, no registry
# entry and no admin rights.
#
#   bash scripts/fetch_win_runtime.sh      -> desktop/runtime/win-x64/
set -euo pipefail
cd "$(dirname "$0")/.."

PYVER=3.11.9
URL="https://www.python.org/ftp/python/${PYVER}/python-${PYVER}-embed-amd64.zip"
# Pinned so a later build cannot silently pick up a different interpreter.
WANT=009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b
DEST="desktop/runtime/win-x64"
CACHE="build_pkg/cache/python-${PYVER}-embed-amd64.zip"

mkdir -p "$(dirname "$CACHE")"
if [ ! -f "$CACHE" ]; then
  echo "fetching CPython ${PYVER} (windows embeddable)"
  curl -sSL -o "$CACHE.part" "$URL"
  mv "$CACHE.part" "$CACHE"
fi

GOT=$(sha256sum "$CACHE" | cut -d' ' -f1)
if [ "$GOT" != "$WANT" ]; then
  echo "checksum mismatch for $CACHE" >&2
  echo "  want $WANT" >&2
  echo "  got  $GOT" >&2
  # Refuse rather than ship an interpreter of unknown provenance into an
  # executable other people will run.
  rm -f "$CACHE"
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$CACHE" -d "$DEST"

# The embeddable build reads its ENTIRE sys.path from this file and ignores
# PYTHONPATH, so the app directory has to be named here or none of the agent's
# own modules can be imported. Paths are relative to python.exe, and the
# packaged layout puts the runtime and the app side by side under resources/.
cat > "$DEST/python311._pth" <<'PTH'
python311.zip
.
site-packages
..\app
import site
PTH

# The backend is described as stdlib-only, and core/httpd.py very nearly is --
# but core/mcp.py imports requests and yaml at module scope, core/agent.py
# imports yaml, and core/sync.py imports requests. On a machine with a system
# Python those come from the distro; here there is no system Python at all, so
# they have to travel with the interpreter or importing the server fails
# outright. Windows wheels, fetched for the target platform rather than this
# build host's.
python3 -m pip install --quiet --no-compile \
  --platform win_amd64 --python-version 3.11 --implementation cp \
  --only-binary=:all: --target "$DEST/site-packages" \
  "requests>=2.31.0" "pyyaml>=6.0"

# pip leaves its bookkeeping behind; it is dead weight inside an installer.
rm -rf "$DEST/site-packages"/*.dist-info "$DEST/site-packages/bin"

echo "staged $DEST ($(du -sh "$DEST" | cut -f1))"
