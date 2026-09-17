#!/usr/bin/env python3
"""Conversations must survive the process.

This exists because they did not. A conversation lived only inside the Agent
object; nothing ever wrote it anywhere, so Android reclaiming the service, a
reboot or a crash took the whole thing with it, mid-task, with no error and
nothing on disk to recover. The chat store had existed all along -- /api/chat
simply never called it.

The property under test is the one that was missing: after a turn, the words
are on disk, and a fresh process finds them.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def fresh_modules():
    """Reimport core as a new process would, so nothing is served from memory."""
    for m in [m for m in list(sys.modules) if m.startswith("core")]:
        del sys.modules[m]
    from core import api, chats            # noqa: F401
    return api, chats


def main():
    print("=== conversation persistence ===")
    tmp = tempfile.mkdtemp(prefix="omerta-persist-")
    os.environ["OMERTA_DATA_DIR"] = tmp
    try:
        api, chats = fresh_modules()

        # a turn, through the real entry point, with the model stubbed out
        from core import router
        router.complete = lambda messages, system="", max_tokens=None, \
            stream_cb=None: {"text": "the reply", "provider": "stub",
                             "model": "stub", "offline": True}

        res = api.chat({"project": "persist-test", "kind": "chat",
                        "text": "remember this exact sentence"})
        check("a turn produces a reply", bool(res.get("text")))
        check("the turn reports which chat it went into", bool(res.get("chat_id")))
        check("persisting did not error", "persist_error" not in res)
        cid = res.get("chat_id", "")

        # on disk, now, not at some later flush
        body = chats.load(cid)
        msgs = [m for m in (body.get("messages") or []) if isinstance(m, dict)]
        roles = [m.get("role") for m in msgs]
        check("the user message is on disk", "user" in roles)
        check("the assistant reply is on disk", "assistant" in roles)
        check("the exact words are on disk",
              any("remember this exact sentence" == m.get("content") for m in msgs))

        # the thing that actually failed: a NEW process must find it
        api2, chats2 = fresh_modules()
        agent = api2.get_agent("persist-test")
        contents = [m.get("content") for m in getattr(agent, "history", [])]
        check("a fresh process resumes the same chat",
              api2.current_chat("persist-test") == cid)
        check("a fresh process restores the conversation",
              "remember this exact sentence" in contents)

        # and a second turn continues the SAME chat rather than starting over
        from core import router as r2
        r2.complete = lambda messages, system="", max_tokens=None, \
            stream_cb=None: {"text": "second reply", "provider": "stub",
                             "model": "stub", "offline": True}
        res2 = api2.chat({"project": "persist-test", "kind": "chat",
                          "text": "second message"})
        check("a later turn continues the same chat", res2.get("chat_id") == cid)
        body2 = chats2.load(cid)
        check("both turns are kept, not overwritten",
              len(body2.get("messages") or []) >= 4)

        # a different project must not share the chat
        res3 = api2.chat({"project": "other-project", "kind": "chat",
                          "text": "different project"})
        check("a different project gets its own chat",
              res3.get("chat_id") and res3.get("chat_id") != cid)

        # a write failure must not cost the reply as well as the record
        chats2.append = lambda *a, **k: (_ for _ in ()).throw(OSError("disk full"))
        res4 = api2.chat({"project": "persist-test", "kind": "chat",
                          "text": "during a disk failure"})
        check("a failed write still returns the answer", bool(res4.get("text")))
        check("a failed write is reported, not swallowed",
              "persist_error" in res4)
    finally:
        os.environ.pop("OMERTA_DATA_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)
        for m in [m for m in list(sys.modules) if m.startswith("core")]:
            del sys.modules[m]

    print()
    if fails:
        print(f"PERSISTENCE TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PERSISTENCE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
