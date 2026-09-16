# Firmware / Bootloader / ROM workflow notes

`tools/firmware.py` gives the agent structured access to your cross-compile
and flashing workflows instead of freeform shell guessing:

- `cross_compile(source, target_arch, output)` — arch is one of
  `armv7l`, `aarch64`, `armv7l-android`, `aarch64-android` (the Android
  ones route through NDK triples — make sure `ANDROID_NDK_HOME` is set).
- `autoreconf_build(project_dir, host_triple)` — the standard
  `./autogen.sh --host=... && make && make install` sequence used by
  libimobiledevice-family builds (matches your `ios-tooling-builder` /
  `ios-pentest-toolkit-mint` pattern).
- `check_elf(binary_path)` — read-only, always AUTO tier, quick arch/ABI
  sanity check after a cross-compile.
- `flash_partition(image, partition)` — always CONFIRM tier, no exceptions,
  even if you widen other allowlists. This is the one command class where
  "no limits" is the wrong instinct.

## Recommended local model for firmware/low-level work

Qwen2.5-Coder handles C/assembly/build-system reasoning well and is small
enough to run on a phone at Q4. For heavier ARM/bootloader-specific
reasoning when you have signal, let the router escalate to Claude — it's
meaningfully stronger on obscure toolchain errors and datasheet-adjacent
reasoning than any model that fits on-device.

## Extending the toolchain map

Add new targets directly in `tools/firmware.py`:

```python
CROSS_TOOLCHAINS["riscv64"] = "riscv64-linux-gnu"
```

## Bootloader-toolkit / RootForge integration

If you want OMERTA AGENT driving `omerta-bootloader-toolkit` or
`omerta-rootforge-buildv3` directly, register their build entrypoints as
new tool functions in `tools/devtools.py` following the `gradle()` /
`fastboot()` pattern — same tiering, same logging, same confirmation flow,
so the agent can drive multi-chipset builds without needing new plumbing
in `core/agent.py`.
