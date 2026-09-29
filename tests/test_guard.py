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


def test_project_keys(tmp):
    """A project's key must not be visible to another project, or to a
    concurrently running turn.

    Written against the obvious wrong implementation: swapping os.environ for
    the duration of a turn. That passes a single-threaded test and fails here,
    because core/api locks per project and therefore runs two projects at the
    same time.
    """
    import threading
    from core import config

    config.SECRETS_FILE = Path(tmp) / "secrets.json"
    config.put_secret("ANTHROPIC_API_KEY", "SHARED")
    config.put_secret("ANTHROPIC_API_KEY", "WORK-ONLY", project="work")

    check("the shared key is the default",
          config.secret("ANTHROPIC_API_KEY") == "SHARED")
    with config.scoped_to("work"):
        check("a scoped project sees its own key",
              config.secret("ANTHROPIC_API_KEY") == "WORK-ONLY")
    check("the scope is released",
          config.secret("ANTHROPIC_API_KEY") == "SHARED")
    with config.scoped_to("personal"):
        check("a project with no key of its own uses the shared one",
              config.secret("ANTHROPIC_API_KEY") == "SHARED")

    # The concurrency property: one thread inside a scope must not change what
    # another thread sees.
    seen = {}
    gate = threading.Event()
    done = threading.Event()

    def scoped_thread():
        with config.scoped_to("work"):
            gate.set()
            done.wait(2)
            seen["inside"] = config.secret("ANTHROPIC_API_KEY")

    t = threading.Thread(target=scoped_thread)
    t.start()
    gate.wait(2)
    seen["other"] = config.secret("ANTHROPIC_API_KEY")
    done.set()
    t.join(3)
    check("another thread does not see the scoped key",
          seen.get("other") == "SHARED")
    check("the scoped thread still sees its own",
          seen.get("inside") == "WORK-ONLY")

    # Removing a project's key must NOT silently fall back to the shared one:
    # the project was moved off that account deliberately.
    config.put_secret("ANTHROPIC_API_KEY", "", project="work")
    config.put_secret("OPENAI_API_KEY", "OTHER-WORK", project="work")
    with config.scoped_to("work"):
        check("a project with its own keys does not inherit a missing one",
              config.secret("ANTHROPIC_API_KEY") == "")
        check("its other key still works",
              config.secret("OPENAI_API_KEY") == "OTHER-WORK")
        # A host is not a credential: where the local server lives is shared.
        check("a host override is not withheld",
              config.secret("OMERTA_OLLAMA_HOST", "fallback") == "fallback")

    check("the status reports names, never values",
          config.project_secret_keys("work") == ["OPENAI_API_KEY"])

    from core import api
    body = api.secret_status("work")
    check("the API never returns a secret value",
          "OTHER-WORK" not in json.dumps(body))

    config.put_secret("ANTHROPIC_API_KEY", "")


def test_pairing():
    """The one route that answers without a token.

    Written against every way this could be too generous: a standing endpoint,
    an offer that outlives its window, a code that works twice, unlimited
    guesses, a claim from off the network, and a status call that hands the
    code out.
    """
    from core import pairing, dispatch

    pairing.cancel()
    check("nothing answers with no offer open", not pairing.open_offer())
    st, _ = dispatch.handle("POST", "/api/pair/claim", {}, {"code": "AAAA2222"},
                            local=True, client_host="192.168.1.9")
    check("a claim with no offer is refused", st == 403)

    off = pairing.offer({"ttl": 60})
    code = off["raw"]
    check("an offer opens", pairing.open_offer())
    check("the code avoids characters people confuse",
          not set(code) & set("01OIL"))

    check("the status never carries the code",
          "code" not in pairing.status() and "raw" not in pairing.status())

    bad = pairing.claim({"code": "22223333"}, client_host="192.168.1.9")
    check("a wrong code is refused", bad["status"] == "error")
    check("a wrong code does not say why it was wrong",
          "expired" not in bad["reason"])

    off_net = pairing.claim({"code": code}, client_host="8.8.8.8")
    check("a claim from off the network is refused",
          off_net["status"] == "error")
    fwd = pairing.claim({"code": code}, client_host="192.168.1.9",
                        forwarded=True)
    check("a forwarded claim is refused", fwd["status"] == "error")

    # Typed off one screen onto another: spaces, case and the O/0 confusion.
    typed = " ".join([code[:4], code[4:]]).lower().replace("0", "O")
    ok = pairing.claim({"code": typed}, client_host="192.168.1.9")
    check("the code survives being typed by a human", ok["status"] == "ok")
    check("it hands back the token", bool(ok.get("token")))

    again = pairing.claim({"code": code}, client_host="192.168.1.9")
    check("a claimed code cannot be used twice", again["status"] == "error")
    check("the route stops answering once claimed", not pairing.open_offer())

    # The attempt cap.
    pairing.offer({"ttl": 60})
    for _ in range(pairing.MAX_ATTEMPTS):
        pairing.claim({"code": "22223333"}, client_host="192.168.1.9")
    check("the offer closes after too many guesses", not pairing.open_offer())

    # Expiry.
    pairing.offer({"ttl": 30})
    with pairing._lock:
        pairing._offer["expires"] = time.time() - 1
    check("an expired offer does not answer", not pairing.open_offer())
    pairing.cancel()

    # The offer itself is local-only: it must not be openable from elsewhere.
    st, _ = dispatch.handle("POST", "/api/pair/offer", {}, {}, local=False)
    check("an offer cannot be opened from another machine", st == 403)

    # And it must never be written down.
    from core import config
    disk = (Path(config.DATA_DIR) / "pairing.json")
    check("an offer is never persisted", not disk.exists())


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
    with tempfile.TemporaryDirectory() as tmp:
        test_project_keys(tmp)
    test_pairing()
    test_routes()

    if fails:
        print(f"\n{len(fails)} FAILED:")
        for f in fails:
            print("  -", f)
        return 1
    # The phrase the gate counts. A suite that passes silently is one the
    # gate cannot tell apart from a suite that never ran.
    print("\nALL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
