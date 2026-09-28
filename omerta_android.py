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


_STATE = {"server": None, "thread": None, "token": None, "port": None,
          "ready": False}


def _want_http():
    """Should this app also listen on a socket?

    No, by default. The UI runs inside this process and calls `request()`
    directly, so a loopback server buys nothing and costs a great deal: a port
    that can be taken, a server that can fail to bind, and a listening socket
    on the device. Every "backend didn't come up" screen was a failure of that
    server, not of the agent.

    It stays available for one real use -- letting another machine on the LAN
    reach this backend -- and is off until someone asks for that.
    """
    from core import config
    return str(config.get("OMERTA_ANDROID_HTTP", "0")).lower() in ("1", "true", "yes")


def _bring_up():
    """Everything the server used to do on the way up, minus the server."""
    from core import api, mcp
    api.boot()
    try:
        mcp.connect_all()
    except Exception:  # noqa: BLE001 -- a bad connector must not stop the app
        pass
    try:
        for _label, _result in api.startup_sync():
            pass
    except Exception:  # noqa: BLE001
        pass
    _STATE["ready"] = True


def start(files_dir, home_dir, port=8787, native_lib_dir=None):
    """Bring the backend up. Returns a JSON string the Java side reads.

    {"running", "mode", "port", "token"} -- mode is "bridge" when the UI talks
    to Python in-process, "http" when a loopback server is also listening.
    """
    if _STATE["ready"]:
        return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                           "running": True,
                           "mode": "http" if _STATE["server"] else "bridge"})
    _prepare_env(files_dir, home_dir, port, native_lib_dir)
    # import lazily, AFTER the environment is in place
    from core import toolbox
    try:
        # Relink on every start: an app update moves the native library, and a
        # dangling symlink looks identical to a working one until it is run.
        data = os.path.join(files_dir, "data")
        toolbox.install(data)
        toolbox.install_python(data, payload=home_dir)
    except Exception:  # noqa: BLE001 -- a missing toolset must not stop the app
        pass

    if _want_http():
        from core import httpd
        srv, thread, token = httpd.serve_background()
        _STATE.update(server=srv, thread=thread, token=token,
                      port=srv.server_address[1], ready=True)
        return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                           "running": True, "mode": "http"})

    _bring_up()
    return json.dumps({"running": True, "mode": "bridge",
                       "port": None, "token": None})


def request(method, path, payload_json=""):
    """One request from the app's own UI, with no socket in the way.

    The WebView's fetch() is shimmed to call this instead of going out over
    HTTP. Because the caller IS this process, the request is local by
    definition and needs no token -- a token only means anything over a wire.

    Returns a JSON string {"status", "body"} so the JavaScript side can rebuild
    a Response from it. It never raises: an exception crossing the Chaquopy
    boundary surfaces in Java as a failed call with no context, so it is
    reported as a 500 with its text instead.
    """
    from urllib.parse import urlparse, parse_qs
    try:
        if not _STATE["ready"]:
            _bring_up()
        parsed = urlparse(path or "/")
        body = None
        if payload_json:
            try:
                body = json.loads(payload_json)
            except (ValueError, TypeError):
                body = None
        from core import dispatch
        status, out = dispatch.handle(method, parsed.path,
                                      query=parse_qs(parsed.query),
                                      body=body, local=True)
        return json.dumps({"status": status, "body": out}, default=str)
    except Exception as e:  # noqa: BLE001
        import traceback
        return json.dumps({
            "status": 500,
            "body": {"error": f"{type(e).__name__}: {e}",
                     "trace": traceback.format_exc()[-1200:]},
        })


def asset(path):
    """Serve a GENERATED resource to the app's WebView: "<ctype>|<base64>".

    Only the theme stylesheet and theme images come through here; everything
    else in the UI is a file on disk that Java reads directly. Base64 because
    the value crosses the Chaquopy boundary as a string, and a stylesheet or a
    PNG is not guaranteed to be valid UTF-8.

    Returns an empty body rather than raising: a broken theme should cost the
    styling, not the page.
    """
    import base64
    try:
        if not _STATE["ready"]:
            _bring_up()
        from core import api
        if path == "/theme.css":
            return "text/css|" + base64.b64encode(
                api.theme_css().encode("utf-8")).decode("ascii")
        prefix = "/theme/asset/"
        if path.startswith(prefix):
            from core import theme
            p = theme.image_path(path[len(prefix):])
            if not p:
                return "text/plain|"
            ext = os.path.splitext(str(p))[1].lower()
            ctype = {".png": "image/png", ".jpg": "image/jpeg",
                     ".jpeg": "image/jpeg", ".gif": "image/gif",
                     ".webp": "image/webp"}.get(ext, "image/png")
            with open(p, "rb") as fh:
                return ctype + "|" + base64.b64encode(fh.read()).decode("ascii")
    except Exception:  # noqa: BLE001 -- styling must not take the UI down
        pass
    return "text/plain|"


# ── chunked upload, straight from the WebView ───────────────────────────────
# An upload is the one request that cannot be a single call: the whole point is
# that a multi-gigabyte file never sits in memory. The page reads the file in
# slices and pushes them here, so only one slice is resident on either side --
# the same contract core/attach.Incoming already provides to the two servers.
_UPLOADS = {}


def attach_begin(name, project="", note=""):
    try:
        if not _STATE["ready"]:
            _bring_up()
        from core import attach
        inc = attach.Incoming(name, project=project or None, note=note or "")
        if inc.error:
            return json.dumps({"error": inc.error})
        _UPLOADS[inc.id] = inc
        return json.dumps({"id": inc.id})
    except Exception as e:  # noqa: BLE001
        return json.dumps({"error": f"{type(e).__name__}: {e}"})


def attach_chunk(upload_id, b64):
    import base64
    inc = _UPLOADS.get(upload_id)
    if inc is None:
        return json.dumps({"error": "no such upload"})
    try:
        inc.write(base64.b64decode(b64 or ""))
    except Exception as e:  # noqa: BLE001
        inc.error = f"{type(e).__name__}: {e}"
    if inc.error:
        return json.dumps({"error": inc.error})
    return json.dumps({"written": inc.written})


def attach_end(upload_id, declared_size=0):
    inc = _UPLOADS.pop(upload_id, None)
    if inc is None:
        return json.dumps({"error": "no such upload"})
    try:
        return json.dumps(inc.finish(declared_size=int(declared_size) or None),
                          default=str)
    except Exception as e:  # noqa: BLE001
        inc.abort()
        return json.dumps({"error": f"{type(e).__name__}: {e}"})


def attach_abort(upload_id):
    inc = _UPLOADS.pop(upload_id, None)
    if inc is not None:
        inc.abort()
    return json.dumps({"ok": True})


def is_running():
    if _STATE["server"]:
        return bool(_STATE["thread"] and _STATE["thread"].is_alive())
    # In bridge mode there is no thread to be alive: the backend is simply
    # importable and initialised, which is what "running" means here.
    return bool(_STATE["ready"])


def info():
    return json.dumps({"port": _STATE["port"], "token": _STATE["token"],
                       "running": is_running(),
                       "mode": "http" if _STATE["server"] else "bridge"})


def stop():
    srv = _STATE.get("server")
    if srv is not None:
        try:
            srv.shutdown()
        except Exception:  # noqa: BLE001
            pass
    _STATE.update(server=None, thread=None, ready=False)
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
