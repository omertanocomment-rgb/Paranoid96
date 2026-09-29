#!/usr/bin/env bash
# Generate a release keystore for signing the Android APK to publishable standard, and
# write android/keystore.properties (git-ignored). Run once per app; keep the .jks safe.
#   bash scripts/sign/make-android-keystore.sh "Omerta AI" omerta
set -euo pipefail
NAME="${1:-Omerta AI}"
ALIAS="${2:-omerta}"
cd "$(dirname "$0")/../../android"
KS="omerta-release.jks"
if [ -f "$KS" ]; then echo "$KS already exists — refusing to overwrite."; exit 1; fi
: "${STORE_PASS:=$(head -c18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c24)}"
: "${KEY_PASS:=$STORE_PASS}"
keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 \
  -validity 10000 -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "CN=$NAME, OU=OMERTA, O=OMERTA, C=US"
cat > keystore.properties <<PROPS
storeFile=$KS
storePassword=$STORE_PASS
keyAlias=$ALIAS
keyPassword=$KEY_PASS
PROPS
echo "Created $KS and keystore.properties (both git-ignored)."
echo "Store password: $STORE_PASS   — save this in a password manager; it cannot be recovered."
echo "Build signed release:  ./gradlew :app:assembleRelease"
echo "For CI, base64 the keystore into RELEASE_KEYSTORE_BASE64 and set the RELEASE_* secrets."
