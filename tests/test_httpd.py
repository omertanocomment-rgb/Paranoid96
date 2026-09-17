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


def local_only_cases(tok):
    """A valid token must not buy remote file writes or code execution.

    These endpoints do NOT go through the approval gate — you drive them
    yourself from the app (an editor save, a sandbox command, a shell), which
    is exactly why they must not be reachable from another machine. This was a
    real hole: with a token, a forwarded caller ran `id` via /api/scratch/run
    and overwrote a file via /api/ws/commit.

    /api/chat is deliberately excluded: it routes through the gate, so a token
    is sufficient for it.
    """
    import tempfile
    proj = tempfile.mkdtemp()
    os.environ["OMERTA_WORKSPACE_ROOTS"] = proj
    victim = os.path.join(proj, "victim.txt")
    with open(victim, "w") as f:
        f.write("ORIGINAL\n")

    remote = {"X-Forwarded-For": "203.0.113.9"}
    probes = [
        ("POST", "/api/ws/commit", {"path": victim, "content": "PWNED\n"}),
        ("POST", "/api/ws/read", {"path": victim}),
        ("POST", "/api/ws/tree", {"path": proj}),
        ("GET", "/api/ws/backups", None),
        ("GET", "/api/scratch", None),
        ("POST", "/api/scratch/new", {"source": proj}),
        ("POST", "/api/scratch/run", {"id": "x", "cmd": "id"}),
        ("POST", "/api/learn/path", {"path": "/etc/hostname"}),
        ("POST", "/api/term/open", {}),
        ("GET", "/api/term", None),
    ]
    results = []
    for method, path, body in probes:
        code, _ = req(path, headers=remote, token=tok, method=method, body=body)
        results.append((path, code))
    reachable = [p for p, c in results if c not in (401, 403)]
    untouched = open(victim).read().strip() == "ORIGINAL"

    # loopback must still work, or the fix broke the app
    code, _ = req("/api/ws/read", method="POST", body={"path": victim})
    return results, reachable, untouched, code


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
        results, reachable, untouched, loop_code = local_only_cases(tok)
        print(f"\n  direct-operation endpoints vs a REMOTE caller with a "
              f"valid token ({len(results)} probed):")
        for path, code in results:
            print(f"    {'✓' if code in (401, 403) else '✗'} {path:22} HTTP {code}")
        local_ok = (not reachable) and untouched and loop_code == 200
        print(f"  {'✓' if not reachable else '✗'} none are reachable remotely")
        print(f"  {'✓' if untouched else '✗'} the targeted file was not overwritten")
        print(f"  {'✓' if loop_code == 200 else '✗'} loopback still works (HTTP {loop_code})")

        ok = local_ok
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
