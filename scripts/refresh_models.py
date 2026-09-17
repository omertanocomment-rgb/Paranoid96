#!/usr/bin/env python3
"""Regenerate core/models_catalogue.json from the HuggingFace API.

Never hand-edit the catalogue. Sizes and checksums typed by a person are
values nobody verified, and a wrong checksum means a model that can never
install. Run this instead; it refuses anything it cannot confirm.

Rules enforced here, not in review:
  * Apache-2.0 only -- the model must be usable and redistributable with no
    account, no key and no licence click-through.
  * A published checksum is required. Without one a corrupted download cannot
    be detected, and a corrupt GGUF fails obscurely rather than loudly.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "core" / "models_catalogue.json"

WANTED = [
    ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "qwen2.5-0.5b-instruct-q4_k_m.gguf",
     "Qwen2.5 0.5B Instruct", "general",
     "Tiny and quick. Runs on any phone, including older ones. Good for "
     "questions and short edits; not for hard reasoning."),
    ("Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
     "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
     "Qwen2.5 Coder 1.5B", "coding",
     "The recommended first model. Trained for code, small enough to stay "
     "responsive on a phone, and genuinely useful for real work."),
    ("Qwen/Qwen2.5-1.5B-Instruct-GGUF", "qwen2.5-1.5b-instruct-q4_k_m.gguf",
     "Qwen2.5 1.5B Instruct", "general",
     "General-purpose counterpart to the Coder model. Better at prose and "
     "explanation, weaker at code."),
    ("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
     "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
     "Qwen2.5 Coder 7B", "coding",
     "Noticeably stronger, and noticeably slower. Needs 8 GB of RAM or more "
     "and will warm the device on a long generation."),
]


def api(url):
    req = urllib.request.Request(url, headers={"User-Agent": "omerta-build"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def main():
    out, problems = [], []
    for repo, fname, label, kind, blurb in WANTED:
        try:
            info = api(f"https://huggingface.co/api/models/{repo}")
            tree = api(f"https://huggingface.co/api/models/{repo}/tree/main")
        except Exception as e:  # noqa: BLE001
            problems.append(f"{repo}: {e}")
            continue
        lic = ((info.get("cardData") or {}).get("license") or "").lower()
        if lic != "apache-2.0":
            problems.append(f"{repo}: licence is {lic!r}, not apache-2.0")
            continue
        node = next((f for f in tree if f.get("path") == fname), None)
        if node is None:
            problems.append(f"{repo}: {fname} is not in the repository")
            continue
        lfs = node.get("lfs") or {}
        sha = lfs.get("oid") or ""
        size = int(lfs.get("size") or node.get("size") or 0)
        if len(sha) != 64:
            problems.append(f"{repo}: no usable checksum")
            continue
        if size <= 0:
            problems.append(f"{repo}: no usable size")
            continue
        out.append({"id": repo.split("/")[-1].replace("-GGUF", "").lower(),
                    "label": label, "kind": kind, "blurb": blurb,
                    "repo": repo, "file": fname,
                    "url": f"https://huggingface.co/{repo}/resolve/main/{fname}",
                    "bytes": size, "sha256": sha, "license": lic})
        print(f"  ✓ {label:<26} {size / 1e9:.2f} GB  {sha[:12]}…")

    for p in problems:
        print(f"  ! {p}", file=sys.stderr)
    if not out:
        sys.exit("refusing to write an empty catalogue")
    OUT.write_text(json.dumps({"generated_from": "huggingface api",
                               "models": out}, indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)} — {len(out)} models"
          + (f", {len(problems)} skipped" if problems else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
