"""Encrypted backup: everything you own, in one file you control.

Chats, projects, learned documents, memory, themes, settings and attachments
go into a single archive, encrypted with a key derived from a passphrase you
choose. It is meant to be the answer to "how do I move to a new phone" and to
"what happens when this one dies" -- both of which currently have no answer at
all beyond copying files out by hand.

Three decisions worth stating.

**The passphrase is not stored, and there is no recovery.** That is the point:
a backup you can open without the passphrase is a backup anyone who takes the
file can open. If you lose it, the archive is scrap.

**Model files are excluded.** They are gigabytes, they are not yours in any
meaningful sense -- they came from a public catalogue and can be fetched again
in one tap -- and including them would turn a backup you can actually keep
into one you cannot.

**The crypto is the same as private chats.** AES-GCM where the device really
has it, an HMAC keystream with a tag where it does not, chosen by the same
probe. Sharing that path means there is one implementation to get right rather
than two, and it already handles the broken-`cryptography` case that takes
the process down if you let it.
"""
import base64
import io
import json
import os
import secrets
import tarfile
import time
from pathlib import Path

from . import config
from .chats import _decrypt, _derive, _encrypt

FORMAT = "omerta-backup-1"

#: What goes in. Relative to the data directory.
INCLUDE = ["chats", "memory", "learn", "themes", "projects", "attachments",
           "settings.json", "workmode.json", "policy.json"]

#: What is deliberately left out, and why -- reported in the manifest so a
#: restore never silently lacks something you assumed was there.
EXCLUDE_REASONS = {
    "models": "GGUF model files are gigabytes and can be re-fetched in one tap",
    "python": "the interpreter's stdlib is reinstalled from the app itself",
    "bin": "the command-line tools are part of the app, not your data",
    "adb": "the adb key is device identity, not data worth moving",
    "scratch": "sandbox scratch space is temporary by definition",
}


def _data_dir():
    return Path(config.DATA_DIR)


def _sources():
    base = _data_dir()
    out = []
    for name in INCLUDE:
        p = base / name
        if p.exists():
            out.append(p)
    return out


def estimate():
    """What a backup would contain, before making one."""
    base = _data_dir()
    items, total = [], 0
    for p in _sources():
        if p.is_dir():
            n = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
            count = sum(1 for f in p.rglob("*") if f.is_file())
        else:
            n, count = p.stat().st_size, 1
        items.append({"name": p.name, "bytes": n, "files": count})
        total += n
    return {"items": items, "bytes": total,
            "excluded": EXCLUDE_REASONS, "dir": str(base)}


def create(passphrase, dest=None):
    """Write an encrypted archive. Returns its path and a manifest."""
    if not passphrase or len(str(passphrase)) < 8:
        return {"error": "a backup passphrase must be at least 8 characters — "
                         "there is no recovery if it is lost or guessed"}
    sources = _sources()
    if not sources:
        return {"error": "there is nothing to back up yet"}

    buf = io.BytesIO()
    manifest = {"format": FORMAT, "created": time.time(),
                "entries": [], "excluded": EXCLUDE_REASONS}
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        base = _data_dir()
        for p in sources:
            tar.add(str(p), arcname=p.relative_to(base).as_posix())
            manifest["entries"].append(p.name)
    plaintext = buf.getvalue()

    salt = secrets.token_bytes(16)
    key = _derive(passphrase, salt)
    blob = _encrypt(key, plaintext)
    envelope = {
        "format": FORMAT,
        "salt": base64.b64encode(salt).decode(),
        "manifest": manifest,
        "payload": blob,
        "plain_bytes": len(plaintext),
    }

    out = Path(dest) if dest else (base.parent /
                                   f"omerta-backup-{time.strftime('%Y%m%d-%H%M%S')}.omerta")
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(envelope), encoding="utf-8")
        os.chmod(out, 0o600)
    except OSError as e:
        return {"error": f"could not write the backup: {e}"}
    return {"status": "ok", "path": str(out), "bytes": out.stat().st_size,
            "contains": manifest["entries"], "algorithm": blob.get("alg")}


def inspect(path):
    """What is in an archive, without needing the passphrase.

    Only the manifest is readable unencrypted -- names of top-level sections
    and when it was made. The contents are not.
    """
    try:
        env = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"error": f"not a readable backup: {e}"}
    if env.get("format") != FORMAT:
        return {"error": f"unknown backup format: {env.get('format')!r}"}
    m = env.get("manifest") or {}
    return {"status": "ok", "created": m.get("created"),
            "contains": m.get("entries", []),
            "algorithm": (env.get("payload") or {}).get("alg"),
            "plain_bytes": env.get("plain_bytes")}


def restore(path, passphrase, into=None, dry_run=False):
    """Decrypt and unpack. Existing files are replaced, not merged."""
    try:
        env = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"error": f"not a readable backup: {e}"}
    if env.get("format") != FORMAT:
        return {"error": f"unknown backup format: {env.get('format')!r}"}
    try:
        key = _derive(passphrase, base64.b64decode(env["salt"]))
        plaintext = _decrypt(key, env["payload"])
    except (KeyError, ValueError, TypeError):
        # A wrong passphrase and a corrupted file are indistinguishable by
        # design -- the tag simply does not verify -- so say both.
        return {"error": "could not decrypt: wrong passphrase, or the file is "
                         "damaged"}

    target = Path(into) if into else _data_dir()
    names = []
    try:
        with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:gz") as tar:
            members = tar.getmembers()
            for m in members:
                # A backup is data, not a delivery mechanism: an entry that
                # escapes the target directory is refused rather than trusted
                # because we happen to have written the file ourselves.
                dest = (target / m.name).resolve()
                if target.resolve() not in dest.parents and dest != target.resolve():
                    return {"error": f"refusing an entry that escapes the "
                                     f"data directory: {m.name!r}"}
                if m.issym() or m.islnk():
                    return {"error": f"refusing a link in the archive: {m.name!r}"}
                names.append(m.name)
            if dry_run:
                return {"status": "ok", "would_restore": len(names),
                        "entries": sorted({n.split("/")[0] for n in names})}
            target.mkdir(parents=True, exist_ok=True)
            tar.extractall(str(target))
    except (tarfile.TarError, OSError) as e:
        return {"error": f"could not unpack: {e}"}
    return {"status": "ok", "restored": len(names),
            "entries": sorted({n.split("/")[0] for n in names}),
            "note": "restart the app so the restored data is picked up"}


def stats():
    est = estimate()
    return {"sections": len(est["items"]), "bytes": est["bytes"]}
