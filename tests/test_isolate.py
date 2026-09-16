"""Sandbox isolation wrapping + workspace snapshot/rollback."""
import os
import sys
import tempfile

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import isolate  # noqa: E402


def test_wrap_applies_limits_and_denies_net():
    cmd = "echo hi"
    w = isolate.wrap(cmd, net=False)
    assert "ulimit -t" in w and "ulimit -v" in w, w
    assert "echo hi" in w
    b = isolate.backend()
    if b == "bwrap":
        assert "--unshare-net" in w
    elif b == "firejail":
        assert "--net=none" in w
    # net allowed variant drops the deny flag
    w2 = isolate.wrap(cmd, net=True)
    assert ("--unshare-net" not in w2) and ("--net=none" not in w2)
    print(f"  ✓ wrap: resource limits present, net denied by default (backend={b})")


def test_wrapped_command_still_runs():
    # the limited (no-backend) wrapper must still execute a basic command
    import subprocess
    w = isolate.wrap("echo omerta-ok", net=True)
    out = subprocess.run(w, shell=True, capture_output=True, text=True, timeout=30)
    assert "omerta-ok" in out.stdout, out.stdout
    print("  ✓ wrapped command executes under ulimit")


def test_snapshot_rollback():
    d = tempfile.mkdtemp()
    f = os.path.join(d, "keep.txt")
    open(f, "w").write("original")
    open(os.path.join(d, "sub", "x.txt") if False else os.path.join(d, "b.txt"),
         "w").write("b")
    snap = isolate.snapshot(d, note="before edit")
    assert snap["status"] == "ok" and snap["files"] == 2, snap

    open(f, "w").write("CORRUPTED")
    os.remove(os.path.join(d, "b.txt"))

    r = isolate.rollback(snap["id"])
    assert r["status"] == "ok", r
    assert open(f).read() == "original", "rollback did not restore file content"
    assert os.path.exists(os.path.join(d, "b.txt")), "rollback did not restore deleted file"
    print("  ✓ snapshot then rollback restores edited + deleted files")


def test_status_shape():
    s = isolate.status()
    assert "backend" in s and "limits" in s and s["isolation_enabled"] in (True, False)
    assert "~/.ssh" in s["never_mount"]
    print(f"  ✓ status: backend={s['backend']}, isolation_enabled={s['isolation_enabled']}")


if __name__ == "__main__":
    test_wrap_applies_limits_and_denies_net()
    test_wrapped_command_still_runs()
    test_snapshot_rollback()
    test_status_shape()
    print("\nISOLATE TESTS PASSED")
