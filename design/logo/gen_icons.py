#!/usr/bin/env python3
"""
Generate the Omerta app icons from the design tokens — pure standard library (zlib only),
no image dependencies. Produces PNGs and a Windows .ico so every platform's launcher wears
the same OMERTA mark (amber hexagon + "O" on near-black).

  python3 design/logo/gen_icons.py
    → design/logo/omerta-256.png, omerta-64.png, omerta-32.png, omerta-16.png
    → design/logo/omerta.ico   (Windows, PNG-compressed entries)
"""
from __future__ import annotations

import json
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENS = os.path.join(HERE, "..", "omerta-design.json")


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_colors() -> dict:
    with open(TOKENS) as f:
        return json.load(f)["color"]


class Canvas:
    def __init__(self, size: int, bg: tuple[int, int, int]):
        self.n = size
        self.px = bytearray()
        for _ in range(size * size):
            self.px += bytes((bg[0], bg[1], bg[2], 255))

    def _set(self, x: int, y: int, rgb: tuple[int, int, int], a: float):
        if x < 0 or y < 0 or x >= self.n or y >= self.n or a <= 0:
            return
        i = (y * self.n + x) * 4
        a = min(1.0, a)
        for k in range(3):
            self.px[i + k] = int(self.px[i + k] * (1 - a) + rgb[k] * a)

    def stroke_poly(self, pts, rgb, width):
        for j in range(len(pts)):
            x0, y0 = pts[j]
            x1, y1 = pts[(j + 1) % len(pts)]
            self._line(x0, y0, x1, y1, rgb, width)

    def _line(self, x0, y0, x1, y1, rgb, width):
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 3) + 1
        r = width / 2.0
        for s in range(steps + 1):
            t = s / steps
            cx = x0 + (x1 - x0) * t
            cy = y0 + (y1 - y0) * t
            self._disc(cx, cy, r, rgb)

    def _disc(self, cx, cy, r, rgb):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                self._set(x, y, rgb, max(0.0, min(1.0, r - d + 0.5)))

    def ring(self, cx, cy, radius, width, rgb):
        inner = radius - width / 2.0
        outer = radius + width / 2.0
        for y in range(int(cy - outer - 1), int(cy + outer + 2)):
            for x in range(int(cx - outer - 1), int(cx + outer + 2)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                a = min(outer - d + 0.5, d - inner + 0.5, 1.0)
                self._set(x, y, rgb, max(0.0, a))

    def rect(self, x0, y0, x1, y1, rgb):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                self._set(x, y, rgb, 1.0)

    def png(self) -> bytes:
        raw = bytearray()
        for y in range(self.n):
            raw.append(0)
            raw += self.px[y * self.n * 4:(y + 1) * self.n * 4]

        def chunk(typ, data):
            c = struct.pack(">I", len(data)) + typ + data
            return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

        ihdr = struct.pack(">IIBBBBB", self.n, self.n, 8, 6, 0, 0, 0)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
                chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def draw(size: int, colors: dict) -> bytes:
    black = hex_rgb(colors["black"])
    surface = hex_rgb(colors["surface"])
    amber = hex_rgb(colors["amber"])
    c = Canvas(size, black)
    cx = cy = size / 2.0
    # Inner console panel (subtle).
    m = size * 0.08
    c.rect(m, m, size - m, size - m, surface)
    # Hexagon frame, pointy-top, in amber.
    R = size * 0.40
    hexpts = [(cx + R * math.sin(math.radians(a)), cy - R * math.cos(math.radians(a)))
              for a in range(0, 360, 60)]
    c.stroke_poly(hexpts, amber, max(2.0, size * 0.035))
    # The "O" ring at the centre.
    c.ring(cx, cy, size * 0.20, max(2.0, size * 0.055), amber)
    return c.png()


def build_ico(png_by_size: dict[int, bytes]) -> bytes:
    sizes = sorted(png_by_size)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    entries = b""
    offset = 6 + 16 * len(sizes)
    blobs = b""
    for s in sizes:
        data = png_by_size[s]
        w = h = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    return header + entries + blobs


def main():
    colors = load_colors()
    png_by_size = {}
    for size in (256, 64, 32, 16):
        data = draw(size, colors)
        png_by_size[size] = data
        with open(os.path.join(HERE, f"omerta-{size}.png"), "wb") as f:
            f.write(data)
    with open(os.path.join(HERE, "omerta.ico"), "wb") as f:
        f.write(build_ico(png_by_size))
    print("icons: omerta-{256,64,32,16}.png + omerta.ico")


if __name__ == "__main__":
    main()
