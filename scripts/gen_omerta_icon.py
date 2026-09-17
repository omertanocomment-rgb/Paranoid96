#!/usr/bin/env python3
"""
Generate the OMERTA launcher icon: a blackletter O on black.

A black glyph on a black field is invisible, so the O is filled near-black and
given a crisp accent edge plus a soft outer glow. It reads as a black letter —
it is darker than the background it sits on — while still being legible at
48px on a launcher. Set --solid to fill the glyph with the accent colour
instead, if you'd rather have a red O.

Writes:
  assets/icon_*.png, icon.png, icon.ico   (desktop / web / favicon)
  android-native/.../mipmap-*/ic_launcher.png
  android-native/.../mipmap-*/ic_launcher_foreground.png  (adaptive layer)

The foreground layer keeps to Android's safe zone: an adaptive icon may be
masked to a circle, squircle or squircle-with-corners depending on the
launcher, and only the middle ~66% is guaranteed to survive.
"""
import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
RES = ROOT / "android-native/app/src/main/res"
WOFF2 = ASSETS / "unifraktur-maguntia.woff2"
TTF_CACHE = ASSETS / ".unifraktur-maguntia.ttf"

BG = (10, 5, 6, 255)          # --bg
GLYPH = (8, 4, 5, 255)        # a touch darker than the field: a black O
ACCENT = (255, 45, 60, 255)   # --accent-bright
ACCENT_DIM = (122, 18, 25, 255)

# Android density buckets -> launcher icon size in px
MIPMAPS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def ttf():
    """UnifrakturMaguntia as a TTF Pillow can rasterise.

    The repo ships woff2 because that is what the browser wants; Pillow cannot
    read it, so it is converted once and cached beside it.
    """
    if TTF_CACHE.exists():
        return str(TTF_CACHE)
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("need fonttools to convert the font: pip install fonttools brotli")
    f = TTFont(str(WOFF2))
    f.flavor = None
    f.save(str(TTF_CACHE))
    return str(TTF_CACHE)


def _fit_font(target_px, stroke_ratio):
    """Largest point size whose STROKED glyph fits in target_px.

    Measuring the unstroked bbox and then adding a stroke is how an icon ends
    up clipped at the edges — the stroke grows the drawn area after you have
    already decided it fits.
    """
    best = None
    for pt in range(int(target_px * 2), 8, -2):
        f = ImageFont.truetype(ttf(), pt)
        l, t, r, b = f.getbbox("O")
        grow = max(1, int(pt * stroke_ratio)) * 2
        if (r - l) + grow <= target_px and (b - t) + grow <= target_px:
            best = f
            break
    return best or ImageFont.truetype(ttf(), max(8, int(target_px * .5)))


def draw_icon(size, solid=False, inset=0.0, ring=True):
    """Render at 4x and downsample — the glyph has fine strokes that alias
    badly if drawn straight at 48px."""
    ss = 4
    n = size * ss
    img = Image.new("RGBA", (n, n), BG)

    # a faint vignette so the field is not a flat slab
    vign = Image.new("L", (n, n), 0)
    ImageDraw.Draw(vign).ellipse((-n * .1, -n * .35, n * 1.1, n * 1.1), fill=70)
    img = Image.composite(
        Image.new("RGBA", (n, n), (26, 10, 13, 255)), img,
        vign.filter(ImageFilter.GaussianBlur(n * .12)))
    d = ImageDraw.Draw(img)

    # A thin ring turns an ornate letter into a seal. It also gives the eye an
    # edge to read at 48px, where the blackletter O alone is a squiggle.
    pad = n * (inset if inset else 0.10)
    if ring and not inset:
        w = max(1, int(n * .018))
        d.ellipse((pad, pad, n - pad, n - pad), outline=ACCENT_DIM, width=w)
        d.ellipse((pad + w * 2.2, pad + w * 2.2, n - pad - w * 2.2,
                   n - pad - w * 2.2), outline=ACCENT, width=max(1, int(w * .55)))
        glyph_box = n - (pad + w * 4) * 2
    else:
        glyph_box = n - pad * 2

    stroke_ratio = 0.055
    font = _fit_font(glyph_box * .82, stroke_ratio)
    stroke = max(1, int(font.size * stroke_ratio))
    l, t, r, b = font.getbbox("O")
    x = (n - (r - l)) / 2 - l
    y = (n - (b - t)) / 2 - t

    # outer glow, so a dark glyph still separates from a dark field
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, y), "O", font=font,
                              fill=(ACCENT[0], ACCENT[1], ACCENT[2], 190),
                              stroke_width=stroke)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(n * .02)))

    d.text((x, y), "O", font=font,
           fill=ACCENT if solid else GLYPH,
           stroke_width=stroke,
           stroke_fill=ACCENT_DIM if solid else ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solid", action="store_true",
                    help="fill the O with the accent colour instead of black")
    args = ap.parse_args()

    ASSETS.mkdir(exist_ok=True)
    for s in PNG_SIZES:
        draw_icon(s, solid=args.solid).save(ASSETS / f"icon_{s}.png")
    draw_icon(512, solid=args.solid).save(ASSETS / "icon.png")
    draw_icon(256, solid=args.solid).save(
        ASSETS / "icon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    draw_icon(32, solid=args.solid).save(
        ASSETS / "favicon.ico", format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32)])

    for bucket, px in MIPMAPS.items():
        out = RES / f"mipmap-{bucket}"
        out.mkdir(parents=True, exist_ok=True)
        draw_icon(px, solid=args.solid).save(out / "ic_launcher.png")
        draw_icon(px, solid=args.solid).save(out / "ic_launcher_round.png")
        # adaptive foreground: same glyph, inset into the safe zone, on nothing
        fg = draw_icon(px * 2, solid=args.solid, inset=0.22)
        transparent = Image.new("RGBA", fg.size, (0, 0, 0, 0))
        # keep only what differs from the flat background => the glyph + glow
        flat = Image.new("RGBA", fg.size, BG)
        mask = Image.new("L", fg.size, 0)
        fp, bp, mp = fg.load(), flat.load(), mask.load()
        for yy in range(fg.size[1]):
            for xx in range(fg.size[0]):
                dr = abs(fp[xx, yy][0] - bp[xx, yy][0])
                dg = abs(fp[xx, yy][1] - bp[xx, yy][1])
                db = abs(fp[xx, yy][2] - bp[xx, yy][2])
                mp[xx, yy] = min(255, (dr + dg + db) * 3)
        transparent.paste(fg, (0, 0), mask)
        transparent.save(out / "ic_launcher_foreground.png")

    (RES / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '</adaptive-icon>\n')

    print(f"icons written ({'solid red O' if args.solid else 'black O on black'})")
    print(f"  assets/           {len(PNG_SIZES)} png + ico + favicon")
    print(f"  mipmap-*/         {len(MIPMAPS)} densities, launcher + round + adaptive")


if __name__ == "__main__":
    main()
