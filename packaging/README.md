# Packaging OMERTA

| Target | Command | Notes |
|---|---|---|
| Python wheel / sdist | `bash scripts/_stage_package.sh && (cd build_pkg && python -m build)` | universal; installs on Linux/macOS/Windows/Termux |
| Docker / OCI image | `docker build -t omerta-agent -f docker/Dockerfile .` | runs `omerta serve` on :8787; mount a volume at `/data` |
| Debian `.deb` | `bash packaging/build-deb.sh` | needs `dpkg-deb`; installs to `/opt/omerta-agent` + `/usr/bin/omerta`; depends on system `python3`, `python3-requests`, `python3-yaml` |
| AppImage (**fat**) | `bash packaging/build-appimage.sh` | one file, its own CPython 3.12 + deps inside; needs nothing on the target. Fetches its own `appimagetool`. |
| Android APK (embedded Python) | `cd android-native && gradle assembleDebug` | Chaquopy; see `android-native/README.md` |
| Electron desktop | `cd desktop && npm i && npm run dist:all` | win/mac/linux installers |

`scripts/build_all.sh` runs every target that this host has the tools for.

The `.deb` runs OMERTA from source against the system `python3` (plus
`requests`/`pyyaml`, both pure-Python). The Docker image and the AppImage each
bundle their own interpreter. None of them hard-code an API key — set
`ANTHROPIC_API_KEY` (or another provider), or point at a local model.

## The AppImage, in detail

It is genuinely self-contained: `./OMERTA_AGENT-1.1.0-x86_64.AppImage doctor`
runs on a machine with no Python at all. ~91 MB, because a full CPython and its
stdlib are inside.

It is also built to degrade instead of fail. The interpreter payload is chosen
by falling back, and `OMERTA_APPIMAGE_PY` forces a choice:

| Strategy | Result | Needs |
|---|---|---|
| `standalone` (default) | ~91 MB, real relocatable CPython 3.12 + pip-installed deps | network at **build** time |
| `pyinstaller` | ~26 MB, PyInstaller bundle with its own libpython | `pip install pyinstaller` |
| `host` | ~1.8 MB, thin — runs against the target's `python3` | nothing |

`appimagetool` is acquired the same way: from `PATH`, else downloaded, else
downloaded and `--appimage-extract`ed for hosts without FUSE. If none of that
works it emits a self-extracting `OMERTA_AGENT-<ver>-<arch>.run` instead — the
same contents, unpacked to a cache dir on first run — so you always end up with
one runnable file. Every path above was built and executed; the script
smoke-tests what it produced (`AppRun --version`) and refuses to report success
on a bundle that does not start.

Two things worth knowing:

- On a host without FUSE the **AppImage runtime itself** prints
  `Error: No suitable fusermount binary found on the $PATH` and then extracts
  and runs anyway. That message is the runtime's, not OMERTA's, and the program
  works. `export APPIMAGE_EXTRACT_AND_RUN=1` silences it.
- Writable state never goes inside the bundle (it is read-only). `AppRun` sets
  `OMERTA_DATA_DIR` to `${XDG_DATA_HOME:-~/.local/share}/omerta-agent`; override
  it to relocate memory, logs and backups.
