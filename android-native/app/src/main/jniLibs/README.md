# Bundled native binaries

## libbusybox.so — BusyBox 1.37.0, static-PIE, aarch64

Not a library. It is the BusyBox multi-call binary, named `lib*.so` because
that is the only way an Android app may ship a file it is allowed to execute:
since API 29, SELinux denies `execve()` on anything in the app's writable data
directory, while the package installer's native-library directory is
executable. `android:extractNativeLibs="true"` and `useLegacyPackaging = true`
are both required, or it stays compressed inside the APK and never becomes a
real file on disk.

At runtime `core/toolbox.py` builds a directory of symlinks pointing here, one
per applet, because BusyBox selects its applet from `argv[0]`.

### Provenance

Taken unmodified from Alpine Linux's `busybox-static` package:

    https://dl-cdn.alpinelinux.org/alpine/latest-stable/main/aarch64/busybox-static-1.37.0-r31.apk

    sha256 of the extracted binary: see SOURCES.txt next to this file

### Licence — GPLv2, and what that obliges us to do

BusyBox is licensed **GPL-2.0-only**. Shipping it inside the APK is
distribution, so anyone we give the APK to is entitled to the complete
corresponding source for this binary, from us, for three years.

We satisfy that by pointing at the exact upstream sources rather than by
claiming an exemption:

  * BusyBox 1.37.0 source: https://busybox.net/downloads/busybox-1.37.0.tar.bz2
  * Alpine's build recipe and patches (the configuration this binary was built
    with): https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/main/busybox

The rest of OMERTA is a separate work that merely invokes these binaries over
a normal process boundary, so it is not itself derived from BusyBox. Replacing
`libbusybox.so` with your own build is supported and expected: drop in any
static aarch64 BusyBox and `toolbox.py` will read its applet list from the
binary rather than assuming ours.
