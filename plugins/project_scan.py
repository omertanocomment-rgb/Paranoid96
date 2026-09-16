"""Detect project type, stack, and entrypoints so the agent orients fast."""
import json
from pathlib import Path

PLUGIN = {"name": "project_scan",
          "description": "Identify a project's stack, build system and entrypoints",
          "version": "1.0"}

MARKERS = [
    ("build.gradle", "Android/Gradle"), ("build.gradle.kts", "Android/Gradle (KTS)"),
    ("settings.gradle", "Gradle multi-project"),
    ("package.json", "Node/JS"), ("capacitor.config.json", "Capacitor"),
    ("capacitor.config.ts", "Capacitor"), ("vite.config.ts", "Vite"),
    ("next.config.js", "Next.js"), ("Cargo.toml", "Rust"),
    ("pyproject.toml", "Python (PEP517)"), ("requirements.txt", "Python"),
    ("CMakeLists.txt", "CMake/C++"), ("Makefile", "Make"),
    ("configure.ac", "Autotools"), ("Package.swift", "Swift"),
    ("Podfile", "CocoaPods/iOS"), ("go.mod", "Go"),
    ("Dockerfile", "Docker"), ("AndroidManifest.xml", "Android manifest"),
]


def _scan(args):
    root = Path(args.get("path", "."))
    found, scripts = [], {}
    for name, label in MARKERS:
        hits = list(root.glob(name)) + list(root.glob(f"*/{name}"))
        if hits:
            found.append({"marker": name, "stack": label,
                          "at": str(hits[0].relative_to(root))})
    pkg = root / "package.json"
    if pkg.exists():
        try:
            scripts = json.loads(pkg.read_text()).get("scripts", {})
        except Exception:
            pass
    git = (root / ".git").exists()
    return {"root": str(root.resolve()), "stacks": found,
            "npm_scripts": scripts, "git_repo": git,
            "summary": ", ".join(sorted({f['stack'] for f in found})) or "unknown"}


def register():
    return {
        "project_scan": {
            "description": "Detect stack/build system/entrypoints of a project dir",
            "params": {"path": "str (default '.')"},
            "handler": _scan,
            "mutating": False,
        }
    }
