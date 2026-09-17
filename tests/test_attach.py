#!/usr/bin/env python3
"""Attachments: any file, any size, any type.

The requirement was uploads with no file-type and no size restriction. What is
tested here is that the absence of limits is real, and that the consequences
of having none are handled rather than quietly turned back into limits:
a large file must never be held in memory, a full disk must not leave a
truncated file looking complete, and a filename must not decide where on the
device the bytes land.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def reader_for(data, chunk=1024 * 1024):
    pos = {"i": 0}

    def read(n):
        n = min(n, chunk)
        out = data[pos["i"]:pos["i"] + n]
        pos["i"] += len(out)
        return out
    return read


def main():
    print("=== attachments ===")
    tmp = tempfile.mkdtemp(prefix="omerta-attach-")
    os.environ["OMERTA_DATA_DIR"] = tmp
    for m in [m for m in list(sys.modules) if m.startswith("core")]:
        del sys.modules[m]
    try:
        from core import attach

        # every type is accepted -- there is no type rule to trip over
        types = {
            "notes.txt": b"plain text",
            "app.apk": b"PK\x03\x04binary-ish",
            "script.sh": b"#!/bin/sh\nrm -rf /\n",     # dangerous content, still stored
            "page.html": b"<script>alert(1)</script>",
            "vector.svg": b"<svg onload=alert(1)></svg>",
            "no-extension": b"\x00\x01\x02\x03",
            "weird name (1).tar.gz": b"\x1f\x8b" + b"\x00" * 10,
            "中文.dat": b"unicode filename",
        }
        ids = {}
        for name, data in types.items():
            rec = attach.save_stream(reader_for(data), name,
                                     declared_size=len(data))
            ok = "error" not in rec and rec.get("bytes") == len(data)
            check(f"accepts {name!r}", ok)
            if ok:
                ids[name] = rec["id"]

        # bytes come back exactly as sent
        same = all(attach.path_for(i).read_bytes() == types[n]
                   for n, i in ids.items())
        check("stored byte-for-byte", same)

        # a filename cannot steer the write out of the attachment directory
        base = attach.root().resolve()
        rec = attach.save_stream(reader_for(b"x"), "../../../etc/passwd",
                                 declared_size=1)
        p = attach.path_for(rec.get("id", ""))
        check("a traversing filename stays inside the store",
              p is not None and base in p.parents)

        # size: 64 MiB in 1 MiB chunks, and memory must not track the file
        big = 64 * 1024 * 1024
        written = {"n": 0}

        def big_read(n):
            left = big - written["n"]
            if left <= 0:
                return b""
            take = min(n, left, 1024 * 1024)
            written["n"] += take
            return b"\x5a" * take

        rec = attach.save_stream(big_read, "large.bin", declared_size=big)
        check("accepts a 64 MiB file with no cap",
              "error" not in rec and rec.get("bytes") == big)
        check("the large file is on disk at full size",
              attach.path_for(rec["id"]).stat().st_size == big)
        attach.delete(rec["id"])

        # a cut-off transfer must not leave something that looks complete
        rec = attach.save_stream(reader_for(b"only-part"), "truncated.bin",
                                 declared_size=9999)
        check("a short upload is refused", "error" in rec)
        check("a short upload says how short",
              "incomplete" in rec.get("error", ""))
        leftover = [d for d in attach.root().iterdir()
                    if d.is_dir() and any(f.name == "truncated.bin"
                                          for f in d.iterdir())]
        check("a short upload leaves nothing behind", not leftover)

        # listing, retrieval, deletion
        rows = attach.listing()
        check("everything accepted is listed", len(rows) >= len(ids))
        first = next(iter(ids.values()))
        check("an attachment can be fetched by id", attach.path_for(first) is not None)
        check("deleting removes the record", "deleted" in
              str(attach.delete(first)))
        check("deleting removes the bytes", attach.path_for(first) is None)
        check("deleting something absent is an error, not a crash",
              "error" in attach.delete("nope"))

        st = attach.stats()
        check("stats report free space", st.get("free", -1) >= 0)

        # both servers must treat uploads as local-only and never render them
        h = (ROOT / "core/httpd.py").read_text()
        v = (ROOT / "server.py").read_text()
        check("httpd marks /api/attach local-only",
              "/api/attach" in h.split("LOCAL_ONLY")[1][:300])
        check("server.py marks /api/attach local-only",
              "/api/attach" in v.split("LOCAL_ONLY_PREFIXES")[1][:300])
        for name, text in (("httpd", h), ("server.py", v)):
            check(f"{name} serves attachments as opaque downloads",
                  "application/octet-stream" in text and "nosniff" in text)
        # neither server may buffer the whole upload
        check("server.py streams rather than buffering",
              "Incoming(" in v and "chunks.append" not in v)
    finally:
        os.environ.pop("OMERTA_DATA_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)
        for m in [m for m in list(sys.modules) if m.startswith("core")]:
            del sys.modules[m]

    print()
    if fails:
        print(f"ATTACHMENT TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("ATTACHMENT TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
