---
name: firmware-bringup
description: Evidence-first Android/AOSP device bring-up — reconstruct a device tree, kernel config and vendor blobs from a real device instead of guessing. Use for device trees, DTB/DTBO, boot/vendor_boot images, partition maps, MT6765/MediaTek and similar SoC bring-up (e.g. the TCL T509K starter tree under firmware/t509k/).
triggers: [device tree, devicetree, dts, dtsi, dtb, dtbo, bringup, bring-up, aosp, rom, lineageos, boot.img, vendor_boot, vbmeta, super.img, defconfig, mt6765, mediatek, helio, t509k, fastboot, partition, avb, kernel, bsp, flash]
---

# Firmware / device bring-up — the OMERTA way

**No guessing.** A fabricated GPIO, regulator, panel timing or partition size
causes boot loops and dead hardware. Every hardware value must trace to
evidence, and every value carries a confidence: **CONFIRMED > LIKELY >
INFERRED > UNKNOWN**. UNKNOWN is a valid answer — say "UNKNOWN — evidence
required" instead of inventing a value.

## Workflow (never skip a stage)

STOCK → EXTRACT → ANALYZE → RECONSTRUCT DT → BUILD → BOOT TEST → COLLECT LOGS →
FIX → REBUILD → RETEST.

1. **Preserve stock.** Keep untouched copies of every stock image
   (boot / vendor_boot / dtbo / vbmeta / vendor / super / recovery) in a
   backup dir. Never modify the only copy.
2. **Collect evidence** over adb (read-only): `getprop`, `/proc/cpuinfo`,
   `/proc/meminfo`, `/proc/partitions`, `/proc/cmdline`,
   `/dev/block/by-name`, `/proc/device-tree/compatible`, `dmesg`,
   `dumpsys battery`, `dumpsys thermalservice`. The
   `firmware/t509k/scripts/collect-t509k-evidence.sh` script does this.
3. **Analyze**, don't assume. Decode the stock DTB (`analyze_dtb` tool, or
   `dtc -I dtb -O dts`), read dmesg for the real panel / touch / camera /
   charger drivers, and read the partition table from the device.
4. **Reconstruct** the device tree from the stock DTB/DTBO + matching kernel
   source, one subsystem at a time.

## Bring-up order

board identity → SoC → CPU → memory → reserved-memory → clocks → PMIC →
regulators → pinctrl → storage → boot → USB → display → touchscreen → audio →
Wi-Fi → Bluetooth → sensors → cameras → battery → charging → thermal → modem.

Change **one** logical subsystem per iteration; rebuild and re-test between
changes so a regression has a single cause.

## Evidence record (use for every hardware value)

    VALUE:        <the value>
    SOURCE:       <stock DTB | dmesg | getprop | kernel | datasheet>
    CONFIDENCE:   CONFIRMED | LIKELY | INFERRED | UNKNOWN
    NOTES:        <how it was obtained>

## Engineering record (use for every change)

    CHANGE / SOURCE / REASON / RISK / EXPECTED RESULT / TEST / ACTUAL RESULT / CONFIDENCE

Leave ACTUAL RESULT = "Pending" until you have boot/log evidence. Never claim
a build succeeded without build output, or a boot succeeded without boot logs.

## Safety levels (map onto the approval gate)

- **L0 read** (inspect / dump / analyze / decompile) — runs freely.
- **L1 build**, **L2 modify source**, **L3 device I/O (adb/fastboot)** — proposed, approved.
- **L4 destructive** (flash / erase / format / repartition) — always proposed with a
  loud warning and requires explicit approval; the hard-deny list still blocks the
  worst (`fastboot flashall -w`, `mkfs` on a raw disk, …). Never flash an image whose
  target partition and compatibility you have not positively identified.

## Boot-failure triage

Collect `dmesg`, `logcat`, `last_kmsg`/pstore/ramoops, `fastboot getvar all`.
Look for: kernel panic, watchdog, init failure, SELinux denial, mount failure,
AVB failure, dtb error, regulator/clock error, panel/touch error, vendor crash.
Then classify → plan → change one thing → rebuild → retest.

## Starter tree

`firmware/t509k/` is a discovery-only TCL T509K (MT6765) skeleton: AOSP
`device/tcl/t509k/` makefiles, a bare `dt/t509k.dts`, the evidence + build
scripts, a hardware/firmware/kernel knowledge base under `docs/`, and
`OMERTA.md` (the device constitution). It builds structure only — the real
DTS is reconstructed from device evidence.
