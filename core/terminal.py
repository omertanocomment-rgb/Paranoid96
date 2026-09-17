"""
A real terminal, inside the app. No Termux.

Android gives an app a working `/system/bin/sh` and, on every device I have
seen, a usable `/dev/ptmx`. That is everything a terminal needs, so this spawns
a genuine PTY-backed shell in the app's own process group and streams it over
plain HTTP — no websocket, matching the rest of OMERTA's wire protocol.

Where a PTY is unavailable (a locked-down device, an odd kernel) it degrades to
pipes instead of failing. You lose job control and full-screen TUIs; ordinary
commands still work, and `mode` in the session info says which you got.

Two things worth being explicit about:

  * **This is you typing, not the agent acting.** The approval gate exists to
    stop the *model* from doing things you did not sanction. A terminal you
    typed into yourself is direct operation of your own device, so it does not
    prompt for every command — that would be absurd.
  * **The hard-deny list still applies by default.** `rm -rf /` is refused here
    too, because it is unrecoverable and almost always a typo or a mistake.
    Set OMERTA_TERM_GUARD=0 if you genuinely need to run one; the refusal
    message says so. Every command is logged either way.
"""
import fcntl
import os
import re
import signal
import termios
import shutil
import threading
import subprocess
import time
import uuid

from . import config, sandbox

SESSIONS = {}
_lock = threading.Lock()

MAX_SCROLLBACK = int(config.get("OMERTA_TERM_SCROLLBACK", 20000))
IDLE_TIMEOUT = int(config.get("OMERTA_TERM_IDLE_TIMEOUT", 3600))
MAX_SESSIONS = int(config.get("OMERTA_TERM_MAX_SESSIONS", 8))


def guarded():
    return config.flag("OMERTA_TERM_GUARD", "1")


def _shell():
    """The best shell available, preferring a real login shell."""
    for cand in (config.get("OMERTA_TERM_SHELL"), os.environ.get("SHELL"),
                 "/bin/bash", "/system/bin/sh", "/bin/sh", "sh"):
        if not cand:
            continue
        path = shutil.which(cand) if not cand.startswith("/") else (
            cand if os.path.exists(cand) else None)
        if path:
            return path
    return "/bin/sh"


def _become_session_leader(slave_fd):
    """Build the child-side setup that gives the shell a CONTROLLING terminal.

    setsid() alone is not enough, and the difference is visible: the shell
    starts, prints

        open /dev/tty: No such device or address
        warning: won't have full job control

    and then cannot stop a job, cannot Ctrl-C into the foreground process
    group, and cannot run anything that opens /dev/tty (an editor, a password
    prompt, less). setsid() detaches the child into a brand new session with
    NO controlling terminal; something then has to attach one, and on Linux
    that is TIOCSCTTY on the pty slave, issued by the session leader.

    Runs in the forked child between fork and exec, so it must stay small and
    must not raise into the parent -- a failure here should cost job control,
    not the whole terminal.
    """
    def setup():
        os.setsid()
        try:
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        except OSError:
            # Degrade exactly as before rather than killing the session: the
            # shell still runs, it just warns about job control.
            pass
    return setup


class Session:
    """One shell. Output is accumulated into a bounded buffer that clients read
    by offset, so a dropped or slow poller never loses or duplicates bytes."""

    def __init__(self, cwd=None, cols=80, rows=24, env=None):
        self.id = uuid.uuid4().hex[:12]
        self.shell = _shell()
        self.cols, self.rows = int(cols), int(rows)
        self.cwd = cwd or os.path.expanduser(config.get("OMERTA_TERM_CWD", "~"))
        if not os.path.isdir(self.cwd):
            self.cwd = os.path.expanduser("~")
        self.buf = bytearray()
        self.dropped = 0              # bytes discarded off the front of buf
        self.created = time.time()
        self.last_used = self.created
        self.exit_code = None
        self.closing = False
        self.mode = "pty"
        self._fd = None
        self._buflock = threading.Lock()

        environ = dict(os.environ)
        environ.update({
            "TERM": "xterm-256color", "LANG": environ.get("LANG", "en_US.UTF-8"),
            "COLUMNS": str(self.cols), "LINES": str(self.rows),
            "PS1": r"\[\e[91m\]omerta\[\e[0m\]:\w\$ ",
            "OMERTA_TERMINAL": "1",
        })
        # The bundled BusyBox, if this device has it. Done here rather than in
        # the process environment so it applies to the terminal without
        # changing PATH for the agent's own tool calls.
        try:
            from . import toolbox
            environ["PATH"] = toolbox.path_with_tools(environ.get("PATH"))
            environ.update(toolbox.python_env())
        except Exception:  # noqa: BLE001 -- no toolset is not a broken terminal
            pass
        environ.update(env or {})
        # never hand the agent's own auth token to an interactive shell
        environ.pop("OMERTA_TOKEN", None)

        try:
            import pty
            self._fd, slave = pty.openpty()
            try:
                self._set_winsize(self.rows, self.cols)
            except Exception:                      # noqa: BLE001 — cosmetic
                pass
            self.proc = subprocess.Popen(
                [self.shell, "-i"], preexec_fn=_become_session_leader(slave),
                cwd=self.cwd, env=environ,
                stdin=slave, stdout=slave, stderr=slave, close_fds=True)
            os.close(slave)
            self._reader = threading.Thread(target=self._pump_pty, daemon=True)
        except Exception:                          # noqa: BLE001
            # No /dev/ptmx, or pty unavailable. Pipes still give a usable shell.
            self.mode = "pipe"
            self._fd = None
            self.proc = subprocess.Popen(
                [self.shell], cwd=self.cwd, env=environ,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, close_fds=True, bufsize=0)
            self._reader = threading.Thread(target=self._pump_pipe, daemon=True)
        self._reader.start()

    # ── output plumbing ──────────────────────────────────────────────────
    def _append(self, chunk):
        with self._buflock:
            self.buf += chunk
            if len(self.buf) > MAX_SCROLLBACK:
                cut = len(self.buf) - MAX_SCROLLBACK
                del self.buf[:cut]
                self.dropped += cut

    def _pump_pty(self):
        fd = self._fd
        try:
            while True:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                self._append(chunk)
        finally:
            # The reader owns the master fd for its whole life and closes it
            # itself. Closing it from close() while this thread is parked in
            # os.read() frees the number for the next openpty(), and then THIS
            # thread reads the next session's output and swallows it.
            self._fd = None
            try:
                os.close(fd)
            except OSError:
                pass
        self._finish()

    def _pump_pipe(self):
        while True:
            chunk = self.proc.stdout.read(4096)
            if not chunk:
                break
            self._append(chunk)
        self._finish()

    def _finish(self):
        try:
            self.exit_code = self.proc.wait(timeout=5)
        except Exception:                          # noqa: BLE001
            self.exit_code = self.proc.poll()
        self._append(f"\r\n[process exited with code {self.exit_code}]\r\n"
                     .encode())

    def _set_winsize(self, rows, cols):
        import fcntl
        import struct
        import termios
        fcntl.ioctl(self._fd, termios.TIOCSWINSZ,
                    struct.pack("HHHH", int(rows), int(cols), 0, 0))

    # ── input ────────────────────────────────────────────────────────────
    def write(self, data):
        self.last_used = time.time()
        if isinstance(data, str):
            data = data.encode("utf-8", "replace")
        if self.proc.poll() is not None:
            return {"status": "error", "reason": "session has exited"}
        if self._fd is not None:
            os.write(self._fd, data)
        else:
            self.proc.stdin.write(data)
            self.proc.stdin.flush()
        return {"status": "ok", "wrote": len(data)}

    # Ctrl-C as a control character, not as killpg. An interactive shell puts
    # the running command in its OWN process group; killpg on the shell's group
    # signals the shell (which ignores SIGINT) and leaves the command running.
    # Writing \x03 to the PTY lets the line discipline signal whichever group
    # is actually in the foreground — which is what the key does on a real tty.
    CTRL_CHARS = {"INT": b"\x03", "EOF": b"\x04", "QUIT": b"\x1c",
                  "TSTP": b"\x1a"}

    def send_signal(self, name):
        sigs = {"INT": signal.SIGINT, "TERM": signal.SIGTERM,
                "KILL": signal.SIGKILL, "QUIT": signal.SIGQUIT,
                "HUP": signal.SIGHUP, "TSTP": signal.SIGTSTP}
        # lstrip() strips CHARACTERS, not a prefix: "INT".lstrip("SIG") is "NT".
        want = str(name or "INT").upper()
        if want.startswith("SIG"):
            want = want[3:]

        if self._fd is not None and want in self.CTRL_CHARS:
            try:
                os.write(self._fd, self.CTRL_CHARS[want])
                self.last_used = time.time()
                return {"status": "ok", "sent": want, "via": "pty"}
            except OSError:
                pass                               # fall through to killpg

        sig = sigs.get(want)
        if sig is None:
            return {"status": "error", "reason": f"unknown signal {name!r}"}
        try:
            os.killpg(os.getpgid(self.proc.pid), sig)
        except Exception:                          # noqa: BLE001
            try:
                self.proc.send_signal(sig)
            except Exception as e:                 # noqa: BLE001
                return {"status": "error", "reason": str(e)}
        return {"status": "ok", "sent": want, "via": "signal", "signal": int(sig)}

    def resize(self, cols, rows):
        self.cols, self.rows = int(cols), int(rows)
        if self._fd is not None:
            try:
                self._set_winsize(self.rows, self.cols)
                os.killpg(os.getpgid(self.proc.pid), signal.SIGWINCH)
            except Exception:                      # noqa: BLE001
                pass
        return {"status": "ok", "cols": self.cols, "rows": self.rows}

    def read(self, offset=0):
        """Bytes from `offset` in the session's own byte stream. The client
        sends back the offset it reached, so polling is exactly-once."""
        self.last_used = time.time()
        with self._buflock:
            base = self.dropped
            total = base + len(self.buf)
            off = max(int(offset or 0), base)
            data = bytes(self.buf[off - base:])
        return {"status": "ok", "id": self.id, "offset": total,
                "truncated_before": base if int(offset or 0) < base else 0,
                "data": data.decode("utf-8", "replace"),
                "alive": self.proc.poll() is None, "exit_code": self.exit_code,
                "mode": self.mode}

    def close(self):
        """Stop the shell, then let the reader wind itself up.

        The order matters: kill first so the slave side closes and the master
        reports EOF, which is what makes the reader exit and release the fd.
        Never close the master here -- see _pump_pty.
        """
        self.closing = True
        for step in (lambda: os.killpg(os.getpgid(self.proc.pid), signal.SIGHUP),
                     self.proc.terminate, self.proc.kill):
            if self.proc.poll() is not None:
                break
            try:
                step()
            except Exception:                      # noqa: BLE001
                pass
            try:
                self.proc.wait(timeout=1.0)
            except Exception:                      # noqa: BLE001
                pass
        # wait for the reader to notice EOF and hand back the fd
        self._reader.join(timeout=3.0)
        if self._reader.is_alive():
            # It is wedged. Leaking one fd is strictly better than closing it
            # underneath a live reader and corrupting the next session.
            return {"status": "ok", "closed": self.id, "reader": "still running"}
        return {"status": "ok", "closed": self.id}

    def info(self):
        return {"id": self.id, "shell": self.shell, "mode": self.mode,
                "cols": self.cols, "rows": self.rows, "cwd": self.cwd,
                "alive": self.proc.poll() is None, "exit_code": self.exit_code,
                "created": self.created, "last_used": self.last_used,
                "bytes": self.dropped + len(self.buf)}


# ── the deny guard ───────────────────────────────────────────────────────
_LINE = re.compile(rb"[^\r\n]*[\r\n]")


def _refuse(text):
    """Hard-deny patterns are refused in the terminal too. Returns the matching
    pattern, or None. Only whole submitted lines are checked, so typing a
    substring of a deny pattern mid-edit never trips it."""
    if not guarded():
        return None
    # one matcher, shared with the agent's gate: `rm -rf /tmp/x` is ordinary
    # work, `rm -rf /` is not (see sandbox.denied_by)
    return sandbox.denied_by(text)


# ── session registry ─────────────────────────────────────────────────────
def _reap():
    now = time.time()
    for sid, s in list(SESSIONS.items()):
        dead = s.proc.poll() is not None
        idle = IDLE_TIMEOUT and (now - s.last_used) > IDLE_TIMEOUT
        if (dead and idle) or (idle and not dead):
            s.close()
            SESSIONS.pop(sid, None)


def open_session(args=None):
    a = args or {}
    with _lock:
        _reap()
        if len(SESSIONS) >= MAX_SESSIONS:
            return {"status": "error",
                    "reason": f"too many terminal sessions (max {MAX_SESSIONS})"}
        try:
            s = Session(cwd=a.get("cwd"), cols=a.get("cols", 80),
                        rows=a.get("rows", 24), env=a.get("env"))
        except Exception as e:                     # noqa: BLE001
            return {"status": "error", "reason": f"could not start a shell: {e}"}
        SESSIONS[s.id] = s
    out = {"status": "ok"}
    out.update(s.info())
    out["guard"] = guarded()
    try:
        from . import toolbox
        out["tools"] = toolbox.summary()
        py = toolbox.python_stats()
        out["python"] = f"python {py['version']}" if py["available"] else ""
    except Exception:  # noqa: BLE001
        out["tools"] = ""
    return out


def _get(sid):
    s = SESSIONS.get(sid)
    return s


def write(args):
    a = args or {}
    s = _get(a.get("id"))
    if not s:
        return {"status": "error", "reason": "no such terminal session"}
    data = a.get("data", "")
    hit = _refuse(data)
    if hit:
        msg = (f"\r\n\x1b[91mOMERTA refused: {hit!r} is on the hard-deny list.\x1b[0m"
               "\r\nIt is unrecoverable, so the terminal will not run it either."
               "\r\nSet OMERTA_TERM_GUARD=0 if you really mean it.\r\n")
        s._append(msg.encode())
        sandbox.log_event({"kind": "terminal_refused", "pattern": hit,
                           "session": s.id})
        return {"status": "denied_by_policy", "pattern": hit}
    if a.get("enter"):
        data = data + "\n"
    if data.strip():
        sandbox.log_event({"kind": "terminal_input", "session": s.id,
                           "data": data.rstrip("\n")})
    return s.write(data)


def read(args):
    a = args or {}
    s = _get(a.get("id"))
    if not s:
        return {"status": "error", "reason": "no such terminal session"}
    return s.read(a.get("offset", 0))


def signal_session(args):
    a = args or {}
    s = _get(a.get("id"))
    if not s:
        return {"status": "error", "reason": "no such terminal session"}
    return s.send_signal(a.get("signal", "INT"))


def resize(args):
    a = args or {}
    s = _get(a.get("id"))
    if not s:
        return {"status": "error", "reason": "no such terminal session"}
    return s.resize(a.get("cols", 80), a.get("rows", 24))


def close_session(args):
    a = args or {}
    with _lock:
        s = SESSIONS.pop(a.get("id"), None)
    if not s:
        return {"status": "error", "reason": "no such terminal session"}
    return s.close()


def list_sessions(args=None):
    with _lock:
        _reap()
        return {"status": "ok", "guard": guarded(), "shell": _shell(),
                "sessions": [s.info() for s in SESSIONS.values()]}


def shutdown_all():
    with _lock:
        for s in list(SESSIONS.values()):
            s.close()
        SESSIONS.clear()
    return {"status": "ok"}
