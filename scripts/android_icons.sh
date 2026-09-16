#!/usr/bin/env bash
# Install the blackletter O as the Android launcher icon (all densities).
set -euo pipefail
cd "$(dirname "$0")/.."
RES="android/android/app/src/main/res"
[ -d "$RES" ] || { echo "run 'npx cap add android' in android/ first"; exit 1; }
declare -A D=( [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
for d in "${!D[@]}"; do
  s=${D[$d]}
  mkdir -p "$RES/mipmap-$d"
  cp "assets/icon_${s}.png" "$RES/mipmap-$d/ic_launcher.png" 2>/dev/null || \
    python3 -c "
import cairosvg; cairosvg.svg2png(url='assets/icon.svg',
  write_to='$RES/mipmap-$d/ic_launcher.png', output_width=$s, output_height=$s)"
  cp "$RES/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
  cp "assets/android_fg_${s}.png" "$RES/mipmap-$d/ic_launcher_foreground.png" 2>/dev/null || true
done
mkdir -p "$RES/values"
cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#0b0a08</color></resources>
XML
echo "launcher icons installed into $RES"
