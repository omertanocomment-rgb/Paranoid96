# Instructions for Claude in this repository

New to this project? Read `docs/PROJECT.md` — the architecture, every module,
the whole API surface, the approval model, what was decided on purpose, what
has never been verified, and the bugs that shaped the design. It is GENERATED
(`scripts/gen_project_doc.py`) so its tables cannot drift from the code, and
the gate fails if the checked-in copy is stale. `docs/HANDOVER.md` is the
short version. A conversation does not travel between sessions; those files
are what does. These rules outrank both.

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

## Always hand over one block of install code

Standing rule. Whatever is delivered, the reply carries ONE fenced block that
does the whole job end to end — rejoin the parts, verify the checksum, unpack,
install — with nothing to edit and no steps to follow in prose.

Never mix prose into the block: it gets pasted whole, and the explanation runs
as commands. That happened once; every line the owner did not need to run
produced an error. Notes go after the block, under a line saying not to paste
them, or in a separate file.

The block verifies before it installs and refuses on a mismatch, so a truncated
download fails loudly instead of becoming a "parse error" at the installer.

Take checksums from the artifact being shipped, never from an earlier build of
the same version. A rebuild is not byte-identical — gradle timestamps and
signing see to that — so an APK built minutes before has a different hash from
the one inside the zip. Quoting the wrong one makes the block reject a download
that was perfectly good, which reads as a corrupt file and is not. Prefer the
`SHA256SUMS` that ships inside the zip: the block reads it, so nothing has to
be transcribed at all.

## The house identity is fixed; only the tint changes

Standing rule, set by the owner. The OMERTA plate — the black skull, the
barbed wire, the blackletter — is the official identity for this project and
every app that follows it. The mark, the layout, the type and the structure of
the palette do not get redesigned per app.

A sibling app changes exactly one thing: **the tint**.

| | |
|---|---|
| Artwork | `assets/omerta-mark-source.jpg`. Never redrawn, never replaced. |
| Icon set | `python3 scripts/gen_omerta_icon.py --tint NAME [--out <res dir>]` |
| Tints | black (OMERTA's own), red, amber, green, cyan, blue, violet, bone |
| UI palette | `res/values/colors.xml` — four tokens; `ui/Theme.kt` derives the rest |
| Wordmark | UnifrakturMaguntia, bundled under the OFL. The name only. |

The artwork is drawn dark-on-light: a black mark on a pale plate. The tint
colours the PLATE, not the mark, so the skull stays black in every app and the
tile is what tells them apart. That is the whole system — do not invert it,
do not recolour the skull, and do not add a second typeface.

Two things learned the hard way, both of which produced a shipped build:

- **Do not push the artwork through a saturated ramp.** It is a detailed
  greyscale engraving. Black → red → bright red flattened its midtones, and at
  48px — the size a launcher actually draws — the skull stopped reading as a
  skull. Every tint keeps a wide desaturated midtone and carries colour only
  into the highlight, and the generator hardens contrast as the target shrinks.
- **Do not invent a palette in the UI layer.** The Compose rebuild introduced a
  warmer bone-and-ember scheme that existed nowhere else, so the phone quietly
  stopped matching the desktop and the web surface. `Theme.kt` takes its four
  colours from `colors.xml` and derives everything else from them.

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
