#!/usr/bin/env bash

set -u

OUT="${1:-$HOME/t509k-evidence}"

mkdir -p "$OUT"

echo "Collecting T509K evidence..."

adb devices > "$OUT/adb-devices.txt"

adb shell getprop > "$OUT/getprop.txt"

adb shell cat /proc/cpuinfo \
    > "$OUT/cpuinfo.txt" 2>/dev/null

adb shell cat /proc/meminfo \
    > "$OUT/meminfo.txt" 2>/dev/null

adb shell cat /proc/partitions \
    > "$OUT/partitions.txt" 2>/dev/null

adb shell cat /proc/cmdline \
    > "$OUT/cmdline.txt" 2>/dev/null

adb shell ls -la /dev/block/by-name \
    > "$OUT/by-name.txt" 2>/dev/null

adb shell cat /proc/device-tree/compatible \
    > "$OUT/compatible.txt" 2>/dev/null

adb shell ls -la /proc/device-tree \
    > "$OUT/device-tree.txt" 2>/dev/null

adb shell ls -la /sys/firmware/devicetree/base \
    > "$OUT/firmware-device-tree.txt" 2>/dev/null

adb shell dumpsys battery \
    > "$OUT/battery.txt" 2>/dev/null

adb shell dumpsys thermalservice \
    > "$OUT/thermal.txt" 2>/dev/null

adb shell dmesg \
    > "$OUT/dmesg.txt" 2>/dev/null

echo
echo "Evidence saved to:"
echo "$OUT"
