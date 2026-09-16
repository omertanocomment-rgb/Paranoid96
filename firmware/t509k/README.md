# OMERTA AI — TCL T509K device tree (starter)

**Target:** TCL T509K · MediaTek MT6765 / Helio G36 family · ARM64 · Android 14 / AOSP-family baseline.

This is a **STARTER** tree. It intentionally contains no guessed hardware
values. A guessed device tree causes boot loops and dead hardware — the
production tree is reconstructed from the device's own stock firmware and
matching kernel, following the evidence-first workflow below.

## Layout

```
firmware/t509k/
├── device/tcl/t509k/     # copy into your AOSP source root as device/tcl/t509k/
│   ├── AndroidProducts.mk
│   ├── BoardConfig.mk
│   ├── device.mk
│   ├── omerta_t509k.mk
│   └── proprietary-files.txt
├── dt/t509k.dts          # discovery-only DTS skeleton
├── scripts/
│   ├── build-t509k.sh            # lunch + mka (after a ROM base is selected)
│   └── collect-t509k-evidence.sh # pull stock evidence over adb
├── docs/                 # hardware / firmware / kernel knowledge base
└── OMERTA.md             # device constitution — NO GUESSING
```

`device/tcl/t509k/` uses standard AOSP paths so you can drop it straight into
an Android source tree.

## The only correct next step

Do **not** fill in DTS nodes by guessing. Collect evidence first:

```bash
adb devices
./scripts/collect-t509k-evidence.sh ~/t509k-evidence
```

Then let OMERTA analyse it (read-only, Level 0):

```
analyze_dtb <stock.dtb>        # decode a stock DTB → model/soc/cpu/…
board_report ~/t509k-evidence  # getprop + dmesg + partitions + dtb → BOARD REPORT
```

Every field comes back tagged CONFIRMED / LIKELY / INFERRED / **UNKNOWN**.
UNKNOWN is a valid result — OMERTA will say *"UNKNOWN — evidence required"*
rather than invent a value.

## Bring-up order

board identity → SoC → CPU → memory → clocks → PMIC → regulators → pinctrl →
storage → boot → USB → display → touchscreen → audio → Wi-Fi → Bluetooth →
sensors → cameras → battery → charging → thermal → modem.

Change **one** subsystem at a time; rebuild and re-test between changes.

## Safety

- Preserve untouched stock images in a separate backup dir; never modify the
  only copy.
- Never flash an image whose target partition and compatibility you have not
  positively identified. Flashing is a Level-4 (destructive) action and always
  requires explicit approval through the agent's gate.

Full workflow and rationale: the `firmware-bringup` skill and `OMERTA.md`.
