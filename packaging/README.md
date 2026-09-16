# Packaging OMERTA

| Target | Command | Notes |
|---|---|---|
| Python wheel / sdist | `bash scripts/_stage_package.sh && (cd build_pkg && python -m build)` | universal; installs on Linux/macOS/Windows/Termux |
| Docker / OCI image | `docker build -t omerta-agent -f docker/Dockerfile .` | runs `omerta serve` on :8787; mount a volume at `/data` |
| Debian `.deb` | `bash packaging/build-deb.sh` | needs `dpkg-deb`; installs to `/opt/omerta-agent` + `/usr/bin/omerta`; depends on system `python3`, `python3-requests`, `python3-yaml` |
| AppImage (thin) | `bash packaging/build-appimage.sh` | needs `appimagetool`; uses the host `python3` |
| Android APK (embedded Python) | `cd android-native && gradle assembleDebug` | Chaquopy; see `android-native/README.md` |
| Electron desktop | `cd desktop && npm i && npm run dist:all` | win/mac/linux installers |

`scripts/build_all.sh` runs every target that this host has the tools for.

The `.deb` and thin AppImage run OMERTA from source against the system
`python3` (plus `requests`/`pyyaml`, both pure-Python). The Docker image bundles
its own interpreter and the web stack. None of them hard-code an API key — set
`ANTHROPIC_API_KEY` (or another provider), or point at a local model.
