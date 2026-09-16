"""Phase 13 / section 17 — Firmware & device-tree tooling.

Detects the full spec toolchain, invokes tools generically, and provides convenience
ops (unpack boot image, AVB info, dtb<->dts, sparse<->raw, super unpack, extract).
Inspects first; never flashes. Reports honestly when a tool is missing rather than
guessing board-level values.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

# Full toolchain from the spec (section 17 + Phase 13).
FW_TOOLS = [
    "repo", "git", "adb", "fastboot",
    "dtc", "fdtdump", "fdtget", "fdtput",
    "mkbootimg", "unpack_bootimg", "mkdtboimg", "avbtool",
    "simg2img", "img2simg", "lpmake", "lpunpack",
    "mkfs.erofs", "dump.erofs", "mke2fs", "e2fsdroid", "resize2fs",
    "lz4", "gzip", "xz",
    "clang", "llvm-ar", "gcc", "aarch64-linux-gnu-gcc", "arm-linux-gnueabihf-gcc",
    "ninja", "make", "soong_ui.bash",
]


def toolchain() -> dict[str, bool]:
    return {t: shutil.which(t) is not None for t in FW_TOOLS}


def run_tool(name: str, args: list[str] | None = None, cwd: str | None = None,
             timeout: int = 300) -> dict:
    """Invoke any detected firmware tool with arguments. Honest when missing."""
    if shutil.which(name) is None:
        return {"tool": name, "available": False, "evidence": "UNKNOWN",
                "error": f"{name} not installed"}
    try:
        p = subprocess.run([name, *(args or [])], capture_output=True, text=True,
                           timeout=timeout, cwd=cwd)
        return {"tool": name, "available": True, "evidence": "CONFIRMED",
                "exit_code": p.returncode,
                "stdout": p.stdout[-8000:], "stderr": p.stderr[-4000:]}
    except subprocess.TimeoutExpired:
        return {"tool": name, "available": True, "evidence": "UNKNOWN",
                "error": f"timeout after {timeout}s"}
    except Exception as e:  # noqa: BLE001
        return {"tool": name, "available": True, "evidence": "UNKNOWN", "error": str(e)}


# ---- convenience ops ----
def unpack_boot(image: str, out_dir: str | None = None) -> dict:
    out = out_dir or (str(Path(image).with_suffix("")) + "_unpacked")
    Path(out).mkdir(parents=True, exist_ok=True)
    return run_tool("unpack_bootimg", ["--boot_img", image, "--out", out])


def avb_info(image: str) -> dict:
    return run_tool("avbtool", ["info_image", "--image", image])


def dtb_to_dts(dtb: str, out: str | None = None) -> dict:
    dst = out or (str(Path(dtb).with_suffix(".dts")))
    return run_tool("dtc", ["-I", "dtb", "-O", "dts", "-o", dst, dtb])


def dts_to_dtb(dts: str, out: str | None = None) -> dict:
    dst = out or (str(Path(dts).with_suffix(".dtb")))
    return run_tool("dtc", ["-I", "dts", "-O", "dtb", "-o", dst, dts])


def sparse_to_raw(image: str, out: str | None = None) -> dict:
    dst = out or (str(Path(image).with_suffix(".raw.img")))
    return run_tool("simg2img", [image, dst])


def super_unpack(image: str, out_dir: str | None = None) -> dict:
    out = out_dir or (str(Path(image).with_suffix("")) + "_parts")
    Path(out).mkdir(parents=True, exist_ok=True)
    return run_tool("lpunpack", [image, out])


def extract(image: str, out_dir: str | None = None) -> dict:
    """Decompress lz4/gz/xz by extension."""
    p = Path(image)
    if p.suffix == ".lz4":
        return run_tool("lz4", ["-d", "-f", image])
    if p.suffix == ".gz":
        return run_tool("gzip", ["-d", "-k", "-f", image])
    if p.suffix == ".xz":
        return run_tool("xz", ["-d", "-k", "-f", image])
    return {"error": f"unknown compression for {image}", "evidence": "UNKNOWN"}


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
    elif info["kind"] == "android-boot-image" and shutil.which("unpack_bootimg"):
        info["hint"] = "run `omerta firmware unpack <image>` to extract kernel/ramdisk/dtb"
        info["evidence"] = "LIKELY"
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
    if head[:4] == b"\x04\x22\x4d\x18":
        return "lz4"
    return p.suffix.lstrip(".") or "unknown"
