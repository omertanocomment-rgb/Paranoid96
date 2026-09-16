"""Multi-device sync: three independent installs sharing one brain."""
import os, sys, json, shutil, tempfile, importlib, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def device(tmp, name):
    """Spin up an isolated 'install' with its own data dir."""
    d = os.path.join(tmp, name)
    os.makedirs(d, exist_ok=True)
    for m in list(sys.modules):
        if m.startswith("core"):
            del sys.modules[m]
    os.environ["OMERTA_DATA_DIR"] = d
    import core.config as cfg
    importlib.reload(cfg)
    cfg.DATA_DIR = __import__("pathlib").Path(d)
    cfg.MEMORY_DB = cfg.DATA_DIR / "memory.sqlite3"
    import core.memory as mem
    importlib.reload(mem)
    mem.DEVICE = None
    import core.sync as sy
    importlib.reload(sy)
    sy.STATE_FILE = cfg.DATA_DIR / "sync_state.json"
    mem.init()
    return mem, sy


def main():
    tmp = tempfile.mkdtemp()
    shared = os.path.join(tmp, "shared")
    ok = True

    def check(label, cond):
        nonlocal ok
        print(f"  {'✓' if cond else '✗'} {label}")
        ok = ok and cond

    # --- phone learns something
    mem, sy = device(tmp, "phone")
    mem.remember("Gradle needs JDK17 on this device", project="beats")
    mem.record_choice("fastboot erase userdata", "denied", project="rom",
                      note="never wipe without a backup")
    phone_id = mem.device()
    sy.sync_file(shared)
    print(f"  phone={phone_id} exported")

    # --- kali box syncs, gets the phone's knowledge
    mem, sy = device(tmp, "kali")
    kali_id = mem.device()
    mem.remember("Kali: libimobiledevice built from source", project="ios")
    r = sy.sync_file(shared)
    check("kali pulled phone's facts", any(x.get("facts_added", 0) >= 1
                                           for x in r["merged_from_peers"]))
    check("kali sees phone's JDK17 fact",
          any("JDK17" in f["content"] for f in mem.recall("gradle jdk", top_k=20)))
    check("kali inherited the DENIAL (safety travels)",
          mem.predict("fastboot erase boot", project="rom")["hint"] == "likely_deny")
    check("device ids differ", phone_id != kali_id)

    # --- windows box joins, gets BOTH
    mem, sy = device(tmp, "windows")
    sy.sync_file(shared)
    contents = [f["content"] for f in mem.recall("", top_k=50)]
    check("windows has phone fact", any("JDK17" in c for c in contents))
    check("windows has kali fact", any("libimobiledevice" in c for c in contents))
    check("windows inherited denial",
          mem.predict("fastboot erase all", project="rom")["hint"] == "likely_deny")

    # --- idempotency: syncing again changes nothing
    before = mem.stats()["facts"]
    sy.sync_file(shared); sy.sync_file(shared)
    check("re-sync is idempotent (no duplicates)", mem.stats()["facts"] == before)

    # --- tombstone: forget on windows must not be resurrected
    target = [f for f in mem.recall("gradle jdk", top_k=20) if "JDK17" in f["content"]][0]
    mem.forget(target["id"])
    check("forgotten locally", not any("JDK17" in f["content"]
                                       for f in mem.recall("gradle jdk", top_k=20)))
    time.sleep(0.01)
    sy.sync_file(shared, full=True)

    mem, sy = device(tmp, "phone")          # phone re-syncs; still has the old row
    sy.sync_file(shared)
    check("deletion propagated to phone (not resurrected)",
          not any("JDK17" in f["content"] for f in mem.recall("gradle jdk", top_k=20)))

    # --- bundle version guard
    bad = sy.merge_bundle({"version": 99, "facts": [], "choices": []})
    check("rejects newer bundle version", bad["status"] == "error")
    check("rejects garbage", sy.merge_bundle({"nope": 1})["status"] == "error")

    # --- a hostile/malformed bundle must return a clean error, never a traceback
    hostile = [
        {"version": 1, "device": "evil", "facts": [{"uid": "h1", "content": {"a": 1}}]},
        {"version": 1, "device": "evil", "facts": "notalist"},
        {"version": 1, "device": "evil", "facts": ["nope", {"uid": "h2", "content": "ok"}]},
        {"version": 1, "device": "evil", "facts": [
            {"uid": "h3", "content": "ok", "weight": "NaN",
             "created_at": "soon", "updated_at": float("inf")}]},
        {"version": 1, "device": "evil", "facts": [{"uid": "h3", "content": "again",
                                                    "created_at": "later"}]},
        {"version": "zzz", "device": "evil", "facts": []},
        {"version": 1, "device": "evil", "facts": [], "choices": [42, {"uid": "c1",
                                                                      "raw": {"k": 1}}]},
    ]
    crashed = None
    for b in hostile:
        try:
            r = sy.merge_bundle(b)
            assert r["status"] in ("ok", "error"), r
        except Exception as e:                       # noqa: BLE001 — that's the point
            crashed = f"{type(e).__name__}: {e}"
            break
    check("malformed bundles never raise (coerced or rejected)", crashed is None)

    over = {"version": 1, "device": "evil",
            "facts": [{"uid": str(i)} for i in range(sy.MAX_BUNDLE_ROWS + 1)]}
    check("oversize bundle refused before merging",
          sy.merge_bundle(over)["status"] == "error")

    sy.merge_bundle({"version": 1, "device": "evil",
                     "facts": [{"uid": "big", "content": "A" * (sy.MAX_TEXT_LEN * 4)}]})
    stored = [f for f in mem.recall("AAAA", top_k=50) if len(f["content"]) > 1000]
    check("oversized field truncated, not stored whole",
          all(len(f["content"]) <= sy.MAX_TEXT_LEN for f in stored))

    shutil.rmtree(tmp, ignore_errors=True)
    print("\n" + ("SYNC TESTS PASSED" if ok else "SYNC TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
