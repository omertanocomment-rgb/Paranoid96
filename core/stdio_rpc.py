"""
The backend over a pipe, for a desktop shell that owns the Python process.

The Electron app used to start `server.py` on a port and point its window at
http://127.0.0.1:8787/. That put a listening socket on the machine for no
reason: the shell already owns the Python process, and the two are talking to
each other and nobody else. A port can be taken, can be firewalled, and is
reachable by anything else running as the same user.

So the shell spawns `omerta bridge` instead and talks to it over stdin/stdout.
One JSON object per line in, one per line out, each carrying an `id` so replies
can be matched to requests. Routing is core/dispatch, the same one the HTTP
server and the Android app use, so there is still one request layer and one
approval gate.

Requests are handled on worker threads. A chat turn can take a minute, and
handling requests one at a time would mean the UI's status poll queues behind
it -- the window would look frozen while the agent was working perfectly well.
Replies carry their id, so out-of-order completion is fine, and a lock makes
sure two threads never interleave halves of a line.

STDOUT IS THE PROTOCOL. Anything else that prints -- a library's warning, a
stray debug line -- would corrupt it, so the real stdout is taken away at
startup and everything else is pointed at stderr.
"""
import json
import sys
import threading
import traceback
from urllib.parse import urlparse, parse_qs

MAX_WORKERS = 8


class Bridge:
    def __init__(self, out_stream, workers=MAX_WORKERS):
        self._out = out_stream
        self._write_lock = threading.Lock()
        self._workers = workers
        self._slots = threading.Semaphore(workers)
        self._uploads = {}
        self._uploads_lock = threading.Lock()

    # ── wire ────────────────────────────────────────────────────────────
    def send(self, obj):
        line = json.dumps(obj, default=str)
        with self._write_lock:
            self._out.write(line + "\n")
            self._out.flush()

    # ── requests ────────────────────────────────────────────────────────
    def handle(self, msg):
        """Run one message. Always replies, whatever happens."""
        rid = msg.get("id")
        try:
            op = msg.get("op") or "request"
            if op == "request":
                status, body = self._request(msg)
            elif op == "attach_begin":
                status, body = 200, self._attach_begin(msg)
            elif op == "attach_chunk":
                status, body = 200, self._attach_chunk(msg)
            elif op == "attach_end":
                status, body = 200, self._attach_end(msg)
            elif op == "attach_abort":
                status, body = 200, self._attach_abort(msg)
            elif op == "asset":
                status, body = 200, self._asset(msg)
            elif op == "ping":
                status, body = 200, {"ok": True}
            else:
                status, body = 400, {"error": f"unknown op {op}"}
        except Exception as e:  # noqa: BLE001
            # A failure has to arrive as something the window can render. An
            # exception that only reaches stderr leaves the UI waiting forever.
            status, body = 500, {"error": f"{type(e).__name__}: {e}",
                                 "trace": traceback.format_exc()[-1500:]}
        self.send({"id": rid, "status": status, "body": body})

    def _request(self, msg):
        from . import dispatch
        parsed = urlparse(msg.get("path") or "/")
        return dispatch.handle(msg.get("method") or "GET", parsed.path,
                               query=parse_qs(parsed.query),
                               body=msg.get("body"), local=True)

    # ── uploads ─────────────────────────────────────────────────────────
    # Chunked for the same reason as on Android: the point of having no size
    # limit is that the file is never assembled anywhere.
    def _attach_begin(self, msg):
        from . import attach
        inc = attach.Incoming(msg.get("name") or "attachment",
                              project=msg.get("project") or None,
                              note=msg.get("note") or "")
        if inc.error:
            return {"error": inc.error}
        with self._uploads_lock:
            self._uploads[inc.id] = inc
        return {"id": inc.id}

    def _attach_chunk(self, msg):
        import base64
        with self._uploads_lock:
            inc = self._uploads.get(msg.get("upload"))
        if inc is None:
            return {"error": "no such upload"}
        try:
            inc.write(base64.b64decode(msg.get("data") or ""))
        except Exception as e:  # noqa: BLE001
            inc.error = f"{type(e).__name__}: {e}"
        return {"error": inc.error} if inc.error else {"written": inc.written}

    def _attach_end(self, msg):
        with self._uploads_lock:
            inc = self._uploads.pop(msg.get("upload"), None)
        if inc is None:
            return {"error": "no such upload"}
        try:
            return inc.finish(declared_size=int(msg.get("size") or 0) or None)
        except Exception as e:  # noqa: BLE001
            inc.abort()
            return {"error": f"{type(e).__name__}: {e}"}

    def _attach_abort(self, msg):
        with self._uploads_lock:
            inc = self._uploads.pop(msg.get("upload"), None)
        if inc is not None:
            inc.abort()
        return {"ok": True}

    # ── generated resources ─────────────────────────────────────────────
    def _asset(self, msg):
        """The theme stylesheet and its images, which are built rather than read.

        Base64 because this is a JSON line protocol and a stylesheet or a PNG
        is not guaranteed to be valid UTF-8. Returns an empty body rather than
        an error: a broken theme should cost the styling, not the page.
        """
        import base64
        path = msg.get("path") or ""
        try:
            from . import api
            if path == "/theme.css":
                return {"ctype": "text/css",
                        "data": base64.b64encode(
                            api.theme_css().encode("utf-8")).decode("ascii")}
            prefix = "/theme/asset/"
            if path.startswith(prefix):
                import os
                from . import theme
                p = theme.image_path(path[len(prefix):])
                if not p:
                    return {}
                ext = os.path.splitext(str(p))[1].lower()
                ctype = {".png": "image/png", ".jpg": "image/jpeg",
                         ".jpeg": "image/jpeg", ".gif": "image/gif",
                         ".webp": "image/webp"}.get(ext, "image/png")
                with open(p, "rb") as fh:
                    return {"ctype": ctype,
                            "data": base64.b64encode(fh.read()).decode("ascii")}
        except Exception:  # noqa: BLE001 -- styling must not take the UI down
            pass
        return {}

    # ── loop ────────────────────────────────────────────────────────────
    def drain(self, timeout=60):
        """Wait for in-flight requests before the process goes away.

        The workers are daemon threads, so without this the interpreter exits
        the moment stdin closes and any reply still being computed is simply
        never sent -- the shell would see its last request vanish. Taking every
        slot is the same as waiting for every worker to finish.
        """
        taken = 0
        for _ in range(self._workers):
            if not self._slots.acquire(timeout=timeout):
                break
            taken += 1
        for _ in range(taken):
            self._slots.release()

    def serve(self, in_stream):
        for raw in in_stream:
            raw = raw.strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                self.send({"id": None, "status": 400,
                           "body": {"error": "malformed request"}})
                continue
            if not isinstance(msg, dict):
                self.send({"id": None, "status": 400,
                           "body": {"error": "request must be an object"}})
                continue

            # Bound the workers: a UI that polls while a long turn runs should
            # not be able to spawn threads without limit.
            self._slots.acquire()

            def run(m=msg):
                try:
                    self.handle(m)
                finally:
                    self._slots.release()

            threading.Thread(target=run, daemon=True).start()


def run():
    """Serve until stdin closes, which is how the shell says it is done."""
    real_out = sys.stdout
    # Everything that is not a reply goes to stderr, or it corrupts the stream.
    sys.stdout = sys.stderr

    from . import api, mcp
    api.boot()
    try:
        mcp.connect_all()
    except Exception:  # noqa: BLE001 -- a bad connector must not stop the app
        traceback.print_exc()

    bridge = Bridge(real_out)
    bridge.send({"id": None, "status": 200, "body": {"ready": True}})
    try:
        bridge.serve(sys.stdin)
    except KeyboardInterrupt:
        pass
    finally:
        bridge.drain()
    return 0


if __name__ == "__main__":
    sys.exit(run())
