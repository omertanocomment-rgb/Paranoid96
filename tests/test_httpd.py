"""
Regression tests for the dependency-free embedded server (core/httpd.py).

This is the server that runs INSIDE the Android APK, so it must uphold the
exact same safety contract as the FastAPI server:
  * loopback is exempt, but a spoofed X-Forwarded-For never is
  * the chat protocol round-trips over plain HTTP
  * the secret API is gated (loopback + flag) and never leaks values
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PORT = 8793
os.environ["OMERTA_PORT"] = str(PORT)
os.environ["OMERTA_HOME"] = ROOT
os.environ["OMERTA_ALLOW_SECRET_API"] = "1"

from core import httpd, auth, agent as agent_mod, router  # noqa: E402


def fake_complete(messages, system="", max_tokens=None, stream_cb=None):
    return {"text": "ok from stdlib server", "provider": "mock",
            "model": "mock", "offline": True}


def req(path="/api/status", headers=None, token=None, method="GET", body=None):
    url = f"http://127.0.0.1:{PORT}{path}" + (f"?token={token}" if token else "")
    data = json.dumps(body).encode() if body is not None else None
    h = dict(headers or {})
    if data is not None:
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, headers=h, data=data, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def chat_roundtrip(msg):
    _, body = req("/api/chat", method="POST", body=msg)
    return json.loads(body.decode())


def main():
    router.complete = fake_complete
    agent_mod.router.complete = fake_complete
    srv, thread, _ = httpd.serve_background()
    try:
        for _ in range(40):
            try:
                req(); break
            except OSError:
                time.sleep(0.25)
        tok = auth.get_token()
        cases = [
            ("genuine loopback, no token",       {},                               None, 200),
            ("valid token",                      {},                               tok,  200),
            ("bad token from loopback (exempt)", {},                         "garbage",  200),
            ("SPOOFED X-Forwarded-For",          {"X-Forwarded-For": "127.0.0.1"}, None, 401),
            ("SPOOFED X-Real-IP",                {"X-Real-IP": "127.0.0.1"},       None, 401),
            ("SPOOFED Forwarded",                {"Forwarded": "for=127.0.0.1"},   None, 401),
            ("forwarded + valid token",          {"X-Forwarded-For": "127.0.0.1"}, tok,  200),
        ]
        ok = True
        for name, hdrs, t, expect in cases:
            got, _ = req(headers=hdrs, token=t)
            mark = "✓" if got == expect else "✗"
            if got != expect:
                ok = False
            print(f"  {mark} {name:34} expected {expect}, got {got}")

        # secret API: never leaks values, round-trips a write from loopback
        _, body = req("/api/secret")
        sec = json.loads(body)
        assert sec["enabled"] is True and "ANTHROPIC_API_KEY" in sec["set"]
        assert all(isinstance(v, bool) for v in sec["set"].values()), "secret VALUE leaked!"
        print("  ✓ secret status returns booleans only (no value leak)")

        # chat protocol round-trips over plain HTTP POST
        reply = chat_roundtrip({"kind": "message", "text": "hello",
                                "project": "general"})
        assert reply.get("text") == "ok from stdlib server", reply
        print("  ✓ POST /api/chat round-trip")

        print("\n" + ("HTTPD TESTS PASSED" if ok else "HTTPD TESTS FAILED"))
        sys.exit(0 if ok else 1)
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
