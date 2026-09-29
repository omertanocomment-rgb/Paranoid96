#!/usr/bin/env bash
# GPG-sign a .deb so it installs as a trusted, publishable package.
#   bash scripts/sign/sign-deb.sh dist/omerta-ai-desktop_1.1.0_all.deb [GPG_KEY_ID]
set -euo pipefail
DEB="${1:?usage: sign-deb.sh <file.deb> [gpg-key-id]}"
KEY="${2:-}"
if ! command -v dpkg-sig >/dev/null 2>&1; then
  echo "dpkg-sig not found. Install with: sudo apt install dpkg-sig"; exit 1
fi
if [ -n "$KEY" ]; then dpkg-sig --sign builder -k "$KEY" "$DEB"; else dpkg-sig --sign builder "$DEB"; fi
dpkg-sig --verify "$DEB"
echo "Signed + verified: $DEB"
