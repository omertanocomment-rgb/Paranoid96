"""
Access control for the network-facing server.

The approval gate stops the *model* acting alone. It does nothing about a
second person on the same WiFi opening http://your-phone:8787 and tapping
RUN. On a device wired to a bootloader rig that's a real problem, so the
server requires a token.

Behaviour:
  - a token is generated on first run and stored in data/auth.json (0600)
  - it's printed to the console at startup so you can see it
  - clients pass it as ?token=... once; the server sets an httpOnly cookie
  - loopback-only connections can be exempted (default: yes, so the
    Electron shell and local CLI just work)
  - OMERTA_NO_AUTH=1 disables it entirely (don't, on a shared network)
"""
import json
import os
import secrets
import stat

from . import config

AUTH_FILE = config.DATA_DIR / "auth.json"
COOKIE = "omerta_token"


def _load():
    if AUTH_FILE.exists():
        try:
            return json.loads(AUTH_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def get_token():
    """Stable per-install token. Created once, reused forever."""
    data = _load()
    if "token" in data:
        return data["token"]
    data["token"] = secrets.token_urlsafe(24)
    AUTH_FILE.write_text(json.dumps(data, indent=2))
    try:
        os.chmod(AUTH_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        pass
    return data["token"]


def rotate():
    data = _load()
    data["token"] = secrets.token_urlsafe(24)
    AUTH_FILE.write_text(json.dumps(data, indent=2))
    try:
        os.chmod(AUTH_FILE, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return data["token"]


def enabled():
    return str(config.get("OMERTA_NO_AUTH", "0")).lower() not in ("1", "true", "yes")


def allow_loopback():
    return str(config.get("OMERTA_AUTH_LOOPBACK_FREE", "1")).lower() in ("1", "true", "yes")


def is_loopback(host):
    return host in ("127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1")


def check(request_token, client_host, spoofable=False):
    """True if this request may proceed.

    `spoofable` marks a request that arrived carrying forwarding headers
    (X-Forwarded-For / X-Real-IP). Such a request never gets the loopback
    exemption, because the apparent source address can't be trusted — it
    must present a valid token like any remote client.
    """
    if not enabled():
        return True
    if allow_loopback() and is_loopback(client_host) and not spoofable:
        return True
    return bool(request_token) and secrets.compare_digest(str(request_token), get_token())


def lan_urls(port):
    """Best-effort list of URLs to reach this server from other devices."""
    import socket
    urls = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        urls.append(f"http://{ip}:{port}/?token={get_token()}")
    except OSError:
        pass
    urls.append(f"http://127.0.0.1:{port}/")
    return urls
