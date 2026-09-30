#!/usr/bin/env python3
"""
Generate the OMERTA icon set from the supplied artwork.

The source is `assets/omerta-mark-source.jpg` — the Omerta plate. It is kept in
the repo so this script is reproducible: an icon generator that depends on a
file living somewhere on one machine is a generator that breaks the first time
anyone else runs it.

Processing is deliberately light. The artwork already has its own shading and
depth; the job here is to push it toward the app's palette and make it survive
being shrunk to 48px, not to redraw it. So: grayscale, autocontrast, a gentle
contrast lift, then a black -> dark red -> bright red colour ramp. Polarity is
kept (not inverted), which is what makes the plate read red with the lettering
dark against it.

Writes:
  assets/icon_*.png, icon.png, icon.ico, favicon.ico   (desktop / web)
  android-native/.../mipmap-*/ic_launcher.png          (legacy launcher)
  android-native/.../mipmap-*/ic_launcher_round.png
  android-native/.../mipmap-*/ic_launcher_foreground.png  (adaptive layer)

The adaptive foreground keeps to Android's safe zone: a launcher may mask an
adaptive icon to a circle, a squircle or a rounded square, and only the middle
~66% is guaranteed to survive. The plate is circular, so it is scaled to sit
inside that zone rather than being cropped by it.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
RES = ROOT / "android-native/app/src/main/res"
SOURCE = ASSETS / "omerta-mark-source.jpg"

# Two ramps. The DEFAULT is the artwork as it was drawn: a black plate in
# pewter and bone. The red ramp was mine, and it was wrong -- pushing a
# detailed greyscale engraving through black -> red -> bright red flattens it,
# and at 48px the skull stopped reading as a skull at all. The artwork already
# has its own shading; the job is to keep it legible when shrunk, not to
# recolour it.
BG = (10, 5, 6)         # near-black, the app's background
MONO_MID = (96, 94, 96)  # pewter -- the plate's own metal
MONO_HI = (226, 223, 216)  # bone -- the lettering and the skull
RED_MID = (150, 16, 24)
RED_HI = (214, 44, 52)

MIPMAPS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

# The plate does not fill its own frame, so a little crop tightens the mark
# before it is scaled down. Measured from the source, not guessed.
CROP = 0.035


def square(im):
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def render(size, contrast=1.35, invert=False, red=False):
    """The artwork at `size` px: black and bone by default, red on request."""
    if not SOURCE.exists():
        sys.exit(f"missing artwork: {SOURCE}")
    im = square(Image.open(SOURCE).convert("RGB"))
    if CROP:
        n = im.size[0]
        pad = int(n * CROP)
        im = im.crop((pad, pad, n - pad, n - pad))

    g = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1)
    if invert:
        g = ImageOps.invert(g)

    # A launcher icon is 48px. This artwork is a detailed engraving, and at
    # that size its midtones collapse into one dark smear — the skull stops
    # reading as a skull, which is the whole point of it. So the smaller the
    # target, the harder the contrast and the further the midtone is lifted:
    # detail that cannot survive the downsample is traded away deliberately in
    # favour of the silhouette that can.
    small = max(0.0, min(1.0, (128 - size) / 96.0))
    g = ImageEnhance.Contrast(g).enhance(contrast + 0.75 * small)
    if small:
        g = ImageEnhance.Brightness(g).enhance(1.0 + 0.30 * small)

    mid, hi = (RED_MID, RED_HI) if red else (MONO_MID, MONO_HI)
    if small and not red:
        # Lift the pewter toward bone as well: colorize maps the midtone, and
        # a dark midtone is exactly what disappears first.
        mid = tuple(int(m + (h - m) * 0.45 * small) for m, h in zip(mid, hi))
    out = ImageOps.colorize(g, BG, hi, mid=mid).convert("RGBA")

    # Render from the full-resolution source every time and downsample once —
    # resizing an already-resized image compounds the softening.
    return out.resize((size, size), Image.LANCZOS)


def adaptive_foreground(px, safe=0.72, contrast=1.35, invert=False, red=False):
    """The plate scaled into Android's safe zone, on transparency."""
    n = px * 2                       # 108dp canvas, rendered generously
    inner = int(n * safe)
    art = render(inner, contrast, invert, red)

    # keep only the plate: the source's corners are background, and carrying
    # them into the foreground layer would draw a square behind the mask
    mask = Image.new("L", (inner, inner), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, inner - 1, inner - 1), fill=255)

    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    off = (n - inner) // 2
    out.paste(art, (off, off), mask)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--invert", action="store_true",
                    help="flip polarity (dark plate, light lettering)")
    ap.add_argument("--contrast", type=float, default=1.35)
    ap.add_argument("--red", action="store_true",
                    help="the old red ramp; the default is the black plate "
                         "as the artwork was drawn")
    args = ap.parse_args()

    ASSETS.mkdir(exist_ok=True)
    for s in PNG_SIZES:
        render(s, args.contrast, args.invert, args.red).save(ASSETS / f"icon_{s}.png")
    render(512, args.contrast, args.invert, args.red).save(ASSETS / "icon.png")
    render(256, args.contrast, args.invert, args.red).save(
        ASSETS / "icon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    render(64, args.contrast, args.invert, args.red).save(
        ASSETS / "favicon.ico", format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])

    for bucket, px in MIPMAPS.items():
        out = RES / f"mipmap-{bucket}"
        out.mkdir(parents=True, exist_ok=True)
        icon = render(px, args.contrast, args.invert, args.red)
        icon.save(out / "ic_launcher.png")
        icon.save(out / "ic_launcher_round.png")
        adaptive_foreground(px, 0.72, args.contrast, args.invert,
                            args.red).save(out / "ic_launcher_foreground.png")

    (RES / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '</adaptive-icon>\n')

    print(f"icons written from {SOURCE.name} "
          f"({'red' if args.red else 'black plate'})"
          f"{' (inverted)' if args.invert else ''}")
    print(f"  assets/     {len(PNG_SIZES)} png + icon.ico + favicon.ico")
    print(f"  mipmap-*/   {len(MIPMAPS)} densities, launcher + round + adaptive")


if __name__ == "__main__":
    main()
