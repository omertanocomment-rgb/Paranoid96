"""The model catalogue: getting a brain onto the device without a key.

The ask was for the no-API models to be "already present when installed".
Bundling the weights in the APK is the literal reading and it does not work:
a useful GGUF is 1-5 GB, which makes an APK nobody can sideload and which no
store will take. So the app ships the catalogue and fetches the file itself,
on first run, over the owner's own connection. From the owner's side that is
the same outcome -- open the app, pick a model, it is there -- without a
five-gigabyte install.

What is deliberately NOT done: downloading anything on its own. A multi-
gigabyte transfer onto a phone is the owner's decision, not a side effect of
opening an app. Every entry states its size before anything starts.

The catalogue is generated from the HuggingFace API by scripts/refresh_models.py,
never hand-written, and only Apache-2.0 models with a published checksum are
included -- so every one can be redistributed and used with no account, no
licence click-through and no key.
"""
import json
import hashlib
import sys
import os
import shutil
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import config

HERE = Path(__file__).resolve().parent
CATALOGUE = HERE / "models_catalogue.json"
CHUNK = 1024 * 1024
UA = "omerta-agent"

_lock = threading.Lock()
_jobs = {}          # model id -> progress dict


def models_dir():
    from . import localai
    return localai.models_dir()


def catalogue():
    """Every model on offer, annotated with whether it is already here."""
    try:
        data = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        rows = data.get("models", [])
    except (OSError, ValueError):
        return []
    here = models_dir()
    out = []
    for m in rows:
        if not isinstance(m, dict) or not m.get("url"):
            continue
        dest = here / m["file"]
        row = dict(m)
        row["installed"] = dest.is_file()
        row["local_bytes"] = dest.stat().st_size if dest.is_file() else 0
        row["partial"] = (here / (m["file"] + ".part")).exists()
        job = _jobs.get(m.get("id"))
        row["job"] = dict(job) if job else None
        row["fits"] = _fits(m)
        out.append(row)
    if out and not any(r["installed"] for r in out):
        # Nothing on the device yet, so name the one to start with rather than
        # leaving a first-time owner to guess from four sizes. Smallest that
        # fits, which on a 32-bit phone is the only one that will be pleasant.
        best = min((r for r in out if r["fits"]),
                   key=lambda r: r.get("bytes", 0), default=None)
        if best is not None:
            best["suggested"] = True
    return out


def _fits(entry):
    """Whether this device can be expected to run the model at all.

    A 32-bit process cannot address enough memory for the larger weights, and
    saying so up front is better than a download that ends in an out-of-memory
    kill after several gigabytes. Where the answer is not knowable, the answer
    is yes -- refusing on a guess is worse than letting the owner try.
    """
    try:
        size = int(entry.get("bytes") or 0)
    except (TypeError, ValueError):
        return True
    if sys.maxsize <= 2 ** 32:
        # ~3 GB of usable address space per process, and llama.cpp needs the
        # weights plus its KV cache inside it.
        return size < 1_500_000_000
    return True


def _entry(model_id):
    for m in catalogue():
        if m.get("id") == model_id or m.get("file") == model_id:
            return m
    return None


def free_bytes():
    try:
        return shutil.disk_usage(str(models_dir())).free
    except OSError:
        return -1


def cancel(model_id):
    job = _jobs.get(model_id)
    if not job:
        return {"error": "nothing is downloading for that model"}
    job["cancel"] = True
    return {"status": "cancelling", "id": model_id}


def _verify(path, expect):
    """Hash the file on disk and compare. Slow, and worth it.

    A truncated or corrupted GGUF does not fail loudly -- llama.cpp reports
    something obscure, or loads and produces nonsense. Checking the published
    checksum turns that into a clear answer at download time.
    """
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            while True:
                b = fh.read(CHUNK)
                if not b:
                    break
                h.update(b)
    except OSError as e:
        return False, f"could not read the file back: {e}"
    got = h.hexdigest()
    if expect and got != expect:
        return False, f"checksum mismatch (expected {expect[:12]}…, got {got[:12]}…)"
    return True, got


def _download(model_id, entry, job):
    here = models_dir()
    dest = here / entry["file"]
    part = here / (entry["file"] + ".part")

    # Resume: a gigabyte over a phone connection gets interrupted, and starting
    # again from zero every time makes a large model effectively unobtainable.
    have = part.stat().st_size if part.exists() else 0
    total = int(entry.get("bytes") or 0)
    if have and total and have > total:
        part.unlink(missing_ok=True)
        have = 0

    free = free_bytes()
    needed = (total - have) if total else 0
    if free >= 0 and needed and free < needed + (64 * 1024 * 1024):
        job.update(state="error",
                   error=f"not enough space: needs {needed // 2**20} MB, "
                         f"{free // 2**20} MB free")
        return

    req = urllib.request.Request(entry["url"], headers={"User-Agent": UA})
    if have:
        req.add_header("Range", f"bytes={have}-")
    job.update(state="downloading", got=have, total=total, started=time.time())

    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if have and r.status != 206:
                # The server ignored the range; start over rather than append
                # to a file that would end up a corrupt splice.
                have = 0
                part.unlink(missing_ok=True)
                job["got"] = 0
            mode = "ab" if have else "wb"
            with open(part, mode) as fh:
                while True:
                    if job.get("cancel"):
                        job.update(state="cancelled")
                        return
                    chunk = r.read(CHUNK)
                    if not chunk:
                        break
                    fh.write(chunk)
                    job["got"] += len(chunk)
    except (urllib.error.URLError, OSError, ValueError) as e:
        job.update(state="error", error=f"download failed: {e}")
        return

    if total and job["got"] != total:
        job.update(state="error",
                   error=f"incomplete: got {job['got']} of {total} bytes")
        return

    job.update(state="verifying")
    ok, detail = _verify(part, entry.get("sha256", ""))
    if not ok:
        part.unlink(missing_ok=True)
        job.update(state="error", error=detail)
        return

    try:
        part.replace(dest)
    except OSError as e:
        job.update(state="error", error=f"could not finalise: {e}")
        return
    job.update(state="done", finished=time.time())


def download(model_id):
    """Start fetching a model. Returns immediately; poll status()."""
    entry = _entry(model_id)
    if entry is None:
        return {"error": f"no such model: {model_id}"}
    if entry["installed"]:
        return {"status": "already installed", "id": entry["id"]}
    with _lock:
        job = _jobs.get(entry["id"])
        if job and job.get("state") in ("downloading", "verifying"):
            return {"status": "already downloading", "id": entry["id"]}
        job = {"id": entry["id"], "label": entry["label"], "state": "starting",
               "got": 0, "total": int(entry.get("bytes") or 0),
               "error": "", "cancel": False}
        _jobs[entry["id"]] = job
    threading.Thread(target=_download, args=(entry["id"], entry, job),
                     daemon=True).start()
    return {"status": "started", "id": entry["id"], "bytes": job["total"]}


def remove(model_id):
    entry = _entry(model_id)
    if entry is None:
        return {"error": f"no such model: {model_id}"}
    here = models_dir()
    gone = False
    for p in (here / entry["file"], here / (entry["file"] + ".part")):
        if p.exists():
            try:
                p.unlink()
                gone = True
            except OSError as e:
                return {"error": f"could not remove: {e}"}
    _jobs.pop(entry["id"], None)
    return {"status": "removed" if gone else "not present", "id": entry["id"]}


def status():
    rows = catalogue()
    return {"models": rows,
            "dir": str(models_dir()),
            "free": free_bytes(),
            "installed": sum(1 for m in rows if m["installed"]),
            "jobs": {k: dict(v) for k, v in _jobs.items()}}


def stats():
    rows = catalogue()
    return {"catalogue": len(rows),
            "installed": sum(1 for m in rows if m["installed"]),
            "downloading": sum(1 for j in _jobs.values()
                               if j.get("state") in ("downloading", "verifying"))}
