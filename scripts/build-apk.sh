#!/usr/bin/env bash
# Build the Omerta AI APK locally. Usage: scripts/build-apk.sh [debug|release] [backendUrl]
set -euo pipefail
VARIANT="${1:-debug}"
BACKEND="${2:-}"
cd "$(dirname "$0")/../android"
[ -f local.properties ] || echo "sdk.dir=${ANDROID_HOME:-/opt/android-sdk}" > local.properties
ARGS=""
[ -n "$BACKEND" ] && ARGS="-PomertaBackendUrl=$BACKEND"
if [ "$VARIANT" = "release" ]; then
  ./gradlew :app:assembleRelease $ARGS --no-daemon
  echo "APK: android/app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew :app:assembleDebug $ARGS --no-daemon
  echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
fi
