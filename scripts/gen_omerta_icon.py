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

# The house style, and the ONE thing a different app may change.
#
# Standing rule from the owner: the plate, the layout, the type and the
# palette structure are the official identity and do not get redesigned per
# app. A sibling app takes the same mark and changes its TINT -- nothing else.
# So the ramps live here as a table rather than as two hard-coded constants,
# and adding an app is adding a row.
#
# Each entry is (midtone, highlight) for the colorize ramp. The midtone is the
# plate's metal, the highlight is the lettering and the skull. `black` is
# OMERTA's own and is the artwork as it was drawn: pewter and bone.
#
# Why not simply recolour the whole thing: this is a detailed greyscale
# engraving. Pushing it through a saturated ramp (black -> red -> bright red
# was the first attempt) flattens its midtones, and at 48px the skull stops
# reading as a skull. So every tint here keeps a wide, desaturated midtone and
# only carries colour into the highlight.
BG = (10, 5, 6)         # near-black. Shared by every tint: the plate is black.

TINTS = {
    "black":  ((96, 94, 96),   (226, 223, 216)),   # OMERTA — pewter and bone
    "red":    ((120, 52, 56),  (226, 96, 100)),
    "amber":  ((116, 92, 48),  (232, 176, 84)),
    "green":  ((72, 108, 82),  (150, 224, 172)),
    "cyan":   ((66, 106, 112), (140, 220, 228)),
    "blue":   ((72, 92, 128),  (144, 176, 240)),
    "violet": ((100, 80, 128), (190, 160, 240)),
    "bone":   ((110, 106, 100), (238, 234, 226)),
}
DEFAULT_TINT = "black"

MIPMAPS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

# The plate does not fill its own frame, so a little crop tightens the mark
# before it is scaled down. Measured from the source, not guessed.
CROP = 0.035


def square(im):
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def render(size, contrast=1.35, invert=False, tint=DEFAULT_TINT):
    """The artwork at `size` px in the named tint. Same plate, every time."""
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

    mid, hi = TINTS[tint]
    if small:
        # Lift the midtone toward the highlight as well: colorize maps the
        # midtone, and a dark midtone is exactly what disappears first.
        mid = tuple(int(m + (h - m) * 0.45 * small) for m, h in zip(mid, hi))
    out = ImageOps.colorize(g, BG, hi, mid=mid).convert("RGBA")

    # Render from the full-resolution source every time and downsample once —
    # resizing an already-resized image compounds the softening.
    return out.resize((size, size), Image.LANCZOS)


def adaptive_foreground(px, safe=0.72, contrast=1.35, invert=False,
                        tint=DEFAULT_TINT):
    """The plate scaled into Android's safe zone, on transparency."""
    n = px * 2                       # 108dp canvas, rendered generously
    inner = int(n * safe)
    art = render(inner, contrast, invert, tint)

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
    ap.add_argument("--tint", default=DEFAULT_TINT, choices=sorted(TINTS),
                    help="the ONE thing a sibling app changes. Default "
                         f"{DEFAULT_TINT!r}: the plate as it was drawn.")
    ap.add_argument("--out", default=None,
                    help="write the mipmaps under this res/ directory instead "
                         "of this repo's, for building a sibling app's icons")
    args = ap.parse_args()

    global RES
    if args.out:
        RES = Path(args.out)

    ASSETS.mkdir(exist_ok=True)
    for s in PNG_SIZES:
        render(s, args.contrast, args.invert, args.tint).save(ASSETS / f"icon_{s}.png")
    render(512, args.contrast, args.invert, args.tint).save(ASSETS / "icon.png")
    render(256, args.contrast, args.invert, args.tint).save(
        ASSETS / "icon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    render(64, args.contrast, args.invert, args.tint).save(
        ASSETS / "favicon.ico", format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])

    for bucket, px in MIPMAPS.items():
        out = RES / f"mipmap-{bucket}"
        out.mkdir(parents=True, exist_ok=True)
        icon = render(px, args.contrast, args.invert, args.tint)
        icon.save(out / "ic_launcher.png")
        icon.save(out / "ic_launcher_round.png")
        adaptive_foreground(px, 0.72, args.contrast, args.invert,
                            args.tint).save(out / "ic_launcher_foreground.png")

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
          f"({args.tint})"
          f"{' (inverted)' if args.invert else ''}")
    print(f"  assets/     {len(PNG_SIZES)} png + icon.ico + favicon.ico")
    print(f"  mipmap-*/   {len(MIPMAPS)} densities, launcher + round + adaptive")


if __name__ == "__main__":
    main()
