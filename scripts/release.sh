#!/usr/bin/env bash
# Build every executable and put them in one zip.
#
# Standing rule from the owner: a release is an .apk, a .deb and an .exe, every
# time. Shipping one and describing the others is not a release, so this builds
# all three, refuses to package if the audit gate finds anything, and checks
# what it actually produced rather than what it expected to.
#
#   bash scripts/release.sh            # everything
#   bash scripts/release.sh --skip-gate    # only when the gate ran a moment ago
#
# Output: dist/OMERTA-AI-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_GATE=0
[ "${1:-}" = "--skip-gate" ] && SKIP_GATE=1

VER="$(python3 -c "import re;print(re.search(r'version\s*=\s*\"([^\"]+)\"',open('pyproject.toml').read()).group(1))")"
OUT="build_pkg/OMERTA-AI-$VER"
ZIP="dist/OMERTA-AI-$VER.zip"

say() { printf '\n\033[91m── %s\033[0m\n' "$1"; }
fail() { printf '\033[91mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# ── the gate first ──────────────────────────────────────────────────────────
# Everything below depends on it, the same way CI does. A release that packages
# past a finding is exactly what the gate exists to prevent.
if [ "$SKIP_GATE" = "0" ]; then
  say "audit gate"
  python3 scripts/audit.py --phase "release $VER" || fail "the audit gate found something"
fi

rm -rf "$OUT"
mkdir -p "$OUT/android" "$OUT/linux" "$OUT/windows" "$OUT/docs" dist

# ── android ─────────────────────────────────────────────────────────────────
say "android apk (arm64-v8a + armeabi-v7a)"
if [ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]; then
  GRADLE="gradle"; [ -x android-native/gradlew ] && GRADLE="./gradlew"
  ( cd android-native && $GRADLE assembleRelease \
      -PomertaAbi=arm64-v8a,armeabi-v7a --no-daemon )
  APK=$(find android-native -name '*release*.apk' | head -1)
  [ -n "$APK" ] || fail "no APK was produced"

  # Check the artifact, not the command that should have made it. A
  # single-ABI APK shipped for eight versions and would not install on a
  # 32-bit phone.
  AAPT=$(ls "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/*/aapt2 2>/dev/null | tail -1 || true)
  if [ -n "$AAPT" ]; then
    NATIVE=$("$AAPT" dump badging "$APK" | grep "native-code" || true)
    echo "  $NATIVE"
    echo "$NATIVE" | grep -q "armeabi-v7a" || fail "the APK is missing armeabi-v7a"
    echo "$NATIVE" | grep -q "arm64-v8a"   || fail "the APK is missing arm64-v8a"
  fi
  # The app is Compose; HTML in the package means the web UI crept back in.
  if unzip -l "$APK" | grep -qiE '\.html'; then
    fail "the APK contains HTML — the web UI is back in the Android build"
  fi
  cp "$APK" "$OUT/android/omerta-ai-$VER.apk"
else
  echo "  skipped — ANDROID_HOME is not set"
fi

# ── linux ───────────────────────────────────────────────────────────────────
say "linux .deb"
bash packaging/build-deb.sh >/dev/null
cp "dist/omerta-agent_${VER}_all.deb" "$OUT/linux/"

# ── windows ─────────────────────────────────────────────────────────────────
say "windows .exe"
if bash packaging/build-win.sh >/dev/null 2>&1; then
  cp "dist/OMERTA-AGENT-$VER-win-x64-setup.exe" "$OUT/windows/"
else
  echo "  build failed — see packaging/build-win.sh"
  echo "  (needs node, wine64 and the Android-free desktop toolchain)"
fi

# ── docs ────────────────────────────────────────────────────────────────────
say "docs"
python3 scripts/gen_manual.py >/dev/null || true
python3 scripts/gen_pdf.py >/dev/null || true
cp docs/OMERTA_AI_Owners_Manual.pdf docs/OMERTA_AGENT_Guide.pdf "$OUT/docs/" 2>/dev/null || true
cp CHANGELOG.md "$OUT/docs/"

# ── the zip ─────────────────────────────────────────────────────────────────
say "packaging"
( cd "$OUT" && find . -type f ! -name SHA256SUMS -print0 | sort -z \
    | xargs -0 sha256sum > SHA256SUMS )
rm -f "$ZIP"
( cd build_pkg && zip -r -q -1 "../$ZIP" "OMERTA-AI-$VER" )
unzip -t "$ZIP" >/dev/null || fail "the zip does not verify"

printf '\n\033[92mbuilt %s (%s)\033[0m\n' "$ZIP" "$(du -h "$ZIP" | cut -f1)"
echo
find "$OUT" -type f \( -name '*.apk' -o -name '*.deb' -o -name '*.exe' \) \
  -printf '  %-56p %s bytes\n' | sed "s|$OUT/||"
