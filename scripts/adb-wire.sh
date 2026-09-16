#!/usr/bin/env bash
# Wire a USB-connected device to a backend running on this host at :8080.
set -euo pipefail
adb reverse tcp:8080 tcp:8080
echo "Device can now reach the backend at http://localhost:8080"
