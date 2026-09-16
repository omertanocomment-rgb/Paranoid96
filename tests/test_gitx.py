"""Git intelligence: read-only queries + refusal of mutating subcommands."""
import os
import sys
import subprocess
import tempfile

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import gitx  # noqa: E402


def _new_repo():
    d = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=d, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=d, check=True)
    open(os.path.join(d, "a.txt"), "w").write("one\n")
    subprocess.run(["git", "add", "a.txt"], cwd=d, check=True)
    subprocess.run(["git", "commit", "-qm", "first"], cwd=d, check=True)
    return d


def test_readonly_guard():
    for bad in (["commit", "-m", "x"], ["reset", "--hard"], ["push"], ["clean", "-fd"]):
        try:
            gitx._run(bad, cwd=".")
            assert False, f"should have refused: {bad}"
        except gitx.GitError as e:
            assert "read-only" in str(e)
    print("  ✓ mutating git subcommands are refused (commit/reset/push/clean)")


def test_status_diff_log():
    d = _new_repo()
    assert gitx.is_repo(d) and not gitx.is_repo(tempfile.mkdtemp())
    st = gitx.status({"cwd": d})
    assert st["status"] == "ok" and st["dirty"] is False
    # make an unstaged change
    open(os.path.join(d, "a.txt"), "w").write("one\ntwo\n")
    st2 = gitx.status({"cwd": d})
    assert st2["dirty"] and st2["unstaged"] == 1, st2
    df = gitx.diff({"cwd": d})
    assert "two" in df["diff"] and df["file_count"] == 1
    lg = gitx.log({"cwd": d})
    assert lg["count"] == 1 and lg["commits"][0]["subject"] == "first"
    rv = gitx.review({"cwd": d})
    assert rv["status"] == "ok" and "a.txt" in [f["path"] for f in rv["unstaged_files"]]
    print("  ✓ status/diff/log/review report real repo state")


def test_self_repo_branch():
    if gitx.is_repo(ROOT):
        b = gitx.current_branch(ROOT)
        assert isinstance(b, str) and b
        print(f"  ✓ this repo branch resolved: {b}")
    else:
        print("  ✓ (skipped: not run inside a git repo)")


if __name__ == "__main__":
    test_readonly_guard()
    test_status_diff_log()
    test_self_repo_branch()
    print("\nGITX TESTS PASSED")
