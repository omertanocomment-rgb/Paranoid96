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

## libllamaserver.so — llama.cpp server, aarch64 Android

The on-device inference engine. This is what lets OMERTA answer a question
with no API key, no network and no second machine: it serves a GGUF model over
loopback, and `core/localai.py` starts and stops it.

Packaged as `lib*.so` for the same reason as BusyBox — it is the only
directory an Android app may execute from. Built against the Android NDK, so
it links `/system/bin/linker64` and only `libc`/`libm`/`libdl`; the C++
runtime is static, so there is nothing else to ship.

### Provenance

Built from upstream llama.cpp, unmodified:

    https://github.com/ggml-org/llama.cpp
    commit ebbb185227c31f1652f1445e2623563d2f67fe5a

    NDK 26.3.11579264, ANDROID_ABI=arm64-v8a, ANDROID_PLATFORM=android-28
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF
    -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=ON
    then llvm-strip --strip-all

### Licence

llama.cpp is **MIT**. It permits redistribution in binary form, including
inside a closed application, provided the copyright notice and permission
notice are preserved — see LICENSE-llama.cpp.txt next to this file.

Unlike the GPLv2 BusyBox binary, this imposes no obligation to offer source,
though the upstream commit is recorded above regardless.

Model weights are NOT bundled and are not covered by this licence. A GGUF file
carries whatever licence its creator chose, and that is between you and them.

## The CPython 3.13 runtime

A real `python3` for the terminal. Android's own userland has no interpreter,
and the one Chaquopy embeds runs inside the app's process rather than as a
program the shell can start.

These files form one component and are listed here as a group rather than
individually:

| File(s) | What |
|---|---|
| `libpython3bin.so` | the `python3` executable |
| `libpython3.13.so` | the interpreter itself |
| `*.cpython-313-aarch64-linux-android.so` | 68 standard-library extension modules |
| `libssl_py313.so`, `libcrypto_py313.so`, `libsqlite3_py313.so` | OpenSSL and SQLite for the above |

The pure-Python standard library is NOT here — it is ordinary text and ships in
the payload as `python-stdlib/`, laid out at runtime by `core/toolbox.py`. Only
the parts Android refuses to load from app storage live in this directory.

### Why three libraries are renamed

Chaquopy already ships `libssl_python.so`, `libcrypto_python.so` and
`libsqlite3_python.so`, built for **its** Python 3.11. Two different builds
cannot share one filename in `lib/arm64-v8a`, and letting one silently win
would be a guess with an obscure failure mode — imports breaking at runtime
rather than the build failing. Ours carry a `_py313` suffix, their SONAMEs were
rewritten to match, and every dependant was repointed with `patchelf`. The
audit gate checks that nothing still asks for the original names.

### Provenance

    https://github.com/python/cpython, branch 3.13
    built with Android/android.py against NDK 26.3.11579264,
    ANDROID_ABI=arm64-v8a, then llvm-strip --strip-all

### Licence

CPython is distributed under the **PSF License Agreement**, which permits
redistribution in source or binary form provided the copyright notice is
retained — see LICENSE-cpython.txt next to this file. It imposes no source
obligation. The bundled OpenSSL is **Apache-2.0** and SQLite is **public
domain**.
