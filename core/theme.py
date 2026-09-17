"""
Themes — make it look like yours.

Every colour, font, logo and image the UI uses comes from here, so changing the
look never means editing HTML. A theme is a small JSON document plus any assets
you upload; both live in the agent's data directory, which means they survive
reinstalling the app and travel with a backup of that directory.

Three things worth knowing:

  * **Uploaded assets are validated by their bytes, not their name.** A file
    called `logo.png` that is actually an HTML document would, served back into
    the page, be a stored-XSS hole. Each upload is sniffed for a real image
    signature and stored with the type we detected, not the type we were told.
  * **SVG is deliberately not accepted.** It is an image format that can carry
    script, and this page renders user-supplied images inside itself. PNG, JPEG,
    WebP and GIF cover the job without that problem.
  * **The built-in theme is not editable.** `omerta` is always there to fall
    back to, so a theme you break is never a theme you are stuck in.
"""
import base64
import json
import os
import re
import time
import uuid

from . import config

THEME_DIR = config.DATA_DIR / "themes"
ASSET_DIR = THEME_DIR / "assets"
INDEX_FILE = THEME_DIR / "index.json"

MAX_ASSET_BYTES = int(config.get("OMERTA_THEME_MAX_ASSET", 4 * 1024 * 1024))

# name -> (extension, mime). Sniffed from the bytes; the client's claim is
# never trusted.
SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
    (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
    (b"GIF87a", ".gif", "image/gif"),
    (b"GIF89a", ".gif", "image/gif"),
)

# Every token the UI reads. Anything not listed here cannot be set, so a theme
# can restyle the app but cannot inject arbitrary CSS.
TOKENS = {
    "bg": "page background",
    "panel": "panel background",
    "panel2": "raised panel",
    "border": "borders and rules",
    "accent": "primary accent",
    "accent_bright": "bright accent / highlights",
    "accent_dim": "muted accent",
    "ember": "secondary accent (inline code)",
    "text": "body text",
    "muted": "secondary text",
    "ok": "success",
    "warn": "warning",
    "danger": "destructive",
    "glow": "accent glow strength (0-1)",
}

FONTS = {
    "display_font": "banner / wordmark font",
    "ui_font": "interface + body font",
    "mono_font": "terminal and code font",
}

TEXT_FIELDS = {
    "title": "wordmark text",
    "slogan": "line under the wordmark",
}

IMAGE_FIELDS = {
    "logo": "wordmark image (replaces the text if set)",
    "crest": "small mark beside the wordmark",
    "background": "page background image",
    "thumbnail": "app icon / thumbnail",
    "chat_avatar": "avatar beside the agent's replies",
}

BUILTIN = {
    "name": "omerta",
    "label": "OMERTA (red / black)",
    "builtin": True,
    "title": "OMERTA AI",
    "slogan": "Silence Is The Only Unbreakable Code",
    "display_font": "Unifraktur",
    "ui_font": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    "mono_font": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    "colors": {
        "bg": "#0a0506", "panel": "#140b0d", "panel2": "#1c1013",
        "border": "#3a1c21", "accent": "#c81e28", "accent_bright": "#ff2d3c",
        "accent_dim": "#7a1219", "ember": "#ff5a4a", "text": "#e8dcd8",
        "muted": "#8a7470", "ok": "#4dff88", "warn": "#ffb020",
        "danger": "#ff2d3c", "glow": "0.22",
    },
    "images": {},
}

PRESETS = {
    "ash": {
        "label": "ASH (grey / white)",
        "colors": {"bg": "#0d0d0f", "panel": "#16161a", "panel2": "#1e1e24",
                   "border": "#2e2e36", "accent": "#8a8a96", "accent_bright": "#e6e6ef",
                   "accent_dim": "#4a4a54", "ember": "#c9c9d4", "text": "#e8e8ee",
                   "muted": "#7c7c88", "ok": "#5ad18a", "warn": "#e0b050",
                   "danger": "#e05a5a", "glow": "0.10"},
    },
    "bone": {
        "label": "BONE (light)",
        "colors": {"bg": "#f4f1ea", "panel": "#e9e4da", "panel2": "#ded8cc",
                   "border": "#c6bdad", "accent": "#8c1c1c", "accent_bright": "#b02020",
                   "accent_dim": "#d8bcbc", "ember": "#9a3412", "text": "#20201d",
                   "muted": "#6b675e", "ok": "#1f7a4d", "warn": "#9a6700",
                   "danger": "#b02020", "glow": "0.06"},
    },
    "verdant": {
        "label": "VERDANT (green / black)",
        "colors": {"bg": "#050a07", "panel": "#0b140f", "panel2": "#101d15",
                   "border": "#1d3a28", "accent": "#1e9e55", "accent_bright": "#33e07a",
                   "accent_dim": "#125c31", "ember": "#7fffb0", "text": "#dcebe1",
                   "muted": "#6f8a78", "ok": "#33e07a", "warn": "#ffb020",
                   "danger": "#ff4d4d", "glow": "0.18"},
    },
    "cobalt": {
        "label": "COBALT (blue / black)",
        "colors": {"bg": "#05070d", "panel": "#0b1020", "panel2": "#111829",
                   "border": "#1f2b45", "accent": "#2563c8", "accent_bright": "#4d93ff",
                   "accent_dim": "#14356e", "ember": "#8fd0ff", "text": "#dde5f2",
                   "muted": "#74819a", "ok": "#4dff88", "warn": "#ffb020",
                   "danger": "#ff4d4d", "glow": "0.20"},
    },
}

_SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9 _-]{0,38}$")
_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _ensure():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)


def _index():
    _ensure()
    if INDEX_FILE.exists():
        try:
            data = json.loads(INDEX_FILE.read_text())
            if isinstance(data, dict) and "themes" in data:
                return data
        except (OSError, ValueError):
            pass
    return {"themes": {}, "active": "omerta"}


def _save(idx):
    _ensure()
    tmp = INDEX_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(idx, indent=2))
    os.replace(tmp, INDEX_FILE)


def _clean_colors(raw):
    """Keep known tokens holding plausible values.

    Colours go straight into a stylesheet, so anything that is not a hex colour
    is dropped rather than passed through — `red; } body { display:none` is a
    perfectly good string and a perfectly bad CSS value.
    """
    out, rejected = {}, {}
    for key, val in (raw or {}).items():
        if key not in TOKENS:
            rejected[key] = "unknown colour token"
            continue
        v = str(val).strip()
        if key == "glow":
            try:
                out[key] = f"{min(max(float(v), 0.0), 1.0):.2f}"
            except ValueError:
                rejected[key] = "glow must be a number between 0 and 1"
            continue
        if not _COLOR.match(v):
            rejected[key] = "must be a hex colour like #ff2d3c"
            continue
        out[key] = v
    return out, rejected


def _clean_font(val):
    """A font stack, with the characters that would end the CSS rule removed."""
    v = re.sub(r"[;{}<>]", "", str(val or "")).strip()
    return v[:160]


def resolve(name=None):
    """A complete theme: the built-in, with the named theme layered over it."""
    idx = _index()
    name = name or idx.get("active") or "omerta"
    base = json.loads(json.dumps(BUILTIN))
    if name == "omerta":
        return base
    if name in PRESETS:
        p = PRESETS[name]
        base["name"] = name
        base["label"] = p["label"]
        base["builtin"] = True
        base["colors"].update(p.get("colors", {}))
        for k in list(FONTS) + list(TEXT_FIELDS):
            if k in p:
                base[k] = p[k]
        return base
    saved = idx["themes"].get(name)
    if not saved:
        return base
    base["name"] = name
    base["label"] = saved.get("label", name)
    base["builtin"] = False
    base["colors"].update(saved.get("colors", {}))
    base["images"] = dict(saved.get("images", {}))
    for k in list(FONTS) + list(TEXT_FIELDS):
        if saved.get(k):
            base[k] = saved[k]
    return base


def active():
    return resolve(None)


def listing():
    idx = _index()
    rows = [{"name": "omerta", "label": BUILTIN["label"], "builtin": True}]
    rows += [{"name": n, "label": p["label"], "builtin": True}
             for n, p in PRESETS.items()]
    rows += [{"name": n, "label": t.get("label", n), "builtin": False,
              "images": list(t.get("images", {})), "updated": t.get("updated")}
             for n, t in sorted(idx["themes"].items())]
    return {"status": "ok", "active": idx.get("active", "omerta"),
            "themes": rows, "tokens": TOKENS, "fonts": FONTS,
            "text_fields": TEXT_FIELDS, "image_fields": IMAGE_FIELDS,
            "current": resolve(None)}


def use(name):
    idx = _index()
    name = str(name or "omerta")
    known = {"omerta", *PRESETS, *idx["themes"]}
    if name not in known:
        return {"status": "error", "reason": f"no theme called {name!r}"}
    idx["active"] = name
    _save(idx)
    return {"status": "ok", "active": name, "theme": resolve(name)}


def save(args=None):
    """Create or update a custom theme.

    Editing a built-in forks it into a custom one rather than failing — you
    almost always mean "like this, but mine", and there is no way to end up
    with a broken built-in to fall back to.
    """
    a = args or {}
    name = str(a.get("name") or "").strip().lower()
    if name in ("omerta", *PRESETS):
        name = f"{name} custom"
    if not _SAFE_NAME.match(name):
        return {"status": "error",
                "reason": "theme names are lower-case letters, digits, spaces, "
                          "- and _ (up to 39 characters)"}
    idx = _index()
    cur = idx["themes"].get(name, {"images": {}, "colors": {}})
    base_from = a.get("from")
    if base_from and not cur.get("colors"):
        seed = resolve(base_from)
        cur["colors"] = dict(seed["colors"])
        for k in list(FONTS) + list(TEXT_FIELDS):
            cur[k] = seed.get(k)

    colors, rejected = _clean_colors(a.get("colors"))
    cur.setdefault("colors", {}).update(colors)
    for k in FONTS:
        if k in a:
            cur[k] = _clean_font(a[k])
    for k in TEXT_FIELDS:
        if k in a:
            cur[k] = str(a[k])[:120]
    cur["label"] = str(a.get("label") or cur.get("label") or name)[:60]
    cur["updated"] = time.time()
    idx["themes"][name] = cur
    if a.get("activate", True):
        idx["active"] = name
    _save(idx)
    return {"status": "ok", "name": name, "rejected": rejected,
            "active": idx["active"], "theme": resolve(name)}


def delete(name):
    idx = _index()
    if name in ("omerta", *PRESETS):
        return {"status": "error", "reason": "built-in themes cannot be deleted"}
    rec = idx["themes"].pop(str(name), None)
    if not rec:
        return {"status": "error", "reason": f"no theme called {name!r}"}
    for rel in (rec.get("images") or {}).values():
        try:
            os.remove(ASSET_DIR / os.path.basename(rel))
        except OSError:
            pass
    if idx.get("active") == name:
        idx["active"] = "omerta"
    _save(idx)
    return {"status": "ok", "deleted": name, "active": idx["active"]}


def _sniff(blob):
    for sig, ext, mime in SIGNATURES:
        if blob.startswith(sig):
            return ext, mime
    # WebP: "RIFF....WEBP"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None, None


def put_image(args=None):
    """Store an uploaded image against a theme slot."""
    a = args or {}
    name = str(a.get("name") or _index().get("active") or "omerta").lower()
    slot = str(a.get("slot") or "")
    if slot not in IMAGE_FIELDS:
        return {"status": "error",
                "reason": f"unknown image slot {slot!r}",
                "slots": sorted(IMAGE_FIELDS)}
    raw = a.get("content_b64")
    if not raw:
        return {"status": "error", "reason": "no image data"}
    try:
        blob = base64.b64decode(raw)
    except Exception as e:                         # noqa: BLE001
        return {"status": "error", "reason": f"bad base64: {e}"}
    if len(blob) > MAX_ASSET_BYTES:
        return {"status": "error",
                "reason": f"{len(blob)} bytes exceeds the "
                          f"{MAX_ASSET_BYTES} byte limit"}
    ext, mime = _sniff(blob)
    if not ext:
        return {"status": "error",
                "reason": "that is not a PNG, JPEG, GIF or WebP. SVG is not "
                          "accepted: it can carry script, and these images are "
                          "rendered inside the app."}

    if name in ("omerta", *PRESETS):
        name = f"{name} custom"
        save({"name": name, "from": a.get("name") or "omerta", "activate": False})
    idx = _index()
    if name not in idx["themes"]:
        save({"name": name, "activate": False})
        idx = _index()

    _ensure()
    fn = f"{uuid.uuid4().hex[:12]}{ext}"
    (ASSET_DIR / fn).write_bytes(blob)

    rec = idx["themes"][name]
    old = (rec.get("images") or {}).get(slot)
    if old:
        try:
            os.remove(ASSET_DIR / os.path.basename(old))
        except OSError:
            pass
    rec.setdefault("images", {})[slot] = fn
    rec["updated"] = time.time()
    if a.get("activate", True):
        idx["active"] = name
    _save(idx)
    return {"status": "ok", "name": name, "slot": slot, "file": fn,
            "mime": mime, "bytes": len(blob), "active": idx["active"]}


def clear_image(args=None):
    a = args or {}
    name = str(a.get("name") or _index().get("active") or "").lower()
    slot = str(a.get("slot") or "")
    idx = _index()
    rec = idx["themes"].get(name)
    if not rec:
        return {"status": "error", "reason": "not a custom theme"}
    fn = (rec.get("images") or {}).pop(slot, None)
    if fn:
        try:
            os.remove(ASSET_DIR / os.path.basename(fn))
        except OSError:
            pass
    _save(idx)
    return {"status": "ok", "slot": slot, "cleared": bool(fn)}


def image_path(filename):
    """Resolve a theme asset for serving. Contained to the asset directory."""
    base = os.path.realpath(str(ASSET_DIR))
    p = os.path.realpath(os.path.join(base, os.path.basename(str(filename))))
    if p != base and not p.startswith(base + os.sep):
        return None
    return p if os.path.isfile(p) else None


def css(name=None):
    """The active theme as a stylesheet the page can just include."""
    t = resolve(name)
    c = t["colors"]

    def v(key, fallback=""):
        return c.get(key, BUILTIN["colors"].get(key, fallback))

    img = {k: f"/theme/asset/{fn}" for k, fn in (t.get("images") or {}).items()}
    lines = [
        "/* generated from the active OMERTA theme */",
        ":root{",
        f"  --bg:{v('bg')};",
        f"  --panel:{v('panel')};",
        f"  --panel2:{v('panel2')};",
        f"  --border:{v('border')};",
        f"  --red:{v('accent')};",
        f"  --red-bright:{v('accent_bright')};",
        f"  --red-dim:{v('accent_dim')};",
        f"  --ember:{v('ember')};",
        f"  --text:{v('text')};",
        f"  --muted:{v('muted')};",
        f"  --ok:{v('ok')};",
        f"  --warn:{v('warn')};",
        f"  --danger:{v('danger')};",
        f"  --glow:{v('glow', '0.22')};",
        f"  --display-font:{t.get('display_font') or BUILTIN['display_font']};",
        f"  --ui-font:{t.get('ui_font') or BUILTIN['ui_font']};",
        f"  --mono-font:{t.get('mono_font') or BUILTIN['mono_font']};",
        "}",
    ]
    if img.get("background"):
        lines += ["body::before{",
                  f"  background-image:url('{img['background']}');",
                  "  background-size:cover;background-position:center;",
                  "  opacity:.5;}"]
    return "\n".join(lines)


def stats():
    idx = _index()
    return {"active": idx.get("active", "omerta"),
            "custom": len(idx["themes"]),
            "presets": 1 + len(PRESETS)}
