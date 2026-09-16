#!/usr/bin/env bash

set -euo pipefail

echo "========================================"
echo " OMERTA AI — T509K BUILD"
echo "========================================"

if [ -z "${ANDROID_BUILD_TOP:-}" ]; then
    echo "[INFO] Loading Android build environment..."
    source build/envsetup.sh
fi

echo "[INFO] Select the confirmed T509K target."
echo "[INFO] Do not use an unverified lunch target."

read -r -p "Lunch target: " TARGET

lunch "$TARGET"

echo
echo "[INFO] Starting build..."
echo

mka bacon

echo
echo "========================================"
echo " BUILD FINISHED"
echo "========================================"
