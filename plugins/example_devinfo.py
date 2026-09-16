"""
Example plugin — copy this file to make your own.

Contract:
    META  = {"name": str, "description": str}
    TOOLS = {"tool_name": fn(args: dict) -> anything JSON-serializable}

Anything returning {"status": "awaiting_approval", ...} gets routed through
the approval gate automatically, same as built-in mutating tools.
"""
import platform
import shutil

META = {
    "name": "devinfo",
    "description": "Reports the local dev environment — OS, arch, and which "
                   "build tools are actually installed.",
}


def _env_report(args):
    tools = ["git", "python3", "node", "npm", "java", "gradle", "adb",
             "fastboot", "clang", "gcc", "cmake", "make", "aapt", "apktool",
             "aarch64-linux-gnu-gcc", "arm-linux-gnueabihf-gcc", "ollama"]
    found = {t: (shutil.which(t) or "NOT FOUND") for t in tools}
    return {
        "os": platform.system(),
        "release": platform.release(),
        "arch": platform.machine(),
        "python": platform.python_version(),
        "termux": bool(shutil.which("pkg") and "com.termux" in (shutil.which("pkg") or "")),
        "tools": found,
        "missing": [t for t, p in found.items() if p == "NOT FOUND"],
    }


TOOLS = {"dev_environment": _env_report}
