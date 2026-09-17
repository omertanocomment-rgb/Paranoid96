#!/usr/bin/env python3
"""Encrypted backup, the cost meter, and per-project approval policy.

The backup is the one feature where being wrong is unrecoverable: a file that
cannot be restored is worse than no backup, because it is trusted. So the test
is a real round trip — encrypt, wipe, restore, compare bytes — not a check
that the function returns ok.
"""
import json
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def fresh():
    for m in [m for m in list(sys.modules) if m.startswith("core")]:
        del sys.modules[m]


def main():
    print("=== backup / usage / per-project policy ===")
    tmp = tempfile.mkdtemp(prefix="omerta-bk-")
    data = Path(tmp) / "data"
    os.environ["OMERTA_DATA_DIR"] = str(data)
    fresh()
    try:
        from core import backup, usage, policy, sandbox

        # something worth losing
        (data / "chats").mkdir(parents=True, exist_ok=True)
        secret = "a sentence I would be upset to lose — éà中"
        (data / "chats" / "one.json").write_text(
            json.dumps({"messages": [{"role": "user", "content": secret}]}),
            encoding="utf-8")
        (data / "themes").mkdir(exist_ok=True)
        (data / "themes" / "mine.json").write_text('{"name":"mine"}',
                                                   encoding="utf-8")
        blob = os.urandom(200000)
        (data / "attachments").mkdir(exist_ok=True)
        (data / "attachments" / "big.bin").write_bytes(blob)

        est = backup.estimate()
        check("estimate finds the data", est["bytes"] > 200000)
        check("estimate says what it leaves out", bool(est["excluded"]))

        check("a short passphrase is refused",
              "error" in backup.create("short"))
        check("the refusal explains there is no recovery",
              "recovery" in backup.create("short")["error"])

        made = backup.create("a-good-long-passphrase")
        check("a backup is written", made.get("status") == "ok")
        path = made.get("path", "")
        check("the backup file exists", path and Path(path).is_file())
        check("the backup is not world-readable",
              (os.stat(path).st_mode & 0o077) == 0)

        # the archive must not be readable without the passphrase
        raw = Path(path).read_bytes()
        check("the secret is not in the file as plaintext",
              secret.encode("utf-8") not in raw)
        check("attachment bytes are not in the file as plaintext",
              blob[:64] not in raw)

        info = backup.inspect(path)
        check("the manifest is readable without the passphrase",
              info.get("status") == "ok" and "chats" in info.get("contains", []))

        check("a wrong passphrase is refused",
              "error" in backup.restore(path, "not-the-passphrase",
                                        into=str(Path(tmp) / "wrong")))
        check("the refusal does not distinguish wrong-key from corruption",
              "damaged" in backup.restore(path, "nope-nope-nope",
                                          into=str(Path(tmp) / "w2"))["error"])

        dry = backup.restore(path, "a-good-long-passphrase",
                             into=str(Path(tmp) / "dry"), dry_run=True)
        check("a dry run reports without writing", dry.get("status") == "ok"
              and not (Path(tmp) / "dry").exists())

        # the real thing: wipe, restore, compare
        shutil.rmtree(data)
        check("the data really is gone", not (data / "chats").exists())
        res = backup.restore(path, "a-good-long-passphrase")
        check("the restore succeeds", res.get("status") == "ok")
        back = (data / "chats" / "one.json")
        check("the chat comes back", back.is_file())
        # Compare the PARSED content, not the raw bytes: json.dumps escapes
        # non-ASCII by default, so the literal characters were never in the
        # file to begin with. Checking the text would have tested json's
        # escaping, not whether the backup preserved anything.
        restored = json.loads(back.read_text(encoding="utf-8")) if back.is_file() else {}
        check("the words come back exactly",
              restored.get("messages", [{}])[0].get("content") == secret)
        check("binary attachments come back byte-for-byte",
              (data / "attachments" / "big.bin").read_bytes() == blob)
        check("the theme comes back", (data / "themes" / "mine.json").is_file())

        # an archive is data, not a delivery mechanism
        evil = Path(tmp) / "evil.omerta"
        buf = Path(tmp) / "evil.tar.gz"
        with tarfile.open(buf, "w:gz") as tar:
            victim = Path(tmp) / "escape.txt"
            victim.write_text("pwned")
            tar.add(str(victim), arcname="../../escaped.txt")
        from core.chats import _derive, _encrypt
        import base64, secrets as _s
        salt = _s.token_bytes(16)
        env = {"format": backup.FORMAT,
               "salt": base64.b64encode(salt).decode(),
               "manifest": {"entries": ["x"]},
               "payload": _encrypt(_derive("a-good-long-passphrase", salt),
                                   buf.read_bytes())}
        evil.write_text(json.dumps(env))
        out = backup.restore(str(evil), "a-good-long-passphrase",
                             into=str(Path(tmp) / "target"))
        check("an archive entry that escapes the directory is refused",
              "error" in out and "escape" in out["error"])

        # ── the cost meter ───────────────────────────────────────────────
        usage.reset()
        usage.record("claude", "claude-sonnet-4-6", 1_000_000, 100_000, "p1",
                     estimated=True)
        usage.record("omerta", "qwen-local", 900_000, 400_000, "p1",
                     estimated=True)
        usage.record("openai", "a-model-with-no-published-price", 1000, 500,
                     "p2", estimated=True)
        s = usage.summary()
        t = s["total"]
        check("calls are counted", t["calls"] == 3)
        check("a local model costs nothing", abs(t["usd"] - 4.5) < 0.001)
        check("an unpriced model is counted, not guessed", t["unpriced"] == 1)
        check("estimates are labelled as estimates", t["estimated"] == 3)
        check("the note says the counts are estimated",
              "estimated" in s["note"])
        check("the note says unpriced calls are not guessed at",
              "guessed" in s["note"])
        check("per-project totals are kept", "p1" in s["projects"])
        check("metering never raises",
              usage.record(None, None, "x", None, None) is not None)

        # ── per-project policy ───────────────────────────────────────────
        fresh()
        from core import policy as pol, sandbox as sb
        check("a project inherits by default", pol.project_policy("proj") is None)
        pol.set_project_policy("scratch", pol.HIGH_RISK_ONLY)
        check("an override applies to that project",
              pol.current("scratch") == pol.HIGH_RISK_ONLY)
        check("other projects are untouched", pol.current("prod") == pol.ALWAYS)
        check("normal work auto-runs under the override",
              pol.auto_run("NORMAL", pol.current("scratch")) is True)
        check("normal work still asks elsewhere",
              pol.auto_run("NORMAL", pol.current("prod")) is False)
        # the guarantee that must survive every override
        for proj in ("scratch", "prod", "anything"):
            check(f"HIGH_RISK still asks in {proj}",
                  pol.auto_run(sb.Tier.HIGH_RISK, pol.current(proj)) is False)
            check(f"DENY still refuses in {proj}",
                  pol.auto_run(sb.Tier.DENY, pol.current(proj)) is False)
        pol.set_project_policy("scratch", "inherit")
        check("an override can be cleared",
              pol.project_policy("scratch") is None
              and pol.current("scratch") == pol.ALWAYS)
        check("an override needs a project name",
              "error" in pol.set_project_policy("", pol.ALWAYS))
    finally:
        os.environ.pop("OMERTA_DATA_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)
        fresh()

    print()
    if fails:
        print(f"BACKUP/USAGE TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("BACKUP/USAGE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
