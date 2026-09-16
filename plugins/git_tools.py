"""
Read-only git tools for the agent.

Wrappers over core.gitx so the agent can inspect a repo (status/diff/log/
review) without shelling out. All read-only; committing/pushing stays a shell
command through the approval gate.
"""
MANIFEST = {
    "name": "git_tools",
    "description": "Read-only git inspection: status, diff, log, branches, review.",
    "version": "1.0",
}


def _g():
    from core import gitx
    return gitx


def git_status(args):
    return _g().status(args)


def git_diff(args):
    return _g().diff(args)


def git_log(args):
    return _g().log(args)


def git_review(args):
    return _g().review(args)


def register():
    ro = {"side_effects": False}
    return {
        "git_status": {"fn": git_status, "description":
                       "Branch + staged/unstaged/untracked changes.",
                       "args": {"cwd": "repo dir"}, **ro},
        "git_diff": {"fn": git_diff, "description":
                     "Working diff (set staged=true for the index), with file list.",
                     "args": {"cwd": "repo dir", "staged": "bool", "paths": "optional"}, **ro},
        "git_log": {"fn": git_log, "description": "Recent commits (hash/author/date/subject).",
                    "args": {"cwd": "repo dir", "n": "count"}, **ro},
        "git_review": {"fn": git_review, "description":
                       "Reviewer view: changed files + full working diff. Read-only.",
                       "args": {"cwd": "repo dir"}, **ro},
    }
