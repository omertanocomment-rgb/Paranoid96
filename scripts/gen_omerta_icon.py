#!/usr/bin/env python3
"""
Generate the OMERTA launcher icon: a blackletter O in dark red on black,
wrapped in barbed filigree.

The ornament is an ORIGINAL composition in the chicano-lettering idiom —
tapered S-curved spines with thorns branching off them, mirrored about the
vertical axis with deliberately uneven lengths so it does not read as a radial
badge. It is drawn from primitives, not traced from anyone's artwork.

Below 96px the thin hooks and second-order barbs are dropped: at 48px they
collapse into mud and make the mark less legible, not more ornate. Detail that
does not survive the size it ships at is decoration for the designer, not the
user.

Set --solid to fill the glyph with the accent colour instead of near-black.

Writes:
  assets/icon_*.png, icon.png, icon.ico   (desktop / web / favicon)
  android-native/.../mipmap-*/ic_launcher.png
  android-native/.../mipmap-*/ic_launcher_foreground.png  (adaptive layer)

The foreground layer keeps to Android's safe zone: an adaptive icon may be
masked to a circle, squircle or squircle-with-corners depending on the
launcher, and only the middle ~66% is guaranteed to survive.
"""
import argparse
import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
RES = ROOT / "android-native/app/src/main/res"
WOFF2 = ASSETS / "unifraktur-maguntia.woff2"
TTF_CACHE = ASSETS / ".unifraktur-maguntia.ttf"

BG = (7, 3, 4, 255)           # near-black field
GLYPH = (5, 2, 3, 255)        # the O itself: black
DRED = (112, 10, 17, 255)     # dark red — the letter's edge and the filigree
DRED_HI = (156, 19, 27, 255)
DRED_LO = (62, 5, 9, 255)
ACCENT = DRED_HI              # used by --solid

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


def cub(p0,p1,p2,p3,t):
    m=1-t
    return (m**3*p0[0]+3*m*m*t*p1[0]+3*m*t*t*p2[0]+t**3*p3[0],
            m**3*p0[1]+3*m*m*t*p1[1]+3*m*t*t*p2[1]+t**3*p3[1])

def spine(d,pts,w0,w1,fill,steps=140,power=0.7):
    """A tapered S-curve. Returns sample points so barbs can be hung off it."""
    p0,p1,p2,p3=pts
    L,R,mid=[],[],[]
    for i in range(steps+1):
        t=i/steps
        x,y=cub(p0,p1,p2,p3,t)
        nx,ny=cub(p0,p1,p2,p3,min(1.0,t+0.004))
        dx,dy=nx-x,ny-y; m=math.hypot(dx,dy) or 1
        px,py=-dy/m,dx/m
        w=(w0*((1-t)**power)+w1*t)/2
        L.append((x+px*w,y+py*w)); R.append((x-px*w,y-py*w))
        mid.append(((x,y),(px,py),(dx/m,dy/m),w))
    d.polygon(L+R[::-1],fill=fill)
    return mid

def barb(d,at,tang,norm,length,width,side,fill):
    """A thorn branching off a spine — what makes it read as chicano filigree
    rather than a leaf."""
    x,y=at
    bx,by=x+norm[0]*side*width*0.4, y+norm[1]*side*width*0.4
    cx=bx+tang[0]*length*0.45+norm[0]*side*length*0.35
    cy=by+tang[1]*length*0.45+norm[1]*side*length*0.35
    tx=bx+tang[0]*length*0.15+norm[0]*side*length*1.0
    ty=by+tang[1]*length*0.15+norm[1]*side*length*1.0
    L,R=[],[]
    for i in range(41):
        t=i/40
        px_,py_=cub((bx,by),(cx,cy),(cx,cy),(tx,ty),t)
        nx_,ny_=cub((bx,by),(cx,cy),(cx,cy),(tx,ty),min(1.0,t+0.01))
        dx,dy=nx_-px_,ny_-py_; m=math.hypot(dx,dy) or 1
        ox,oy=-dy/m,dx/m
        w=width*((1-t)**0.8)/2
        L.append((px_+ox*w,py_+oy*w)); R.append((px_-ox*w,py_-oy*w))
    d.polygon(L+R[::-1],fill=fill)

def P(c,u,ang,r):
    a=math.radians(ang); return (c+math.cos(a)*r*u, c+math.sin(a)*r*u)

def build(size=1024, simple=None):
    n=size; c=n/2; u=n/100.0
    if simple is None:
        simple = size < 128
    img=Image.new("RGBA",(n,n),BG)
    orn=Image.new("RGBA",(n,n),(0,0,0,0)); od=ImageDraw.Draw(orn)

    # Each spine: start on the glyph edge, S-curve outward, barbs along it.
    # Mirrored left/right; lengths deliberately uneven so it reads hand-drawn.
    SPINES = [
        # Everything stays inside r=44 so no tip is clipped by the frame, and
        # the diagonals lead so it does not sprawl along one axis.
        (( 55,19), ( 36,28), ( 26,38), ( 18,43), 6.4, [(.38,-1,.26),(.68,1,.20)]),
        ((125,19), (144,28), (154,38), (162,43), 6.4, [(.38, 1,.26),(.68,-1,.20)]),
        ((235,19), (216,28), (206,38), (198,43), 6.4, [(.38,-1,.26),(.68,1,.20)]),
        ((305,19), (324,28), (334,38), (342,43), 6.4, [(.38, 1,.26),(.68,-1,.20)]),
        # verticals carry the composition
        (( 84,18), ( 72,29), ( 96,38), ( 88,45), 5.4, [(.42,-1,.24),(.72,1,.18)]),
        ((276,18), (288,29), (264,38), (272,45), 5.4, [(.42, 1,.24),(.72,-1,.18)]),
        (( 96,18), (108,28), ( 86,36), ( 94,41), 3.8, [(.5, 1,.17)]),
        ((264,18), (252,28), (274,36), (266,41), 3.8, [(.5,-1,.17)]),
        # short side hooks only — the long horizontals were swamping it
        ((  6,18), ( 14,26), (  0,33), (  8,38), 4.2, [(.55, 1,.20)]),
        ((174,18), (166,26), (180,33), (172,38), 4.2, [(.55,-1,.20)]),
        ((186,18), (194,26), (180,33), (188,38), 4.2, [(.55, 1,.20)]),
        ((354,18), (346,26), (360,33), (352,38), 4.2, [(.55,-1,.20)]),
    ]
    spines = SPINES[:6] if simple else SPINES
    for (a0,r0),(a1,r1),(a2,r2),(a3,r3),w,barbs in spines:
        pts=(P(c,u,a0,r0),P(c,u,a1,r1),P(c,u,a2,r2),P(c,u,a3,r3))
        mid=spine(od,pts,w*u,0.3*u,DRED)
        for frac,side,blen in (barbs[:1] if simple else barbs):
            at,norm,tang,ww=mid[int(frac*(len(mid)-1))]
            barb(od,at,tang,norm,blen*34*u,ww*1.45,side,DRED)
        # inner shadow along the spine for depth
        spine(od,pts,w*0.4*u,0.25*u,DRED_LO,power=0.9)

    img.alpha_composite(orn)

    f=None
    for pt in range(int(n*0.95),20,-4):
        ft=ImageFont.truetype(ttf(),pt); l,t,r,b=ft.getbbox("O")
        if (r-l)<=n*0.48 and (b-t)<=n*0.48: f=ft; break
    l,t,r,b=f.getbbox("O")
    x=(n-(r-l))/2-l; y=(n-(b-t))/2-t
    sw=max(2,int(f.size*0.09))

    # heavy slab shadow under the letter, offset — the reference's depth
    sh=Image.new("RGBA",(n,n),(0,0,0,0))
    ImageDraw.Draw(sh).text((x+n*0.012,y+n*0.014),"O",font=f,fill=(0,0,0,235),
                            stroke_width=int(sw*1.3),stroke_fill=(0,0,0,235))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(n*0.006)))

    ImageDraw.Draw(img).text((x,y),"O",font=f,fill=GLYPH,
                             stroke_width=sw,stroke_fill=DRED)
    return img


def draw_icon(size, solid=False, inset=0.0, ring=False):
    """`inset` renders the adaptive-icon foreground, which must sit inside
    Android's safe zone; `ring` is accepted for call compatibility."""
    # render small icons from a simplified mark at 4x, then downsample
    img = build(size * 4 if size < 128 else size)
    if inset:
        # shrink the whole mark into the safe zone, on transparency
        n = img.size[0]
        small = img.resize((int(n * (1 - inset * 2)),) * 2, Image.LANCZOS)
        out = Image.new("RGBA", (n, n), BG)
        off = (n - small.size[0]) // 2
        out.paste(small, (off, off))
        img = out
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    return img


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
