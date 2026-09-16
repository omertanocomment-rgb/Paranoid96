#!/usr/bin/env python3
"""Generate every platform icon size from assets/icon.svg."""
import cairosvg, subprocess
from pathlib import Path
from PIL import Image

A = Path(__file__).resolve().parent.parent / "assets"
SVG = A / "icon.svg"

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
for s in PNG_SIZES:
    cairosvg.svg2png(url=str(SVG), write_to=str(A / f"icon_{s}.png"),
                     output_width=s, output_height=s)
Image.open(A / "icon_512.png").save(A / "icon.png")

# Windows .ico (multi-resolution)
Image.open(A / "icon_256.png").save(
    A / "icon.ico", format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# macOS .icns
try:
    ico = Image.open(A / "icon_1024.png")
    ico.save(A / "icon.icns", format="ICNS")
except Exception as e:
    print(f"[warn] icns via PIL failed ({e}); on macOS use: iconutil -c icns icon.iconset")

# Android adaptive-icon foreground layers (transparent bg, letter only)
fg_svg = SVG.read_text()
fg_svg = fg_svg.replace('<rect width="512" height="512" rx="106" fill="url(#bg)"/>', '')
fg_svg = fg_svg.replace(
    '<rect x="10" y="10" width="492" height="492" rx="98" fill="none"\n'
    '        stroke="#3d2d10" stroke-width="3"/>', '')
(A / "icon_mono.svg").write_text(fg_svg)
for s in [48, 72, 96, 144, 192, 512]:
    cairosvg.svg2png(bytestring=fg_svg.encode(),
                     write_to=str(A / f"android_fg_{s}.png"),
                     output_width=s, output_height=s)

# favicon for the web UI
Image.open(A / "icon_64.png").save(A / "favicon.ico", format="ICO",
                                   sizes=[(16, 16), (32, 32), (48, 48)])
print("icons generated:", sorted(p.name for p in A.iterdir()))
