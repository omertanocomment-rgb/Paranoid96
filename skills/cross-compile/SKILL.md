---
name: cross-compile
description: Cross-compiling C/C++ for armv7l/aarch64, Android NDK, autotools projects
triggers: [cross-compile, armv7l, aarch64, ndk, toolchain, autogen, configure, libimobiledevice, static build, readelf, triple]
---

# Cross-compilation

## Toolchain triples

| target          | triple                   |
|-----------------|--------------------------|
| armv7l glibc    | arm-linux-gnueabihf      |
| aarch64 glibc   | aarch64-linux-gnu        |
| armv7 Android   | armv7a-linux-androideabi |
| aarch64 Android | aarch64-linux-android    |

Android targets need `$ANDROID_NDK_HOME` and the API level baked into the
compiler name, e.g. `aarch64-linux-android24-clang`.

## Autotools cross-build (libimobiledevice family)

```
./autogen.sh --host=aarch64-linux-gnu --prefix=$(pwd)/build-aarch64 --without-cython
make -j$(nproc)
make install
```
Set `PKG_CONFIG_PATH` to the cross prefix, or configure silently picks up host
libraries and produces a binary that won't run on target.

## Always verify the output

`file ./binary && readelf -h ./binary` — confirm Machine says `ARM`/`AArch64`,
not `x86-64`. A "successful" build that produced a host binary is the most
common silent failure in cross-compilation.

## Static linking

To drop a binary on a device with no matching libs: `LDFLAGS="-static"`, then
confirm with `ldd ./binary` (should report "not a dynamic executable").
