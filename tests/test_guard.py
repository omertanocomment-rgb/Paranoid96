#!/usr/bin/env python3
"""Scheduling, the audit chain, the panic wipe and the engine preflight.

Each of these is a place where the easy implementation is the dishonest one,
so the tests are written against the dishonest version rather than the correct
one: a test that only passes on code that already works proves nothing.

  * A scheduled turn must go through the SAME approval gate as a typed one.
    The test drives a schedule whose turn returns a pending approval and
    checks the schedule records that it is WAITING, not that it ran.
  * The audit chain must break when a line is edited. The test edits one and
    fails if verification still passes.
  * The wipe must report what it could not remove. The test makes a target
    unremovable and fails if the result claims success.
  * The preflight must refuse a model larger than the process can address.
"""
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'OK' if cond else 'XX'} {label}")
    if not cond:
        fails.append(label)


def test_schedule(tmp):
    from core import schedule
    schedule.FILE = Path(tmp) / "schedules.json"

    seen = []

    def runner(payload):
        seen.append(payload)
        # An unattended turn that proposes something dangerous must stop
        # exactly where a typed one would.
        return {"text": "", "pending": {"action": "rm -rf /", "danger": True}}

    schedule._runner = runner

    bad = schedule.add({"text": "x", "every": 5})
    check("refuses a repeat faster than the floor",
          bad.get("status") == "error")

    job = schedule.add({"text": "check the build", "every": 3600,
                        "at": time.time() - 1})
    check("adds a schedule", job.get("status") == "ok")

    fired = schedule.run_due()
    check("runs what is due", len(fired) == 1 and len(seen) == 1)
    check("a scheduled turn goes through the approval gate",
          fired[0]["status"] == "awaiting approval")

    after = {j["id"]: j for j in schedule.listing()["jobs"]}[job["id"]]
    check("records that it is waiting, not that it acted",
          "awaiting" in after["last_status"])
    check("reschedules into the future", after["next"] > time.time())

    schedule.add({"text": "once", "every": 0, "at": time.time() - 1})
    schedule.run_due()
    check("a one-shot disables itself",
          not [j for j in schedule.listing()["jobs"]
               if j["text"] == "once" and j["enabled"]])

    check("deletes", schedule.remove({"id": job["id"]}).get("status") == "ok")


def test_chain():
    from core import attest

    entries = [{"cmd": "ls", "status": "ran"},
               {"cmd": "git push", "status": "ran"},
               {"cmd": "rm -rf /tmp/x", "status": "denied_by_user"}]
    head, rows = attest.chain(entries)
    check("a chain verifies against itself",
          attest.verify({"entries": rows, "head": head})["status"] == "ok")

    # Edit history: change what a command was, keep its digest.
    tampered = json.loads(json.dumps(rows))
    tampered[1]["entry"]["cmd"] = "git push --force"
    out = attest.verify({"entries": tampered, "head": head})
    check("an edited entry breaks the chain", out["status"] == "error")
    check("it says WHERE it broke", out.get("broken_at") == 1)

    dropped = [r for i, r in enumerate(json.loads(json.dumps(rows))) if i != 1]
    check("a removed entry breaks the chain",
          attest.verify({"entries": dropped, "head": head})["status"] == "error")

    # Re-chaining after an edit produces a DIFFERENT head, which is the whole
    # point of writing the head down somewhere else.
    edited = [r["entry"] for r in json.loads(json.dumps(rows))]
    edited[1]["cmd"] = "git push --force"
    new_head, _ = attest.chain(edited)
    check("rewriting the log changes the head", new_head != head)


def test_wipe(tmp):
    from core import config, wipe

    base = Path(tmp)
    config.DATA_DIR = base
    wipe.config.DATA_DIR = base
    (base / "chats").mkdir(parents=True, exist_ok=True)
    (base / "chats" / "a.json").write_text("{}", encoding="utf-8")
    (base / "secrets.json").write_text("{}", encoding="utf-8")

    check("the phrase is required",
          wipe.wipe({"confirm": "yes"}).get("status") == "error")
    check("a near miss is still a miss",
          wipe.wipe({"confirm": "wipe everything"}).get("status") == "error")
    check("nothing was removed by a refused wipe",
          (base / "secrets.json").exists())

    est = wipe.estimate()
    check("the estimate lists what would go", est["bytes"] > 0)

    out = wipe.wipe({"confirm": wipe.PHRASE})
    check("it wipes", out["status"] in ("ok", "partial"))
    check("the chats are gone", not (base / "chats").exists())
    check("the secrets are gone", not (base / "secrets.json").exists())

    # Now the honesty test: something that cannot be removed must be
    # REPORTED, not glossed over.
    (base / "chats").mkdir(parents=True, exist_ok=True)
    (base / "chats" / "held.json").write_text("{}", encoding="utf-8")
    real_rmtree = wipe.shutil.rmtree

    def refuse(path, *a, **kw):
        if str(path).endswith("chats"):
            raise OSError("device or resource busy")
        return real_rmtree(path, *a, **kw)

    wipe.shutil.rmtree = refuse
    try:
        out = wipe.wipe({"confirm": wipe.PHRASE})
    finally:
        wipe.shutil.rmtree = real_rmtree
    check("a failure is not reported as success", out["status"] == "partial")
    check("the failure names the item",
          any(f["name"] == "chats" for f in out["failed"]))


def test_preflight():
    from core import localai

    real_models = localai.models
    real_binary = localai.binary
    localai.binary = lambda: "/nonexistent/engine"
    # 6 GB of weights on a 32-bit process: not a RAM question, an address
    # space one, and the device having 8 GB does not help.
    localai.models = lambda: [{"name": "big.gguf", "path": "/tmp/big.gguf",
                               "bytes": 6 * 1024**3}]
    try:
        out = localai.preflight("big.gguf")
        if out["bits"] == 32:
            check("32-bit refuses weights it cannot address",
                  not out["ok"] and any("32-bit" in b for b in out["blockers"]))
        else:
            check("preflight answers on 64-bit too", "ok" in out)
        check("it reports available memory", out["ram_available"] >= 0)

        localai.models = lambda: []
        out = localai.preflight()
        check("no model is a blocker, not a crash",
              not out["ok"] and any("gguf" in b for b in out["blockers"]))
    finally:
        localai.models = real_models
        localai.binary = real_binary


def test_routes():
    from core import dispatch, gitx

    for path in ("/api/wipe", "/api/git", "/api/audit/export"):
        st, _ = dispatch.handle("POST", path, {}, {}, local=False)
        check(f"{path} is refused from another machine", st == 403)

    st, body = dispatch.handle("GET", "/api/schedule", {}, None, local=True)
    check("/api/schedule answers locally", st == 200 and "jobs" in body)

    # gitx must stay read-only: the module refuses anything that could write.
    try:
        gitx._run(["commit", "-m", "x"])
        check("gitx refuses a writing subcommand", False)
    except gitx.GitError:
        check("gitx refuses a writing subcommand", True)


def main():
    print("=== schedules, audit chain, panic wipe, preflight ===")
    with tempfile.TemporaryDirectory() as tmp:
        test_schedule(tmp)
    test_chain()
    with tempfile.TemporaryDirectory() as tmp:
        test_wipe(tmp)
    test_preflight()
    test_routes()

    if fails:
        print(f"\n{len(fails)} FAILED:")
        for f in fails:
            print("  -", f)
        return 1
    print("\nall good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
