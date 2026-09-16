"""
Chaquopy bootstrap — the only module Java imports directly.

The agent's real code (core/, tools/, omerta_android.py) and its resources
(web UI, skills, plugins, persona) ship inside the APK as an asset payload and
are extracted to the app's private files dir on first launch. Java passes that
directory here; we put it on sys.path and hand off to omerta_android, so the
backend logic stays identical to every other platform — there is no
Android-specific fork of the agent.
"""
import os
import sys


def _wire(home_dir):
    if home_dir and home_dir not in sys.path:
        sys.path.insert(0, home_dir)


def start(files_dir, home_dir, port=8787):
    _wire(home_dir)
    try:
        os.chdir(home_dir)
    except OSError:
        pass
    import omerta_android
    return omerta_android.start(files_dir, home_dir, int(port))


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
