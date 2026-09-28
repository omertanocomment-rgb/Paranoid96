#!/usr/bin/env bash
# The whole Windows pipeline: stamp, stage the interpreter, pack, wrap.
#
# One entry point because the steps are order-dependent in ways that are easy
# to get wrong: the build stamp has to be written BEFORE electron-builder
# copies core/ into the app resources, or the Windows build ships whichever
# stamp the last build left behind -- which is how a desktop build came to
# report itself as channel "android".
set -euo pipefail
cd "$(dirname "$0")/.."

export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-omerta}"
export WINEDEBUG="${WINEDEBUG:--all}"
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "1/4  stamping this build as windows"
python3 scripts/stamp_build.py windows

echo "2/4  staging the bundled interpreter"
bash scripts/fetch_win_runtime.sh

echo "3/4  packing the application"
( cd desktop && npx electron-builder --win --x64 --dir --publish never )

echo "4/4  wrapping the installer"
bash packaging/build-win-exe.sh
