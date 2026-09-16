---
name: android-build
description: Building, signing and installing Android apps — Gradle, Capacitor, Kotlin, APK output
triggers: [gradle, gradlew, apk, android, kotlin, capacitor, ionic, aab, signing, keystore]
---

## Build an Android app

1. Verify the toolchain before building — a missing SDK wastes a 5-minute build:
   `echo $ANDROID_HOME && ls $ANDROID_HOME/platform-tools`
2. Prefer the wrapper over a system gradle: `./gradlew` if it exists.
3. Debug build: `./gradlew assembleDebug` → `app/build/outputs/apk/debug/`
4. Release build: `./gradlew assembleRelease` (needs signing config).
5. Capacitor projects: `npm run build && npx cap sync android` BEFORE gradle,
   or you ship stale web assets — this is the single most common Capacitor bug.

## Signing

Unsigned release APKs will not install. Generate once:
```
keytool -genkey -v -keystore release.keystore -alias key0 \
  -keyalg RSA -keysize 2048 -validity 10000
```
Then in `app/build.gradle` add a `signingConfigs.release` block referencing it
via `gradle.properties` (never hardcode the password in a tracked file).

## Common failures

- `SDK location not found` → create `local.properties` with `sdk.dir=/path/to/sdk`
- `Unsupported class file major version` → JDK/AGP mismatch; check the AGP
  version against the Gradle and JDK versions.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → signature mismatch; uninstall first.
- OOM during build on a phone → add to `gradle.properties`:
  `org.gradle.jvmargs=-Xmx1536m` and `org.gradle.daemon=false`

## On-device (Termux) note

Full Android builds in Termux are constrained. If gradle OOMs or aapt2 fails
(aapt2 ships x86 binaries in some AGP versions), the pragmatic path is to build
on the Kali box and `adb install` to the phone, rather than fighting the
toolchain on-device.
