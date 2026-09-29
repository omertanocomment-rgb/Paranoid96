# Signing Omerta artifacts to publishable standard

Every release artifact ships **signed** (the OMERTA release standard).

## Android APK / AAB
```bash
bash scripts/sign/make-android-keystore.sh "Omerta AI" omerta   # once; creates omerta-release.jks
cd android && ./gradlew :app:assembleRelease                    # signed APK
./gradlew :app:bundleRelease                                    # signed AAB for Play
```
`app/build.gradle.kts` already reads `android/keystore.properties`. For CI, set
`RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`
(see `.github/workflows/android.yml`). Verify: `apksigner verify --print-certs app-release.apk`.

## Linux .deb
```bash
bash scripts/sign/sign-deb.sh dist/omerta-ai-desktop_1.1.0_all.deb  YOUR_GPG_KEY_ID
```
Publish the public key so users can `apt-key`/`gpg --import` and trust it.

## AppImage
Sign with an embedded GPG signature at build time:
`appimagetool --sign ...` (set `SIGN=1` and a default GPG key), or detached: `gpg --detach-sign file.AppImage`.

Never commit `*.jks`, `keystore.properties`, or private keys — they are git-ignored.
