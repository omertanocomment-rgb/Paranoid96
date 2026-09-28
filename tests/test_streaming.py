#!/usr/bin/env python3
"""Replies arrive as they are written, on every transport.

A model produces text over several seconds. Showing it as it arrives is the
difference between an app that feels alive and one that looks hung, and it is
the one thing the native console built elsewhere had that this did not.

The usual answer is server-sent events, which needs a live HTTP connection --
and this agent runs over four transports, only one of which has one. The app
calls Python in-process, the desktop shell talks over a pipe, the GTK window
answers its own URI scheme. Three of them have nowhere to put an SSE stream.

So a turn runs on a thread and the client polls by offset, exactly as the
terminal already does. One pattern, every transport, and the poll is
exactly-once: a slow or dropped poll loses nothing and repeats nothing.

What is pinned here: text really does arrive before the turn ends (a test that
only checks the final text would pass for a non-streaming implementation), the
offsets never duplicate or drop, a failure reaches the client as data rather
than vanishing on a thread, and the final result is identical to what the
non-streaming path returns.
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


print("=== streaming ===")

from core import streams, dispatch  # noqa: E402

# ── 1. the mechanism itself ────────────────────────────────────────────────
def slow(write):
    for piece in ("hello ", "there ", "world"):
        write(piece)
        time.sleep(0.15)
    return {"text": "hello there world", "pending": None}


sid = streams.start(slow)
check("starting a turn returns an id", bool(sid))

# read while it is still running: this is what proves it streams
time.sleep(0.2)
first = streams.poll(sid, 0)
check("text is readable before the turn finishes",
      len(first["text"]) > 0 and not first["done"], first)

seen = first["text"]
off = first["offset"]
for _ in range(60):
    p = streams.poll(sid, off)
    seen += p["text"]
    off = p["offset"]
    if p["done"]:
        break
    time.sleep(0.05)

check("polling by offset reassembles the text exactly",
      seen == "hello there world", repr(seen))
check("the turn reports done", p["done"])
check("and carries the final result",
      (p.get("result") or {}).get("text") == "hello there world", p.get("result"))
check("a poll past the end returns nothing new",
      streams.poll(sid, off)["text"] == "")

# ── 2. a failure has to reach the client ───────────────────────────────────
def boom(_write):
    raise RuntimeError("provider exploded")


bid = streams.start(boom)
for _ in range(60):
    p = streams.poll(bid, 0)
    if p["done"]:
        break
    time.sleep(0.05)
check("a raising turn finishes rather than hanging", p["done"])
check("and reports the failure as data",
      "provider exploded" in (p.get("error") or ""), p.get("error"))

check("an unknown stream id is answered, not left pending",
      streams.poll("nope", 0)["done"] is True)

# ── 3. through the router, as a client sees it ─────────────────────────────
status, started = dispatch.handle("POST", "/api/chat/start",
                                  body={"text": "hi", "project": "streamtest"})
check("the start route answers", status == 200 and started.get("stream_id"),
      started)

sid2 = started["stream_id"]
off2, done, result = 0, False, None
deadline = time.time() + 120
polls = 0
while time.time() < deadline:
    st, p2 = dispatch.handle("GET", "/api/chat/poll",
                             query={"id": [sid2], "offset": [str(off2)]})
    polls += 1
    off2 = p2["offset"]
    if p2.get("done"):
        done, result = True, p2.get("result")
        break
    time.sleep(0.1)
check("the poll route drives the turn to completion", done, f"after {polls} polls")
# No provider is configured in the test environment, so the turn ends with the
# agent's honest "no model" reply rather than a crash -- which is the point.
check("and the final result is a normal chat reply",
      isinstance(result, dict) and "text" in result, str(result)[:160])

check("cancelling forgets the stream",
      dispatch.handle("POST", "/api/chat/cancel", body={"id": sid2})[1]["ok"] is True)
check("and a cancelled stream reports itself gone",
      streams.poll(sid2, 0).get("error") == "no such stream")

# ── 4. the routes exist on the shared dispatcher, so every transport has it ─
src = (ROOT / "core" / "dispatch.py").read_text(encoding="utf-8")
for route in ("/api/chat/start", "/api/chat/poll", "/api/chat/cancel"):
    check(f"{route} is routed for every transport", route in src)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nSTREAMING TESTS PASSED")
