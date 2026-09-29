"""The on-device model: OMERTA's own brain, no API key and no second machine.

Until now OMERTA was the harness and you supplied the model -- a cloud API key,
or a server running somewhere else on your network. On a phone that second
option is not really offline: it means your PC has to be switched on. This
module closes that gap by running a llama.cpp server inside the app, against a
GGUF model file you drop on the device.

HOW IT RUNS AT ALL
------------------
Same constraint as the command-line toolset: Android denies execve() on
anything in an app's writable home, so the server binary is packaged as
`libllamaserver.so` under jniLibs and executed out of the native library
directory. See core/toolbox.py for the longer version.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It does not download a model for you. Model files are large, licensed in
different ways, and a background download that silently fills a phone's storage
is a bad surprise -- so importing one is an explicit act. `advice()` tells you
what to put where and what will actually run on your hardware.

It also does not pretend a phone is a workstation. `suggest_threads()` and the
default context size are chosen to leave the device usable and to avoid the
thermal throttling that makes a bigger setting slower than a smaller one.
"""
import os
import struct
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

from . import config

LIB_NAME = "libllamaserver.so"
DEFAULT_PORT = 8081
DEFAULT_CTX = 4096
HEALTH_TIMEOUT = 180          # a big model on a cold page cache is slow to load

_lock = threading.Lock()
_state = {
    "proc": None, "model": None, "port": None,
    "started": 0.0, "error": "", "log": [],
}


# ── locating the pieces ─────────────────────────────────────────────────────
def binary():
    """The bundled llama.cpp server, or None."""
    env = os.environ.get("OMERTA_NATIVE_LIB_DIR")
    cands = []
    if env:
        cands.append(Path(env) / LIB_NAME)
    here = Path(__file__).resolve().parent.parent
    cands.append(here / "android-native/app/src/main/jniLibs/arm64-v8a" / LIB_NAME)
    # a desktop build can use a llama-server on PATH instead
    which = shutil.which("llama-server")
    if which:
        cands.append(Path(which))
    for c in cands:
        if c.is_file():
            return c
    return None


def models_dir():
    d = Path(os.environ.get("OMERTA_MODELS_DIR")
             or (Path(config.DATA_DIR) / "models"))
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return d


def models():
    """Every GGUF on the device, largest last so the list reads predictably."""
    try:
        found = sorted(models_dir().glob("*.gguf"), key=lambda p: p.name.lower())
    except OSError:
        return []
    out = []
    for p in found:
        try:
            out.append({"name": p.name, "path": str(p), "bytes": p.stat().st_size})
        except OSError:
            continue
    return out


# ── sizing ──────────────────────────────────────────────────────────────────
def suggest_threads():
    """Threads to run with.

    Phones have big.LITTLE cores and a thermal budget: using every core makes
    the device hot, then throttled, then slower than a smaller setting would
    have been. Half the cores, capped at 4, is the setting that holds up over a
    long generation rather than winning the first ten seconds.
    """
    n = os.cpu_count() or 4
    return max(1, min(4, n // 2))


def memory_bytes():
    """Total and available RAM, or (0, 0) where the kernel will not say.

    /proc/meminfo is the only source that works on a stock Android handset
    without a permission, and MemAvailable is the figure that matters: MemFree
    on a phone is always small because the kernel is using the rest as cache,
    and refusing to start on MemFree would refuse on every device.
    """
    total = avail = 0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                key, _, rest = line.partition(":")
                value = rest.strip().split(" ")[0]
                if not value.isdigit():
                    continue
                if key == "MemTotal":
                    total = int(value) * 1024
                elif key == "MemAvailable":
                    avail = int(value) * 1024
                if total and avail:
                    break
    except OSError:
        return 0, 0
    return total, avail


def thermal_c():
    """The hottest thermal zone in degrees C, or None if none is readable."""
    hottest = None
    try:
        import glob as _glob
        for path in _glob.glob("/sys/class/thermal/thermal_zone*/temp"):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = int(f.read().strip())
            except (OSError, ValueError):
                continue
            # Some zones report millidegrees, some degrees. 1000 is not a
            # temperature either way, so the unit is inferred from magnitude.
            c = raw / 1000.0 if abs(raw) > 1000 else float(raw)
            if -40 < c < 150 and (hottest is None or c > hottest):
                hottest = c
    except Exception:                              # noqa: BLE001
        return None
    return hottest


def preflight(model=None):
    """Whether this device can actually run that model, before it tries.

    An engine that OOMs takes the whole app with it, and on a 32-bit build the
    process dies without a Python traceback -- the app simply vanishes, which
    reads to the owner as a crash with no cause. Checking first turns that into
    a sentence.
    """
    avail_models = models()
    chosen = None
    if model:
        for m in avail_models:
            if m["name"] == model or m["path"] == model:
                chosen = m
                break
    elif avail_models:
        chosen = avail_models[0]

    total, avail = memory_bytes()
    temp = thermal_c()
    bits = 8 * struct.calcsize("P")
    need = int(chosen["bytes"] * 1.25) if chosen else 0

    blockers, warnings = [], []
    if binary() is None:
        blockers.append("no on-device engine in this build "
                        "(libllamaserver.so not found)")
    if not avail_models:
        blockers.append(f"no .gguf model in {models_dir()}")
    elif chosen is None:
        blockers.append(f"model not found: {model}")

    if chosen and bits == 32 and need > 2 * 1024**3:
        blockers.append(
            f"{chosen['name']} needs about {need // 2**20} MB and this is a "
            "32-bit process, which cannot address that much no matter how "
            "much RAM the device has")
    if chosen and avail and need and need > avail:
        blockers.append(
            f"{chosen['name']} needs about {need // 2**20} MB and only "
            f"{avail // 2**20} MB is available right now")
    elif chosen and avail and need and need > avail * 0.75:
        warnings.append(
            f"this leaves under a quarter of available RAM free — expect the "
            "system to kill something, possibly OMERTA")
    if temp is not None and temp >= 45:
        warnings.append(f"the device is already at {temp:.0f}°C; generation "
                        "will throttle almost immediately")

    return {"status": "ok", "ok": not blockers,
            "blockers": blockers, "warnings": warnings,
            "model": chosen, "threads": suggest_threads(),
            "bits": bits, "ram_total": total, "ram_available": avail,
            "needs": need, "temperature_c": temp}


def advice():
    """What will actually run here, in plain terms."""
    return {
        "models_dir": str(models_dir()),
        "threads": suggest_threads(),
        "context": DEFAULT_CTX,
        "guidance": [
            "Put a .gguf file in the models directory shown above. Any tool "
            "that copies files onto the device will do; no import step.",
            "On a phone, a 3B model quantised to Q4_K_M (around 2 GB) is the "
            "sweet spot: it fits in memory, stays responsive, and is good "
            "enough for real work. Qwen2.5-Coder-3B is a good first choice.",
            "7B at Q4 (around 4.5 GB) runs on a phone with 8 GB or more of "
            "RAM, but expect it to be noticeably slower and to warm the device.",
            "Anything above 7B is not realistic on a handset. Point OMERTA at "
            "a machine on your network instead.",
            "The model file stays on your device. Nothing is uploaded, and no "
            "network is needed once the file is there.",
        ],
    }


# ── lifecycle ───────────────────────────────────────────────────────────────
def running():
    p = _state["proc"]
    return p is not None and p.poll() is None


def _wait_healthy(port, deadline):
    import requests
    url = f"http://127.0.0.1:{port}/health"
    while time.time() < deadline:
        if not running():
            return False, "the server exited while starting"
        try:
            r = requests.get(url, timeout=3)
            if r.status_code == 200:
                return True, ""
            # 503 means "loading the model" -- expected, keep waiting
        except requests.RequestException:
            pass
        time.sleep(1.0)
    return False, f"model did not finish loading within {HEALTH_TIMEOUT}s"


def start(model=None, port=None, ctx=None, threads=None):
    """Start the on-device server. Idempotent; returns a status dict."""
    with _lock:
        if running():
            return status()

        # Ask first whether this device can hold the weights. An engine that
        # OOMs takes the whole app with it, and on a 32-bit build the process
        # dies without a traceback -- the app simply vanishes, which reads to
        # the owner as a crash with no cause.
        pre = preflight(model)
        if pre["blockers"]:
            _state["error"] = "; ".join(pre["blockers"])
            return status()

        exe = binary()
        if exe is None:
            _state["error"] = ("no on-device engine in this build "
                               "(libllamaserver.so not found)")
            return status()

        avail = models()
        if not avail:
            _state["error"] = (f"no .gguf model found in {models_dir()} — "
                               "copy one there first")
            return status()

        chosen = None
        if model:
            for m in avail:
                if m["name"] == model or m["path"] == model:
                    chosen = m
                    break
            if chosen is None:
                _state["error"] = f"model not found: {model}"
                return status()
        else:
            want = config.get("OMERTA_LOCAL_GGUF", "")
            chosen = next((m for m in avail if m["name"] == want), avail[0])

        port = int(port or config.get("OMERTA_LOCALAI_PORT", DEFAULT_PORT))
        ctx = int(ctx or config.get("OMERTA_LOCALAI_CTX", DEFAULT_CTX))
        threads = int(threads or config.get("OMERTA_LOCALAI_THREADS",
                                            suggest_threads()))

        cmd = [str(exe), "--model", chosen["path"],
               "--host", "127.0.0.1", "--port", str(port),
               "--ctx-size", str(ctx), "--threads", str(threads)]
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, errors="replace",
                # its own process group, so stopping it cannot signal the app
                start_new_session=True)
        except OSError as e:
            _state["error"] = f"could not start the engine: {e}"
            return status()

        _state.update(proc=proc, model=chosen["name"], port=port,
                      started=time.time(), error="", log=[])
        threading.Thread(target=_drain, args=(proc,), daemon=True).start()

    ok, why = _wait_healthy(port, time.time() + HEALTH_TIMEOUT)
    if not ok:
        _state["error"] = why
        stop()
        return status()

    # Point the existing llama.cpp provider at the engine we just started, so
    # nothing downstream needs to know whether the server is ours or yours.
    os.environ["OMERTA_LLAMACPP_HOST"] = f"http://127.0.0.1:{port}"
    try:
        config.PROVIDERS["llamacpp"]["base_url"] = f"http://127.0.0.1:{port}"
        config.PROVIDERS["llamacpp"]["model"] = _state["model"]
    except Exception:  # noqa: BLE001
        pass
    return status()


def _drain(proc):
    """Keep the last of the engine's output: it explains its own failures."""
    try:
        for line in proc.stdout:
            log = _state["log"]
            log.append(line.rstrip())
            if len(log) > 200:
                del log[:len(log) - 200]
    except Exception:  # noqa: BLE001
        pass


def stop():
    with _lock:
        proc = _state["proc"]
        if proc is None:
            return status()
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            try:
                proc.terminate()
            except OSError:
                pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
        _state.update(proc=None, model=None, started=0.0)
        return status()


def status():
    return {
        "available": binary() is not None,
        "running": running(),
        "model": _state["model"] or "",
        "port": _state["port"],
        "uptime": round(time.time() - _state["started"], 1) if running() else 0,
        "models": models(),
        "models_dir": str(models_dir()),
        "threads": suggest_threads(),
        "error": _state["error"],
        "log": _state["log"][-30:],
    }


def stats():
    """The short form, for /api/status."""
    s = status()
    return {"available": s["available"], "running": s["running"],
            "model": s["model"], "models": len(s["models"]),
            "error": s["error"]}
