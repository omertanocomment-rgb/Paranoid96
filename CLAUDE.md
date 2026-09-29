# Instructions for Claude in this repository

## Every release ships three executables

Standing rule, set by the owner. Any build, any version, no exceptions:

| Format | Platform | Built by |
|--------|----------|----------|
| `.apk` | Android, **arm64-v8a AND armeabi-v7a in one file** | `cd android-native && gradle assembleRelease -PomertaAbi=arm64-v8a,armeabi-v7a` |
| `.deb` | Debian / Ubuntu | `bash packaging/build-deb.sh` |
| `.exe` | Windows x64 | `bash packaging/build-win.sh` |

Then put all three in one zip with the manual, the guide, the changelog and a
`SHA256SUMS`, and hand that over. `scripts/release.sh` does the whole thing.

Do not ship one and describe the others. Do not ship an APK for a single ABI:
that shipped for eight versions and would not install on a 32-bit phone.

## Do not build a web app

The Android app is Jetpack Compose — real widgets, no WebView, no HTML, no
JavaScript, no HTTP. This was asked for repeatedly and argued against before it
was done; do not reintroduce a WebView on any surface the owner uses directly.
`webui/` remains only for reaching a backend from a LAN browser.

The desktop app still renders through WebKit. That is a known exception the
owner has flagged, not a precedent.

## The audit gate is not optional

`python3 scripts/audit.py` runs the full suite plus eleven structural checks and
refuses to package on a finding. Run it after every phase, fix everything it
reports, then run it again on the same phase until it passes clean. CI does the
same and every build job depends on it.

A fix introduces findings as readily as any other change. The gate has caught
its own author several times — an off-by-one in its arity counter, twice.

## Verify, never assume

This project's own constitution (`OMERTA.md`) binds the agent, and it binds
work on the agent too:

- Check the built artifact, not the source that should have produced it. The
  web UI kept shipping in the APK after being removed from the include list,
  because the staging task was a `Copy` (which only adds) rather than a `Sync`.
- A test that passes on correct code proves nothing on its own. The bridge test
  reintroduces the original bug and fails unless the gate catches it.
- Say what was run and what was not. Nothing here has been tested on a real
  handset; every APK ships on inspection alone, and that limit gets stated
  rather than glossed.

## One version, one source

`pyproject.toml` holds it; everything else derives it. `scripts/sync_version.py`
checks, `scripts/stamp_build.py` writes `core/build_stamp.json` per artifact so
an installed copy can identify itself. Stamp before staging a payload, or the
package carries the previous build's stamp — a desktop build once reported
itself as `channel: android`.

## One request layer

`core/dispatch.py` routes every transport: the HTTP server, the Android app's
in-process bridge, the desktop pipe and the GTK window. The local-only list
lives there once. Two copies is how `/api/attach` came to be local-only on one
server and open on the other.
