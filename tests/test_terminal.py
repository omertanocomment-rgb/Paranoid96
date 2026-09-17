"""
The in-app terminal. No Termux, no external runtime — a real shell in the
process, reachable over the same plain-HTTP protocol as everything else.

What these tests pin down:
  * it really is a PTY where the platform has one (`test -t 0` from inside)
  * output is read by offset, so polling never loses or duplicates bytes
  * Ctrl-C actually interrupts a running command
  * the hard-deny list applies to the terminal too, and the refusal is visible
  * a terminal is NEVER reachable from another machine, token or no token
"""
import os
import re
import sys
import json
import time
import threading
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("OMERTA_HOME", ROOT)

from core import terminal, config, auth, httpd  # noqa: E402

ok = True


def say(word):
    """A command whose ECHO does not contain `word` — only its OUTPUT does.

    A tty echoes what you type, so polling for a bare marker matches the echo
    and races the real output. Splitting the literal means the echoed line
    reads `echo "AL""IVE"` while the output is the marker itself, so a match
    can only be the command having actually run.
    """
    return f'echo "{word[:2]}""{word[2:]}"'


def check(label, cond):
    global ok
    ok = ok and bool(cond)
    print(f"  {'✓' if cond else '✗'} {label}")


class Term:
    """Drive a session the way a person does: wait for the prompt, then type.

    Two things make a naive harness flaky, and neither is a bug in the
    terminal:
      * a tty echoes what you type, so a bare marker matches the echo and
        races the real output -- hence say().
      * a tty DISCARDS pending input when SIGINT arrives, so a command
        written while the interrupt is in flight is dropped on the floor.
    Synchronising on a unique prompt removes both.
    """

    PROMPT = "<<OMERTA-PROMPT>>"

    def __init__(self, **kw):
        r = terminal.open_session(kw or {"cols": 100, "rows": 30})
        assert r["status"] == "ok", r
        self.info = r
        self.id = r["id"]
        self.off = 0
        self.drain(0.4)
        # a prompt we chose, so waiting for it is unambiguous
        terminal.write({"id": self.id,
                        "data": f"PS1='{self.PROMPT} '", "enter": True})
        self.until(self.PROMPT, 8.0)
        self.until(self.PROMPT, 1.0)      # swallow the echo's copy

    def drain(self, wait=0.1):
        time.sleep(wait)
        r = terminal.read({"id": self.id, "offset": self.off})
        self.off = r["offset"]
        return r["data"]

    def until(self, want, timeout=8.0):
        seen, deadline = "", time.time() + timeout
        while time.time() < deadline:
            seen += self.drain(0.05)
            if want in seen:
                return seen
        return seen

    def wait_prompt(self, timeout=8.0):
        return self.until(self.PROMPT, timeout)

    def run(self, cmd, wait=0.45):
        self.wait_prompt(3.0)
        terminal.write({"id": self.id, "data": cmd, "enter": True})
        return self.drain(wait)

    def run_until(self, cmd, want, timeout=8.0):
        self.wait_prompt(3.0)
        terminal.write({"id": self.id, "data": cmd, "enter": True})
        return self.until(want, timeout)

    def close(self):
        terminal.close_session({"id": self.id})


def test_shell():
    t = Term()
    check(f"a shell started ({t.info['shell']}, mode={t.info['mode']})",
          t.info["alive"])
    check("echo round-trips",
          "HELLO-OMERTA" in t.run_until(say("HELLO-OMERTA"), "HELLO-OMERTA"))

    # the thing that separates a terminal from a subprocess pipe
    out = t.run_until('test -t 0 && echo "IS""_TTY" || echo "NO""_TTY"', "_TTY")
    if t.info["mode"] == "pty":
        check("stdin is a real tty (PTY-backed)", "IS_TTY" in out)
    else:
        check("pipe fallback reported honestly as mode=pipe", "NO_TTY" in out)

    check("the shell keeps state between commands",
          "SECOND" in t.run_until('X="SEC""OND"; echo "$X"', "SECOND"))
    check("ANSI colour passes through untouched",
          "\x1b[" in t.run_until(r"printf '\033[91mR''ED\033[0m\n'", "RED"))
    check("stderr is interleaved, not lost",
          "ERRLINE" in t.run_until(say("ERRLINE") + " >&2", "ERRLINE"))
    t.close()


def test_offsets_are_exactly_once():
    t = Term()
    t.run_until(say("MARKER-ONE"), "MARKER-ONE")
    t.drain(0.3)                      # let the prompt land too
    before = t.off
    # reading from the same offset twice must not replay bytes
    a = terminal.read({"id": t.id, "offset": before})
    b = terminal.read({"id": t.id, "offset": before})
    check("re-reading the same offset is idempotent", a["data"] == b["data"])
    check("an offset read past the end returns nothing, not an error",
          terminal.read({"id": t.id, "offset": a["offset"]})["data"] == "")
    t.off = a["offset"]
    out = t.run_until(say("MARKER-TWO"), "MARKER-TWO")
    check("the next read returns only the new bytes",
          "MARKER-TWO" in out and "MARKER-ONE" not in out)
    t.close()


def test_interrupt():
    t = Term()
    if t.info["mode"] != "pty":
        check("interrupt test skipped (no PTY on this host)", True)
        return t.close()
    terminal.write({"id": t.id, "data": "sleep 30", "enter": True})
    t.until("sleep 30", 3.0)
    r = terminal.signal_session({"id": t.id, "signal": "INT"})
    check("Ctrl-C is delivered through the tty line discipline",
          r["status"] == "ok" and r.get("via") == "pty")
    # the shell prints ^C itself; then prove it is back at a prompt by
    # running something only a live shell could answer
    check("the shell returns to a prompt after the interrupt",
          t.PROMPT in t.wait_prompt(6.0))
    check("the shell is responsive again after the interrupt",
          "ALIVE" in t.run_until(say("ALIVE"), "ALIVE"))
    t.close()


def test_deny_guard():
    t = Term()
    check("the guard is on by default", terminal.guarded())
    deny = config.DENY_PATTERNS[0]
    r = terminal.write({"id": t.id, "data": deny, "enter": True})
    check(f"a hard-deny command is refused in the terminal ({deny!r})",
          r["status"] == "denied_by_policy")
    out = t.drain(0.2)
    check("the refusal is shown in the terminal, not swallowed",
          "refused" in out.lower())
    check("the shell survived the refusal and still works",
          "STILL-HERE" in t.run_until(say("STILL-HERE"), "STILL-HERE"))

    # a deny pattern ending in a path root means THAT root, not everything
    # under it -- `rm -rf /tmp/x` is ordinary work and must reach the shell
    r2 = terminal.write({"id": t.id, "data": "rm -rf /tmp/omerta-safe-probe",
                         "enter": True})
    check("`rm -rf /tmp/...` is NOT treated as `rm -rf /`", r2["status"] == "ok")
    for root in ("rm -rf /", "rm -rf /*", 'sh -c "rm -rf /"'):
        check(f"...but {root!r} still is",
              terminal.write({"id": t.id, "data": root, "enter": True})
              ["status"] == "denied_by_policy")
    t.close()


def test_limits_and_cleanup():
    check("scrollback is bounded", terminal.MAX_SCROLLBACK > 0)
    t = Term()
    t.run("head -c 200000 /dev/zero | tr '\\0' 'x' | head -c 200000", wait=1.2)
    info = [s for s in terminal.list_sessions()["sessions"] if s["id"] == t.id][0]
    with terminal._lock:
        held = len(terminal.SESSIONS[t.id].buf)
    check(f"a flood is trimmed to the scrollback cap (held {held} bytes)",
          held <= terminal.MAX_SCROLLBACK)
    check("the session survives being flooded", info["alive"])
    t.close()
    check("a closed session is gone from the registry",
          t.id not in terminal.SESSIONS)
    check("operating on a dead id errors cleanly, not with a traceback",
          terminal.read({"id": "nope"})["status"] == "error"
          and terminal.write({"id": "nope", "data": "x"})["status"] == "error"
          and terminal.close_session({"id": "nope"})["status"] == "error")


def test_terminal_is_local_only():
    """The load-bearing one: a valid token must NOT buy a remote shell."""
    srv = httpd.make_server(host="127.0.0.1", port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    token = auth.get_token()

    def call(path, body=None, spoof=None, method=None):
        url = f"http://127.0.0.1:{port}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method or
                                     ("POST" if data is not None else "GET"))
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Omerta-Token", token)
        if spoof:
            # claim to be a remote client: this is how a proxied request looks
            req.add_header("X-Forwarded-For", spoof)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    try:
        code, body = call("/api/term/open", {"cols": 80, "rows": 24})
        check("a loopback client can open a terminal", code == 200
              and body.get("status") == "ok")
        sid = body.get("id")

        # Same valid token, but the request presents as forwarded/remote.
        for path, payload, method in (
                ("/api/term/open", {}, "POST"),
                ("/api/term/write", {"id": sid, "data": "id\\n"}, "POST"),
                ("/api/term/signal", {"id": sid, "signal": "INT"}, "POST"),
                ("/api/term", None, "GET"),
                (f"/api/term/read?id={sid}&offset=0", None, "GET")):
            code, body2 = call(path, payload, spoof="203.0.113.9", method=method)
            check(f"a forwarded request is refused a shell: {method} {path.split('?')[0]}",
                  code in (401, 403))

        if sid:
            call("/api/term/close", {"id": sid})
    finally:
        srv.shutdown()
        terminal.shutdown_all()


if __name__ == "__main__":
    test_shell()
    test_offsets_are_exactly_once()
    test_interrupt()
    test_deny_guard()
    test_limits_and_cleanup()
    test_terminal_is_local_only()
    terminal.shutdown_all()
    print("\n" + ("TERMINAL TESTS PASSED" if ok else "TERMINAL TESTS FAILED"))
    sys.exit(0 if ok else 1)
