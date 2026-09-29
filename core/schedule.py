"""
Turns that run without you.

A standing instruction -- "every morning, check the build" -- is a thing the
agent can genuinely do, because a turn is already a plain function call that
persists its own transcript. What was missing was a clock.

Two deliberate limits, both of which are the point rather than a shortcut:

  * A scheduled turn runs under the SAME approval policy as a typed one. It
    does not get a quieter gate for being unattended -- it gets the same gate
    and simply stops at it, leaving the approval waiting in the chat for when
    you come back. An agent that acts more freely when nobody is watching is
    the exact thing this project exists not to build.
  * The clock is a thread, not cron. There is no daemon on a phone, the
    process is killed when the app is swapped out, and pretending otherwise
    would promise a 3am run that cannot happen. A schedule that was missed
    while the process was dead runs once at the next start (if `catch_up` is
    on) and says that it was late.
"""
import json
import threading
import time

from . import config, sandbox

FILE = config.DATA_DIR / "schedules.json"
TICK = 30.0                       # how often the clock looks, in seconds
MIN_EVERY = 300                   # nothing may repeat faster than 5 minutes

_lock = threading.Lock()
_thread = None
_stop = threading.Event()
#: Injected by core.api so this module does not import it (api imports us).
_runner = None


def _load():
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"jobs": {}}
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), dict):
        return {"jobs": {}}
    return data


def _save(data):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def listing():
    data = _load()
    jobs = sorted(data["jobs"].values(), key=lambda j: j.get("next", 0))
    return {"status": "ok", "count": len(jobs), "jobs": jobs,
            "running": bool(_thread and _thread.is_alive()),
            "note": "These run only while OMERTA is running. A phone that "
                    "kills the app kills the clock with it; a missed run "
                    "happens at the next start and says it was late."}


def add(payload=None):
    p = payload or {}
    text = str(p.get("text", "")).strip()
    if not text:
        return {"status": "error", "reason": "a schedule needs something to say"}
    try:
        every = int(p.get("every", 0))
    except (TypeError, ValueError):
        return {"status": "error", "reason": "every must be a number of seconds"}
    if every and every < MIN_EVERY:
        return {"status": "error",
                "reason": f"nothing may repeat faster than {MIN_EVERY}s — a "
                          "model call every minute is a bill, not a schedule"}
    at = p.get("at")
    try:
        at = float(at) if at is not None else time.time() + (every or MIN_EVERY)
    except (TypeError, ValueError):
        return {"status": "error", "reason": "at must be a unix timestamp"}

    job = {
        "id": p.get("id") or f"job{int(time.time() * 1000) % 10**10:x}",
        "text": text[:4000],
        "project": p.get("project", "general"),
        "every": every,
        "next": at,
        "enabled": bool(p.get("enabled", True)),
        "catch_up": bool(p.get("catch_up", True)),
        "created": time.time(),
        "runs": 0,
        "last": None,
        "last_status": "",
    }
    data = _load()
    data["jobs"][job["id"]] = job
    _save(data)
    start()
    return {"status": "ok", **job}


def update(payload=None):
    p = payload or {}
    data = _load()
    job = data["jobs"].get(p.get("id", ""))
    if not job:
        return {"status": "error", "reason": "no such schedule"}
    for key in ("text", "project", "every", "next", "enabled", "catch_up"):
        if key in p:
            job[key] = p[key]
    _save(data)
    return {"status": "ok", **job}


def remove(payload=None):
    data = _load()
    job = data["jobs"].pop((payload or {}).get("id", ""), None)
    if not job:
        return {"status": "error", "reason": "no such schedule"}
    _save(data)
    return {"status": "ok", "deleted": job["id"]}


def due(now=None):
    now = now or time.time()
    data = _load()
    out = []
    for job in data["jobs"].values():
        if not job.get("enabled"):
            continue
        when = float(job.get("next") or 0)
        if when <= now:
            out.append(job)
    return out


def _reschedule(job, data, status, late):
    job["runs"] = int(job.get("runs", 0)) + 1
    job["last"] = time.time()
    job["last_status"] = ("late: " if late else "") + str(status)[:200]
    every = int(job.get("every") or 0)
    if every:
        # Skip forward past every window that elapsed while the process was
        # dead, rather than firing once per missed window in a burst.
        nxt = float(job.get("next") or time.time()) + every
        while nxt <= time.time():
            nxt += every
        job["next"] = nxt
        job["enabled"] = True
    else:
        job["enabled"] = False       # one-shot
    data["jobs"][job["id"]] = job


def run_due(now=None):
    """Run whatever is due. Returns what it did, for the caller to log."""
    now = now or time.time()
    fired = []
    for job in due(now):
        late = bool(job.get("next") and now - float(job["next"]) > TICK * 2)
        if late and not job.get("catch_up"):
            data = _load()
            _reschedule(job, data, "skipped (missed while not running)", True)
            _save(data)
            continue
        status = "no runner"
        if _runner is not None:
            try:
                result = _runner({"kind": "message", "text": job["text"],
                                  "project": job.get("project", "general")})
                status = "awaiting approval" if result.get("pending") else "ran"
            except Exception as e:                 # noqa: BLE001
                status = f"error: {e}"
        data = _load()
        _reschedule(job, data, status, late)
        _save(data)
        sandbox.log_event({"kind": "schedule_run", "id": job["id"],
                           "status": status, "late": late})
        fired.append({"id": job["id"], "status": status, "late": late})
    return fired


def _loop():
    while not _stop.wait(TICK):
        try:
            run_due()
        except Exception as e:                     # noqa: BLE001
            sandbox.log_event({"kind": "schedule_error", "error": str(e)})


def start(runner=None):
    """Start the clock. Idempotent; safe to call from every transport."""
    global _thread, _runner
    with _lock:
        if runner is not None:
            _runner = runner
        if _thread and _thread.is_alive():
            return False
        _stop.clear()
        _thread = threading.Thread(target=_loop, name="omerta-schedule",
                                   daemon=True)
        _thread.start()
        return True


def stop():
    _stop.set()


def stats():
    data = _load()
    jobs = list(data["jobs"].values())
    return {"jobs": len(jobs),
            "enabled": sum(1 for j in jobs if j.get("enabled")),
            "running": bool(_thread and _thread.is_alive())}
