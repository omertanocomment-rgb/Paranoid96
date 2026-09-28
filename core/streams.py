"""
Streaming a reply without giving every transport its own way to do it.

A model produces text over several seconds; showing it as it arrives is the
difference between an app that feels alive and one that looks hung. The usual
answer is server-sent events, which needs a live HTTP connection -- and this
agent runs over four transports, only one of which has one. The Android app
calls Python in-process, the desktop shell talks over a pipe, the GTK window
answers its own URI scheme. Three of them have nowhere to put an SSE stream.

So a turn runs on a thread and appends to a buffer, and the client polls for
whatever it has not seen, by offset. That is exactly how the terminal already
streams output (`/api/term/read`), so it is one pattern in the codebase rather
than two, and it works unchanged on every transport.

Offsets make the poll exactly-once: the client says how far it has read and
gets the rest, so a dropped or slow poll loses nothing and repeats nothing.
"""
import threading
import time
import uuid

#: How long a finished turn stays readable after its last poll. Long enough to
#: survive a backgrounded app coming back, short enough not to accumulate.
TTL = 300.0
MAX_LIVE = 32


class Turn:
    """One in-flight reply."""

    def __init__(self, stream_id):
        self.id = stream_id
        self.buf = []
        self.done = False
        self.result = None
        self.error = None
        self.started = time.time()
        self.touched = time.time()
        self._lock = threading.Lock()

    def write(self, chunk):
        if not chunk:
            return
        with self._lock:
            self.buf.append(str(chunk))

    def read(self, offset=0):
        """Text from `offset` onward, plus how far the caller has now read."""
        with self._lock:
            self.touched = time.time()
            text = "".join(self.buf)
        offset = max(0, int(offset or 0))
        return text[offset:], len(text)

    def finish(self, result=None, error=None):
        with self._lock:
            self.result = result
            self.error = error
            self.done = True
            self.touched = time.time()


_live = {}
_lock = threading.Lock()


def _reap():
    """Drop finished turns nobody is reading any more."""
    now = time.time()
    dead = [k for k, t in _live.items()
            if t.done and now - t.touched > TTL]
    # A client that vanished mid-turn would otherwise pin its buffer forever.
    if len(_live) - len(dead) > MAX_LIVE:
        oldest = sorted((t for k, t in _live.items() if k not in dead),
                        key=lambda t: t.touched)
        dead += [t.id for t in oldest[:len(_live) - len(dead) - MAX_LIVE]]
    for k in dead:
        _live.pop(k, None)


def start(work):
    """Run `work(write)` on a thread and return the id to poll.

    `work` is handed a callable that takes text chunks. Whatever it returns
    becomes the turn's result; whatever it raises becomes the turn's error, so
    a failure reaches the client as data rather than vanishing on a thread.
    """
    with _lock:
        _reap()
        turn = Turn(uuid.uuid4().hex[:16])
        _live[turn.id] = turn

    def run():
        try:
            turn.finish(result=work(turn.write))
        except BaseException as e:  # noqa: BLE001 -- must reach the client
            turn.finish(error=f"{type(e).__name__}: {e}")

    threading.Thread(target=run, name=f"omerta-turn-{turn.id}",
                     daemon=True).start()
    return turn.id


def poll(stream_id, offset=0):
    with _lock:
        turn = _live.get(stream_id)
    if turn is None:
        # Either a bad id or a turn that has aged out. Say so rather than
        # leaving the UI polling an empty stream forever.
        return {"error": "no such stream", "done": True, "offset": 0,
                "text": "", "result": None}
    text, now = turn.read(offset)
    out = {"text": text, "offset": now, "done": turn.done,
           "id": stream_id, "elapsed": round(time.time() - turn.started, 2)}
    if turn.done:
        out["result"] = turn.result
        if turn.error:
            out["error"] = turn.error
    return out


def cancel(stream_id):
    """Forget a turn. The thread is not killed -- it cannot be, safely -- but
    nothing is kept for it and its buffer stops growing in anyone's way."""
    with _lock:
        turn = _live.pop(stream_id, None)
    return {"ok": turn is not None}


def stats():
    with _lock:
        return {"live": sum(1 for t in _live.values() if not t.done),
                "held": len(_live)}
