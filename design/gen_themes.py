#!/usr/bin/env python3
"""
OMERTA theme generator — one source of truth for every app's look.

Reads design/omerta-design.json and emits per-platform theme files into
design/generated/, plus verifies that the live, hand-maintained theme files across the
repo (Android Color.kt, the desktop palette) still match the tokens. This is how
"all themes are based off this" is *enforced*, not just documented.

  python3 design/gen_themes.py            # (re)generate design/generated/*
  python3 design/gen_themes.py --check    # generate + verify parity; non-zero on drift (CI)

Generated:
  design/generated/omerta.css        CSS custom properties (web / landing pages)
  design/generated/palette.py        Python palette (desktop / tools)
  design/generated/OmertaTokens.kt   Kotlin reference object
  design/generated/omerta.env        shell/env KEY=VALUE (scripts, CI, native builds)
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
TOKENS = os.path.join(HERE, "omerta-design.json")
GEN = os.path.join(HERE, "generated")


def load() -> dict:
    with open(TOKENS) as f:
        return json.load(f)


def _camel_to_kebab(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", s).lower()


def _camel_to_upper(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).upper()


def gen_css(d: dict) -> str:
    c = d["color"]
    lines = [f"/* {d['name']} v{d['version']} — generated from omerta-design.json; do not edit. */",
             ":root {"]
    for k, v in c.items():
        lines.append(f"  --omerta-{_camel_to_kebab(k)}: {v};")
    t = d["typography"]
    lines.append(f'  --omerta-font: "{t["family"]}", {t["fallback"]};')
    for k, v in d["radius"].items():
        lines.append(f"  --omerta-radius-{k}: {v}px;")
    for k, v in d["spacing"].items():
        lines.append(f"  --omerta-space-{k}: {v}px;")
    lines.append("}")
    lines.append("body { background: var(--omerta-black); color: var(--omerta-text-primary);"
                 " font-family: var(--omerta-font); }")
    return "\n".join(lines) + "\n"


def gen_python(d: dict) -> str:
    c = d["color"]
    out = [f'"""{d["name"]} v{d["version"]} — generated from omerta-design.json; do not edit."""', ""]
    for k, v in c.items():
        out.append(f'{_camel_to_upper(k)} = "{v}"')
    out.append(f'FONT = "{d["typography"]["family"]}"')
    out.append(f'FONT_FALLBACK = "{d["typography"]["fallback"]}"')
    out.append(f'BRAND = "{d["brand"]["name"]}"')
    out.append(f'SLOGAN = "{d["brand"].get("slogan", "")}"')
    out.append(f'TAGLINE = "{d["brand"].get("tagline", "")}"')
    return "\n".join(out) + "\n"


def gen_kotlin(d: dict) -> str:
    c = d["color"]
    out = ["// " + f'{d["name"]} v{d["version"]} — generated from omerta-design.json; do not edit.',
           "package ai.omerta.design", "", "/** Canonical OMERTA color tokens (ARGB longs). */",
           "object OmertaTokens {"]
    for k, v in c.items():
        out.append(f'    const val {k} = 0xFF{v.lstrip("#").upper()}')
    out.append("}")
    return "\n".join(out) + "\n"


def gen_env(d: dict) -> str:
    c = d["color"]
    out = [f"# {d['name']} v{d['version']} — generated; do not edit."]
    for k, v in c.items():
        out.append(f"OMERTA_{_camel_to_upper(k)}={v}")
    out.append(f'OMERTA_FONT="{d["typography"]["family"]}"')
    out.append(f'OMERTA_BRAND="{d["brand"]["name"]}"')
    out.append(f'OMERTA_SLOGAN="{d["brand"].get("slogan", "")}"')
    out.append(f'OMERTA_TAGLINE="{d["brand"].get("tagline", "")}"')
    return "\n".join(out) + "\n"


GENERATORS = {
    "omerta.css": gen_css,
    "palette.py": gen_python,
    "OmertaTokens.kt": gen_kotlin,
    "omerta.env": gen_env,
}


def write_all(d: dict) -> None:
    os.makedirs(GEN, exist_ok=True)
    for name, fn in GENERATORS.items():
        with open(os.path.join(GEN, name), "w") as f:
            f.write(fn(d))


def hexes(d: dict) -> set[str]:
    return {v.lstrip("#").upper() for v in d["color"].values()}


def check_live_files(d: dict) -> list[str]:
    """Verify the live, consumed theme files still match the tokens."""
    problems = []
    colors = d["color"]

    # Android Color.kt — every token hex must appear as Color(0xFF<HEX>).
    kt = os.path.join(ROOT, "android/app/src/main/java/ai/omerta/assistant/ui/theme/Color.kt")
    if os.path.exists(kt):
        text = open(kt).read().upper()
        for name, hexv in colors.items():
            h = hexv.lstrip("#").upper()
            if f"0XFF{h}" not in text.replace("0xFF", "0XFF"):
                problems.append(f"Android Color.kt missing token {name} (#{h})")

    # Desktop palette — KEY = "#HEX" for the desktop subset.
    dsk = os.path.join(ROOT, "desktop/omerta_desktop.py")
    if os.path.exists(dsk):
        text = open(dsk).read().upper()
        subset = ["black", "surface", "surfaceHigh", "border", "amber", "green", "red",
                  "textPrimary", "textSecondary", "userBubble"]
        for name in subset:
            h = colors[name].lstrip("#").upper()
            if h not in text:
                problems.append(f"desktop palette missing {name} (#{h})")
    return problems


def check_generated(d: dict) -> list[str]:
    problems = []
    for name, fn in GENERATORS.items():
        p = os.path.join(GEN, name)
        want = fn(d)
        have = open(p).read() if os.path.exists(p) else None
        if have != want:
            problems.append(f"design/generated/{name} is stale — run: python3 design/gen_themes.py")
    return problems


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    d = load()
    if "--check" in argv:
        write_all(d)  # keep generated fresh, then verify everything lines up
        problems = check_generated(d) + check_live_files(d)
        if problems:
            print("THEME PARITY FAILED:")
            for p in problems:
                print("  -", p)
            return 1
        print(f"theme parity OK — {len(d['color'])} tokens, all targets in sync")
        return 0
    write_all(d)
    print(f"generated {len(GENERATORS)} theme files in design/generated/ from {len(d['color'])} tokens")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
