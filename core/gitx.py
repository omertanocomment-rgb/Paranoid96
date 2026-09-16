"""
Git intelligence — structured, READ-ONLY git queries.

This module never mutates a repository. It runs only read-only git subcommands
(status/diff/log/show/branch/…) and returns parsed results, so the agent (and
the CLI) can understand a repo without shelling out to raw git and guessing.
Anything that changes history — commit, reset, clean, push, checkout — stays a
shell command through the approval gate (`git push --force` / `reset --hard`
are already High-Risk there). That separation is the safety property here.
"""
import subprocess
from pathlib import Path

# Only these git subcommands may run from this module. Enforced, not advisory.
READONLY = {"status", "diff", "log", "show", "branch", "rev-parse", "ls-files",
            "remote", "tag", "describe", "shortlog", "blame", "config"}


class GitError(Exception):
    pass


def _run(args, cwd=".", timeout=20):
    if not args or args[0] not in READONLY:
        raise GitError(f"refusing non-read-only git subcommand: {args[:1]}")
    try:
        p = subprocess.run(["git", *args], cwd=cwd, capture_output=True,
                           text=True, timeout=timeout)
    except FileNotFoundError:
        raise GitError("git is not installed")
    except subprocess.TimeoutExpired:
        raise GitError(f"git {args[0]} timed out")
    if p.returncode != 0 and not p.stdout:
        raise GitError((p.stderr or "git failed").strip()[:300])
    return p.stdout


def is_repo(cwd="."):
    try:
        return _run(["rev-parse", "--is-inside-work-tree"], cwd).strip() == "true"
    except GitError:
        return False


def current_branch(cwd="."):
    return _run(["rev-parse", "--abbrev-ref", "HEAD"], cwd).strip()


def status(args=None):
    cwd = (args or {}).get("cwd", ".")
    if not is_repo(cwd):
        return {"status": "error", "reason": "not a git repository"}
    out = _run(["status", "--porcelain=v1", "-b"], cwd)
    lines = out.splitlines()
    branch_line = lines[0][3:] if lines and lines[0].startswith("##") else ""
    changes = [{"xy": ln[:2], "path": ln[3:]} for ln in lines[1:] if ln.strip()]
    staged = [c for c in changes if c["xy"][0] not in (" ", "?")]
    unstaged = [c for c in changes if c["xy"][1] not in (" ",)]
    untracked = [c for c in changes if c["xy"] == "??"]
    return {"status": "ok", "branch": current_branch(cwd), "branch_info": branch_line,
            "dirty": bool(changes), "staged": len(staged),
            "unstaged": len([c for c in unstaged if c["xy"] != "??"]),
            "untracked": len(untracked), "changes": changes}


def diff(args=None):
    args = args or {}
    cwd = args.get("cwd", ".")
    if not is_repo(cwd):
        return {"status": "error", "reason": "not a git repository"}
    base = ["diff"] + (["--staged"] if args.get("staged") else [])
    paths = args.get("paths")
    tail = (["--"] + (paths if isinstance(paths, list) else [paths])) if paths else []
    names = _run(base + ["--name-status"] + tail, cwd)
    files = [{"status": ln.split("\t")[0], "path": "\t".join(ln.split("\t")[1:])}
             for ln in names.splitlines() if ln.strip()]
    full = _run(base + tail, cwd)
    cap = int(args.get("max_chars", 20000))
    return {"status": "ok", "files": files, "file_count": len(files),
            "diff": full[:cap], "truncated": len(full) > cap}


def log(args=None):
    args = args or {}
    cwd = args.get("cwd", ".")
    n = int(args.get("n", 15))
    if not is_repo(cwd):
        return {"status": "error", "reason": "not a git repository"}
    fmt = "%h\x1f%an\x1f%ad\x1f%s"
    out = _run(["log", f"-n{n}", "--date=short", f"--pretty={fmt}"], cwd)
    commits = []
    for ln in out.splitlines():
        parts = ln.split("\x1f")
        if len(parts) == 4:
            commits.append({"hash": parts[0], "author": parts[1],
                            "date": parts[2], "subject": parts[3]})
    return {"status": "ok", "count": len(commits), "commits": commits}


def branches(args=None):
    cwd = (args or {}).get("cwd", ".")
    if not is_repo(cwd):
        return {"status": "error", "reason": "not a git repository"}
    out = _run(["branch", "--all", "--no-color"], cwd)
    all_b = [ln[2:].strip() for ln in out.splitlines() if ln.strip()]
    return {"status": "ok", "current": current_branch(cwd), "branches": all_b}


def show(args=None):
    args = args or {}
    cwd = args.get("cwd", ".")
    ref = args.get("ref", "HEAD")
    if not is_repo(cwd):
        return {"status": "error", "reason": "not a git repository"}
    out = _run(["show", "--stat", "--no-color", ref], cwd)
    return {"status": "ok", "ref": ref, "text": out[:20000]}


def review(args=None):
    """A reviewer-friendly view of the working changes: which files changed and
    the full (capped) diff. Read-only — pair it with the 'reviewer' role."""
    args = args or {}
    cwd = args.get("cwd", ".")
    st = status({"cwd": cwd})
    if st.get("status") != "ok":
        return st
    unstaged = diff({"cwd": cwd})
    staged = diff({"cwd": cwd, "staged": True})
    return {"status": "ok", "branch": st["branch"],
            "summary": {"staged": st["staged"], "unstaged": st["unstaged"],
                        "untracked": st["untracked"]},
            "staged_files": staged.get("files", []),
            "unstaged_files": unstaged.get("files", []),
            "diff": (staged.get("diff", "") + "\n" + unstaged.get("diff", "")).strip(),
            "note": "Read-only review. Committing/pushing stays behind the approval gate."}
