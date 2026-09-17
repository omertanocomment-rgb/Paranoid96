"""Attachments: any file, any size, any type.

The owner asked for uploads with no file-type and no size restriction, and
that is what this is. Two engineering consequences follow, and both are
handled here rather than by quietly reintroducing a limit:

**No size limit means never holding the file in memory.** The JSON body path
caps at 16 MiB and decodes the whole request before looking at it, which for a
4 GB model file would simply kill the app. So an upload is streamed to disk in
chunks and never materialised whole.

**No size limit means the disk can genuinely fill.** Rather than pre-empting
that with a cap, a failed write is caught, the partial file is removed, and
the error says how much space was left. A half-written file that looks
complete is worse than a refused one.

**No type restriction means never rendering what was stored.** Files are
served back as `application/octet-stream` with an attachment disposition, so a
stored .html or .svg is downloaded rather than executed inside the app's own
origin. That is not a restriction on what you may upload -- everything is
accepted and stored byte-for-byte -- only a refusal to run it as code in the
one place where it would be someone else's script in your session.

Attachments are local-only, like the terminal and the sandbox: putting a file
on your device is you operating it, not the agent acting.
"""
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from . import config

CHUNK = 1024 * 1024          # 1 MiB; big enough to be fast, small enough to stream
INDEX_NAME = "index.json"


def root():
    d = Path(config.DATA_DIR) / "attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path():
    return root() / INDEX_NAME


def _load_index():
    try:
        data = json.loads(_index_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save_index(rows):
    tmp = _index_path().with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(rows, indent=1), encoding="utf-8")
        tmp.replace(_index_path())
    except OSError:
        pass


def safe_name(name):
    """A filename that cannot escape the attachment directory.

    Only the basename is kept and separators are stripped. This is not a
    restriction on WHAT you may upload -- it is refusing to let a filename
    decide where on the device the bytes land.
    """
    name = str(name or "").replace("\\", "/").split("/")[-1].strip()
    name = name.replace("\x00", "")
    # leading dots would hide the file; a bare ".." would escape
    while name.startswith("."):
        name = name[1:]
    return name[:255] or "attachment"


def free_bytes():
    try:
        return shutil.disk_usage(str(root())).free
    except OSError:
        return -1


class Incoming:
    """An upload being written, one chunk at a time.

    Exists because the two servers deliver bytes differently -- the stdlib one
    hands over a blocking socket, FastAPI an async iterator -- and the naive
    way to bridge that is to collect the chunks first, which puts the entire
    file in memory and defeats the whole design. Both now push chunks into
    this, so only one chunk is ever resident.
    """

    def __init__(self, filename, project=None, note=""):
        self.id = uuid.uuid4().hex[:16]
        self.name = safe_name(filename)
        self.project = project or ""
        self.note = str(note or "")[:500]
        self.written = 0
        self.error = None
        self.folder = root() / self.id
        self._fh = None
        try:
            self.folder.mkdir(parents=True, exist_ok=False)
            self._fh = open(self.folder / self.name, "wb")
        except OSError as e:
            self.error = f"could not open the attachment for writing: {e}"

    def write(self, chunk):
        if self.error or not chunk:
            return
        try:
            self._fh.write(chunk)
            self.written += len(chunk)
        except OSError as e:
            free = free_bytes()
            extra = f" ({free // (1024 * 1024)} MB free)" if free >= 0 else ""
            self.error = f"write failed after {self.written} bytes: {e}{extra}"

    def abort(self):
        try:
            if self._fh:
                self._fh.close()
        except OSError:
            pass
        shutil.rmtree(self.folder, ignore_errors=True)

    def finish(self, declared_size=None):
        try:
            if self._fh:
                self._fh.close()
        except OSError as e:
            self.error = self.error or f"could not close the file: {e}"
        if self.error:
            self.abort()
            return {"error": self.error}
        if declared_size is not None and self.written != declared_size:
            # A short read means the transfer was cut off. Keeping it would
            # leave a truncated file that reads as a complete one.
            self.abort()
            return {"error": f"incomplete upload: got {self.written} "
                             f"of {declared_size} bytes"}
        rec = {"id": self.id, "name": self.name, "bytes": self.written,
               "project": self.project, "note": self.note, "added": time.time()}
        rows = _load_index()
        rows.append(rec)
        _save_index(rows)
        return rec


def save_stream(read, filename, project=None, note="", declared_size=None):
    """Stream an upload to disk. `read(n)` returns up to n bytes, b"" at EOF.

    Returns the attachment record, or {"error": ...}. Nothing is capped; the
    only failures are the disk filling or the connection dying mid-transfer,
    and both remove the partial file rather than leaving something that looks
    complete.
    """
    inc = Incoming(filename, project=project, note=note)
    if inc.error:
        return {"error": inc.error}
    try:
        while True:
            chunk = read(CHUNK)
            if not chunk:
                break
            inc.write(chunk)
            if inc.error:
                break
    except Exception as e:  # noqa: BLE001 — a dropped connection is not a crash
        inc.abort()
        return {"error": f"upload interrupted after {inc.written} bytes: {e}"}
    return inc.finish(declared_size)


def listing(project=None):
    rows = _load_index()
    if project:
        rows = [r for r in rows if r.get("project") == project]
    return sorted(rows, key=lambda r: r.get("added", 0), reverse=True)


def get(aid):
    for r in _load_index():
        if r.get("id") == aid:
            return r
    return None


def path_for(aid):
    """The file on disk, or None. Resolved and confined to the attachment root."""
    rec = get(aid)
    if not rec:
        return None
    base = root().resolve()
    p = (base / rec["id"] / rec["name"]).resolve()
    if base not in p.parents or not p.is_file():
        return None
    return p


def delete(aid):
    rows = _load_index()
    keep = [r for r in rows if r.get("id") != aid]
    if len(keep) == len(rows):
        return {"error": f"no such attachment: {aid}"}
    shutil.rmtree(root() / aid, ignore_errors=True)
    _save_index(keep)
    return {"status": "deleted", "id": aid}


def stats():
    rows = _load_index()
    return {"count": len(rows),
            "bytes": sum(int(r.get("bytes", 0)) for r in rows),
            "dir": str(root()),
            "free": free_bytes()}
