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

BG = (7, 3, 4)          # near-black, matches the app's --bg
DRED = (150, 16, 24)    # dark red midtone
HI = (214, 44, 52)      # highlight

MIPMAPS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

# The plate does not fill its own frame, so a little crop tightens the mark
# before it is scaled down. Measured from the source, not guessed.
CROP = 0.035


def square(im):
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def render(size, contrast=1.35, invert=False):
    """The artwork, in the app's palette, at `size` px."""
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
    g = ImageEnhance.Contrast(g).enhance(contrast)
    out = ImageOps.colorize(g, BG, HI, mid=DRED).convert("RGBA")

    # Render from the full-resolution source every time and downsample once —
    # resizing an already-resized image compounds the softening.
    return out.resize((size, size), Image.LANCZOS)


def adaptive_foreground(px, safe=0.72):
    """The plate scaled into Android's safe zone, on transparency."""
    n = px * 2                       # 108dp canvas, rendered generously
    inner = int(n * safe)
    art = render(inner)

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
    args = ap.parse_args()

    ASSETS.mkdir(exist_ok=True)
    for s in PNG_SIZES:
        render(s, args.contrast, args.invert).save(ASSETS / f"icon_{s}.png")
    render(512, args.contrast, args.invert).save(ASSETS / "icon.png")
    render(256, args.contrast, args.invert).save(
        ASSETS / "icon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    render(64, args.contrast, args.invert).save(
        ASSETS / "favicon.ico", format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])

    for bucket, px in MIPMAPS.items():
        out = RES / f"mipmap-{bucket}"
        out.mkdir(parents=True, exist_ok=True)
        icon = render(px, args.contrast, args.invert)
        icon.save(out / "ic_launcher.png")
        icon.save(out / "ic_launcher_round.png")
        adaptive_foreground(px).save(out / "ic_launcher_foreground.png")

    (RES / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '</adaptive-icon>\n')

    print(f"icons written from {SOURCE.name}"
          f"{' (inverted)' if args.invert else ''}")
    print(f"  assets/     {len(PNG_SIZES)} png + icon.ico + favicon.ico")
    print(f"  mipmap-*/   {len(MIPMAPS)} densities, launcher + round + adaptive")


if __name__ == "__main__":
    main()
