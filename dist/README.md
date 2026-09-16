# Prebuilt Omerta AI APKs

- `OmertaAI-release.apk` — R8-minified, signed release build (`ai.omerta.assistant`).

Before installing, point it at your backend: either rebuild with
`./gradlew :app:assembleRelease -PomertaBackendUrl=https://your-backend`, or install
this APK and set the backend URL in the app's **Settings** screen.

Install: `adb install -r OmertaAI-release.apk`

This APK is signed with a self-signed development key. For distribution, rebuild with
your own keystore (see `CLAUDE.md`) or the CI signing secrets (see root `README.md`).
