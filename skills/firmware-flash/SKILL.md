---
name: firmware-flash
description: Bootloader, fastboot, partition flashing and ROM work — the brick-risk procedures
triggers: [fastboot, bootloader, flash, partition, boot.img, recovery, twrp, rom, unlock, magisk, odin, edl, brick, slot]
---

# Flashing firmware

## Before ANY flash — non-negotiable order

1. Identify the device precisely:
   `fastboot getvar product` / `adb shell getprop ro.product.device`
   Flashing a correct image to the wrong variant is the #1 brick cause.
2. Confirm bootloader state: `fastboot getvar unlocked`
3. **Back up every partition you are about to touch** (root required):
   `dd if=/dev/block/by-name/boot of=/sdcard/boot-backup.img`
4. Verify the image: `file boot.img && ls -la boot.img` — a 0-byte file or an
   HTML error page saved as `.img` is common and fatal.
5. Battery above 50%.

## Flash order

- `fastboot flash boot boot.img`
- `fastboot flash recovery recovery.img`
- Never `fastboot flashall -w` unless you intend to wipe userdata — it is on
  the hard-deny list for exactly that reason.
- A/B devices: flash the *active* slot or pass `--slot=all`.

## Soft-brick recovery

- Bootloop → re-flash the stock boot.img for that exact build number.
- No fastboot and no recovery → device-specific low-level mode (Qualcomm EDL
  9008, Samsung Odin, MTK SP Flash Tool). Needs the correct loader/firehose
  for that PID; the wrong one hard-bricks.

## Verify after flashing

`fastboot reboot && adb wait-for-device && adb shell getprop ro.build.fingerprint`

## Rule for this skill

Every command here is destructive. Propose ONE step at a time, wait for
approval, verify the result, then propose the next. Never batch flash
commands into a single approval request.
