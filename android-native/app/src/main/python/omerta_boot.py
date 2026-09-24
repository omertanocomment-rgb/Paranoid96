"""
Chaquopy bootstrap — the only module Java imports directly.

The agent's real code (core/, tools/, omerta_android.py) and its resources
(web UI, skills, plugins, persona) ship inside the APK as an asset payload and
are extracted to the app's private files dir on first launch. Java passes that
directory here; we put it on sys.path and hand off to omerta_android, so the
backend logic stays identical to every other platform — there is no
Android-specific fork of the agent.

This module is a PURE FORWARDER. Every signature here must mirror the
omerta_android function it calls, because Chaquopy's callAttr() binds
positionally: a parameter added downstream but not here raises TypeError at
launch and the app simply reports "backend didn't come up". That happened once
(native_lib_dir, shipped broken in 1.6.0-1.9.0), so scripts/audit.py now checks
this file's arity against both Java's call sites and omerta_android's
signatures, and the build refuses to package if they drift apart again.
"""
import os
import sys


def _wire(home_dir):
    if home_dir and home_dir not in sys.path:
        sys.path.insert(0, home_dir)


def start(files_dir, home_dir, port=8787, native_lib_dir=None):
    _wire(home_dir)
    try:
        os.chdir(home_dir)
    except OSError:
        pass
    import omerta_android
    return omerta_android.start(files_dir, home_dir, int(port), native_lib_dir)


def info(home_dir):
    _wire(home_dir)
    import omerta_android
    return omerta_android.info()


def stop(home_dir):
    _wire(home_dir)
    import omerta_android
    return omerta_android.stop()


def put_secret(files_dir, home_dir, key, value):
    _wire(home_dir)
    import omerta_android
    return omerta_android.put_secret(files_dir, key, value)


def diagnose(files_dir, home_dir, native_lib_dir=None):
    """Collect launch-failure evidence for the on-screen diagnostics panel.

    Called by Java only when start() has already failed, so it must never
    raise: every probe is reported as whatever it actually found, including
    the failure to probe. Reporting "unknown" honestly beats guessing.
    """
    import json
    import platform
    import traceback

    report = {}

    def probe(name, fn):
        try:
            report[name] = fn()
        except BaseException as e:  # noqa: BLE001 -- a probe must not kill the report
            report[name] = "ERROR: %s: %s" % (type(e).__name__, e)

    probe("python", lambda: sys.version.replace("\n", " "))
    probe("machine", platform.machine)
    probe("files_dir", lambda: files_dir)
    probe("home_dir", lambda: home_dir)
    probe("native_lib_dir", lambda: native_lib_dir or "(not passed)")
    probe("home_exists", lambda: os.path.isdir(home_dir))
    probe("payload_entries",
          lambda: sorted(os.listdir(home_dir))[:40] if os.path.isdir(home_dir) else [])
    probe("native_lib_count",
          lambda: len(os.listdir(native_lib_dir)) if native_lib_dir
          and os.path.isdir(native_lib_dir) else 0)

    _wire(home_dir)

    def import_backend():
        import omerta_android
        return "ok: " + os.path.basename(getattr(omerta_android, "__file__", "?"))

    probe("import_omerta_android", import_backend)

    def import_httpd():
        from core import httpd
        return "ok: " + os.path.basename(getattr(httpd, "__file__", "?"))

    probe("import_core_httpd", import_httpd)

    def retry_start():
        import omerta_android
        return omerta_android.start(files_dir, home_dir, 8787, native_lib_dir)

    try:
        report["retry_start"] = retry_start()
    except BaseException:  # noqa: BLE001
        report["retry_start"] = traceback.format_exc()[-2000:]

    return json.dumps(report, indent=2, default=str)
