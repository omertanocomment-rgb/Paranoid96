"""Phase 13 / section 17 — Firmware & device-tree inspection.

Wraps the standard toolchain (dtc/fdtdump, mkbootimg/unpack_bootimg, avbtool, etc.).
Inspects first; never flashes. Reports honestly when a tool is missing rather than
guessing board-level values.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

FW_TOOLS = [
    "dtc", "fdtdump", "fdtget", "fdtput", "mkbootimg", "unpack_bootimg",
    "mkdtboimg", "avbtool", "simg2img", "img2simg", "lpmake", "lpunpack",
    "mkfs.erofs", "lz4", "gzip", "xz", "clang", "gcc", "ninja", "adb", "fastboot",
]


def toolchain() -> dict[str, bool]:
    return {t: shutil.which(t) is not None for t in FW_TOOLS}


def inspect_image(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {"error": f"not found: {path}", "evidence": "UNKNOWN"}
    info: dict = {"file": str(p), "size": p.stat().st_size, "kind": _kind(p)}
    if p.suffix in (".dtb", ".dtbo") and shutil.which("fdtdump"):
        try:
            out = subprocess.run(["fdtdump", str(p)], capture_output=True, text=True, timeout=30)
            info["fdt_head"] = "\n".join(out.stdout.splitlines()[:40])
            info["evidence"] = "CONFIRMED"
        except Exception as e:  # noqa: BLE001
            info["error"] = str(e); info["evidence"] = "UNKNOWN"
    else:
        info["evidence"] = "INFERRED"
        info["note"] = "install device-tree/boot tools for deep inspection (fdtdump, unpack_bootimg)"
    return info


def _kind(p: Path) -> str:
    head = p.read_bytes()[:8] if p.stat().st_size >= 8 else b""
    if head[:4] == b"\xd0\x0d\xfe\xed":
        return "device-tree-blob (FDT)"
    if head[:8] == b"ANDROID!":
        return "android-boot-image"
    if head[:4] == b"\x3a\xff\x26\xed":
        return "sparse-image"
    return p.suffix.lstrip(".") or "unknown"
