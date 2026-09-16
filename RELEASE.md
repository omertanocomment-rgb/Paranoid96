# Release process

Everything here is reproducible from a clean checkout. Nothing depends on a
machine's local state, and no secret is ever committed.

## 0. Preflight

```bash
bash tests/run_all.sh          # all six suites must pass
python scripts/doctor.py       # environment sane
grep -rIn "sk-ant-\|ghp_\|BEGIN PRIVATE" --exclude-dir=.git --exclude-dir=artifacts .
```

Bump the version in **all four** places — they are checked in CI:
`pyproject.toml`, `android-native/app/build.gradle` (`versionCode` *and*
`versionName`), `desktop/package.json`, `CHANGELOG.md`.

## 1. Signing keys — one time, kept off the machine

```bash
keytool -genkeypair -v -keystore omerta-release.keystore -alias omerta \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=OMERTA, OU=Development, O=OMERTA, L=Sydney, ST=NSW, C=AU"
```

**PKCS12 keystores require the store and key passwords to be identical.**
keytool accepts a mismatch silently and Gradle then fails at packaging with
`Given final block not properly padded` — a confusing error with a trivial
cause.

Back the keystore up offline. Losing it means never updating the app under
the same package name again.

Credentials come from an untracked `keystore.properties` or the environment:

```properties
storeFile=/secure/path/omerta-release.keystore
storePassword=…
keyAlias=omerta
keyPassword=…
```
`keystore.properties` and `*.keystore` are gitignored. Keep it that way.

## 2. Build

```bash
bash scripts/build_all.sh                        # wheel, sdist, binary, desktop
cd android-native && gradle assembleRelease      # signed, shrunk APK
```

## 3. Verify before shipping — every item

```bash
apksigner verify -v --print-certs app/build/outputs/apk/release/app-release.apk
```

| Check | Required |
|---|---|
| v2 + v3 signature schemes | `true` |
| Signer DN | **not** `CN=Android Debug` |
| `android:debuggable` | absent from the release manifest |
| `android:allowBackup` | `0x0` — otherwise `adb backup` exfiltrates the stored token |
| zipalign | `zipalign -c -v 4 <apk>` passes |
| Python metadata | `twine check build_pkg/dist/*` passes |

v1 (JAR) signing shows `false` and that is correct: minSdk is 24, and AGP
omits v1 above API 23.

## 4. Checksums

```bash
cd artifacts && sha256sum * > SHA256SUMS
```

## 5. Tag

```bash
git tag -a v1.0.0 -m "…" && git push --tags
```

## Never

- Commit a keystore, `keystore.properties`, or an API key
- Ship a release APK signed with the debug key — its private key is public,
  so anyone can forge an update
- Ship with `allowBackup=true` while the app stores a backend token
- Disable the approval gate in a distributed build
