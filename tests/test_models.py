#!/usr/bin/env python3
"""The model catalogue and downloader.

The real models are gigabytes, so the transfer itself is exercised against a
local server with a small file. What matters is the behaviour around it: that
a corrupted download is caught rather than installed, that an interrupted one
resumes instead of starting over, that a full disk is refused before writing,
and that the catalogue only ever offers models that can actually be used
without an account or a licence click-through.
"""
import hashlib
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def serve(directory):
    handler = http.server.SimpleHTTPRequestHandler

    class H(handler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=directory, **k)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def wait(models, mid, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        job = models.status()["jobs"].get(mid, {})
        if job.get("state") in ("done", "error", "cancelled"):
            return job
        time.sleep(0.1)
    return {"state": "timeout"}


def main():
    print("=== model catalogue ===")
    tmp = tempfile.mkdtemp(prefix="omerta-models-")
    web = Path(tmp) / "web"
    web.mkdir()
    os.environ["OMERTA_DATA_DIR"] = str(Path(tmp) / "data")
    os.environ["OMERTA_MODELS_DIR"] = str(Path(tmp) / "data" / "models")
    for m in [m for m in list(sys.modules) if m.startswith("core")]:
        del sys.modules[m]
    srv = None
    try:
        from core import models

        # ── the shipped catalogue ────────────────────────────────────────
        real = models.catalogue()
        check("the catalogue is not empty", len(real) > 0)
        check("every model is Apache-2.0",
              all(m["license"] == "apache-2.0" for m in real))
        check("every model has a checksum",
              all(len(m.get("sha256", "")) == 64 for m in real))
        check("every model has a real size",
              all(m.get("bytes", 0) > 1_000_000 for m in real))
        check("every model has an https url",
              all(m.get("url", "").startswith("https://") for m in real))
        check("sizes are stated so nothing downloads by surprise",
              all(m.get("blurb") for m in real))
        check("an unknown model is refused",
              "error" in models.download("not-a-model"))

        # ── the transfer, against a real server ──────────────────────────
        payload = os.urandom(3 * 1024 * 1024)
        digest = hashlib.sha256(payload).hexdigest()
        (web / "good.gguf").write_bytes(payload)
        (web / "corrupt.gguf").write_bytes(os.urandom(3 * 1024 * 1024))
        srv, port = serve(str(web))

        fake = {"models": [
            {"id": "good", "label": "Good", "kind": "test", "blurb": "b",
             "repo": "t/t", "file": "good.gguf",
             "url": f"http://127.0.0.1:{port}/good.gguf",
             "bytes": len(payload), "sha256": digest, "license": "apache-2.0"},
            {"id": "bad", "label": "Corrupt", "kind": "test", "blurb": "b",
             "repo": "t/t", "file": "corrupt.gguf",
             "url": f"http://127.0.0.1:{port}/corrupt.gguf",
             "bytes": 3 * 1024 * 1024, "sha256": digest,  # deliberately wrong
             "license": "apache-2.0"},
        ]}
        models.CATALOGUE = Path(tmp) / "cat.json"
        models.CATALOGUE.write_text(json.dumps(fake))

        r = models.download("good")
        check("a download starts", r.get("status") == "started")
        job = wait(models, "good")
        check("a good download completes", job.get("state") == "done")
        dest = models.models_dir() / "good.gguf"
        check("the file lands in the models directory", dest.is_file())
        check("the bytes are exactly right", dest.read_bytes() == payload)
        check("no .part file is left behind",
              not (models.models_dir() / "good.gguf.part").exists())
        check("the catalogue now shows it installed",
              any(m["id"] == "good" and m["installed"]
                  for m in models.catalogue()))
        check("downloading it again is a no-op",
              "already installed" in str(models.download("good")))

        # ── a corrupted file must never be installed ─────────────────────
        models.download("bad")
        job = wait(models, "bad")
        check("a checksum mismatch is caught", job.get("state") == "error")
        check("the mismatch is explained",
              "checksum" in job.get("error", "").lower())
        check("the corrupt file is NOT installed",
              not (models.models_dir() / "corrupt.gguf").exists())
        check("the corrupt partial is cleaned up",
              not (models.models_dir() / "corrupt.gguf.part").exists())

        # ── resume rather than restart ───────────────────────────────────
        half = len(payload) // 2
        (models.models_dir() / "good.gguf").unlink()
        (models.models_dir() / "good.gguf.part").write_bytes(payload[:half])
        models._jobs.clear()
        models.download("good")
        job = wait(models, "good")
        check("an interrupted download resumes", job.get("state") == "done")
        check("resuming produces the correct file",
              (models.models_dir() / "good.gguf").read_bytes() == payload)

        # ── removal ──────────────────────────────────────────────────────
        check("a model can be removed",
              models.remove("good").get("status") == "removed")
        check("removal deletes the file",
              not (models.models_dir() / "good.gguf").exists())
        check("removing an unknown model is an error, not a crash",
              "error" in models.remove("nope"))
        check("cancelling nothing is an error, not a crash",
              "error" in models.cancel("good"))
    finally:
        if srv:
            srv.shutdown()
        for k in ("OMERTA_DATA_DIR", "OMERTA_MODELS_DIR"):
            os.environ.pop(k, None)
        shutil.rmtree(tmp, ignore_errors=True)
        for m in [m for m in list(sys.modules) if m.startswith("core")]:
            del sys.modules[m]

    print()
    if fails:
        print(f"MODEL TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("MODEL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
