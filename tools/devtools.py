"""Build/device command builders.

These return command STRINGS for the agent to propose through the approval
gate — they deliberately do not execute anything themselves.
"""
from pathlib import Path


def gradle_cmd(task="assembleDebug", cwd="."):
    wrapper = "./gradlew" if (Path(cwd).expanduser() / "gradlew").exists() else "gradle"
    return f"{wrapper} {task}"


def npm_cmd(args="run build"):
    return f"npm {args}"


def git_cmd(args="status"):
    return f"git {args}"


def adb_cmd(args="devices"):
    return f"adb {args}"


def fastboot_cmd(args="devices"):
    return f"fastboot {args}"


def apk_inspect_cmd(apk_path):
    return f"aapt dump badging {apk_path}"


def apk_sign_check_cmd(apk_path):
    return f"apksigner verify --print-certs {apk_path}"


def capacitor_sync_cmd():
    return "npm run build && npx cap sync android"
