---
name: apk-analysis
description: Inspecting APK/IPA files — manifests, permissions, native libs, signatures
triggers: [apk, ipa, manifest, permissions, decompile, apktool, jadx, aapt, apksigner, reverse, entitlements]
---

# APK / IPA inspection

## Quick triage of an APK

- Metadata/permissions: `aapt dump badging app.apk`
- Full manifest: `apktool d app.apk -o out/` then read `out/AndroidManifest.xml`
- Signature: `apksigner verify --print-certs app.apk`
- Native libs / target arch: `unzip -l app.apk | grep lib/`
- Sources: `jadx -d out-src app.apk`

## Red flags

- `android:debuggable="true"` in a release build
- `android:allowBackup="true"` on anything holding secrets
- exported activities/services/receivers with no permission guard
- `android:usesCleartextTraffic="true"` or a permissive
  `network_security_config.xml`
- keys hardcoded in `strings.xml` or `BuildConfig`

## IPA

- `unzip app.ipa && plutil -p Payload/*.app/Info.plist`
- Entitlements: `codesign -d --entitlements :- Payload/*.app`
- Encrypted binaries (`cryptid 1`) need a decrypted dump from a jailbroken
  device before static analysis means anything.

## Scope

Only analyse apps you own, authored, or are explicitly authorised to assess.
If the target isn't yours, say so and stop.
