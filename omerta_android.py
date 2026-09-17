"""
Android in-process entry point (driven by Chaquopy from Java).

The APK ships a full CPython (via Chaquopy) plus this agent's pure-Python
modules and a small pip set (pyyaml, requests). Java calls `start()` once; we
configure the environment, then run the dependency-free `core.httpd` server on
a daemon thread bound to loopback. The WebView then loads
`http://127.0.0.1:<port>/` — no Termux, no terminal, no external process.

Everything that has a real shell (git, adb, fastboot, a build toolchain) still
runs through the approval gate exactly as on desktop; on a stock, non-rooted
phone those tools simply aren't present, and the agent reports that honestly
rather than pretending. Rooted / Termux-adjacent devices that do have them get
the full agent. The brain is a cloud provider (enter an API key in Settings)
or any reachable local model server.
"""
import os
import json


def _prepare_env(files_dir, home_dir, port, native_lib_dir=None):
    # These MUST be set before core.config is imported the first time, because
    # config reads the environment at import time.
    data_dir = os.path.join(files_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    os.environ.setdefault("OMERTA_DATA_DIR", data_dir)
    os.environ["OMERTA_HOME"] = home_dir            # extracted payload (assets)
    os.environ["OMERTA_HOST"] = "127.0.0.1"          # loopback only, on-device
    os.environ["OMERTA_PORT"] = str(port)
    os.environ["OMERTA_BUNDLED"] = "1"
    # the app binds to loopback, so it may accept a locally-posted API key
    os.environ["OMERTA_ALLOW_SECRET_API"] = "1"
    # a phone can't hold a huge prompt for a small local model; stay compact
    # unless the user overrides it from settings.json.
    os.environ.setdefault("OMERTA_COMPACT", "0")
    # HOME is often unset/again read-only in an app sandbox; keep tools honest.
    os.environ.setdefault("HOME", files_dir)
    if native_lib_dir:
        # Where the bundled BusyBox lives. See core/toolbox.py for why this is
        # the only place on the device we can execute anything from.
        os.environ["OMERTA_NATIVE_LIB_DIR"] = native_lib_dir


_STATE = {"server": None, "thread": None, "token": None, "port": None}


def start(files_dir, home_dir, port=8787, native_lib_dir=None):
    """Start (idempotently) the embedded backend. Returns a JSON string with
    {"port", "token", "running"} so the Java side can build the WebView URL."""
    if _STATE["server"] is not None:
        return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                           "running": True})
    _prepare_env(files_dir, home_dir, port, native_lib_dir)
    # import lazily, AFTER the environment is in place
    from core import toolbox
    try:
        # Relink on every start: an app update moves the native library, and a
        # dangling symlink looks identical to a working one until it is run.
        toolbox.install(os.path.join(files_dir, "data"))
    except Exception:  # noqa: BLE001 -- a missing toolset must not stop the app
        pass
    from core import httpd
    srv, thread, token = httpd.serve_background()
    _STATE.update(server=srv, thread=thread, token=token,
                  port=srv.server_address[1])
    return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                       "running": True})


def is_running():
    return bool(_STATE["server"] and _STATE["thread"] and _STATE["thread"].is_alive())


def info():
    return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                       "running": is_running()})


def stop():
    srv = _STATE.get("server")
    if srv is not None:
        try:
            srv.shutdown()
        except Exception:  # noqa: BLE001
            pass
    _STATE.update(server=None, thread=None)
    return True


def put_secret(files_dir, key, value):
    """Persist an API key / local-model host from native UI, no server needed."""
    os.environ.setdefault("OMERTA_DATA_DIR", os.path.join(files_dir, "data"))
    from core import config
    try:
        config.put_secret(key, value)
        return json.dumps({"ok": True, "key": key})
    except ValueError as e:
        return json.dumps({"ok": False, "error": str(e)})
