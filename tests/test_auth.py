"""Auth regression tests — including the X-Forwarded-For loopback bypass."""
import os, sys, subprocess, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from core import auth  # noqa: E402

def req(path="/api/status", headers=None, token=None):
    url = f"http://127.0.0.1:8799{path}" + (f"?token={token}" if token else "")
    r = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code

def main():
    env = dict(os.environ, OMERTA_PORT="8799")
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                req(); break
            except Exception:
                time.sleep(0.5)
        tok = auth.get_token()
        cases = [
            ("genuine loopback, no token",            {},                              None, 200),
            ("valid token",                           {},                              tok,  200),
            ("bad token from loopback (exempt)",      {},                        "garbage",  200),
            ("SPOOFED X-Forwarded-For loopback",      {"X-Forwarded-For": "127.0.0.1"}, None, 401),
            ("SPOOFED X-Real-IP loopback",            {"X-Real-IP": "127.0.0.1"},       None, 401),
            ("SPOOFED Forwarded header",              {"Forwarded": "for=127.0.0.1"},   None, 401),
            ("forwarded + valid token",               {"X-Forwarded-For": "127.0.0.1"}, tok,  200),
            ("remote-looking, no token",              {"X-Forwarded-For": "10.0.0.5"},  None, 401),
        ]
        ok = True
        for name, hdrs, t, expect in cases:
            got = req(headers=hdrs, token=t)
            mark = "✓" if got == expect else "✗"
            if got != expect:
                ok = False
            print(f"  {mark} {name:38} expected {expect}, got {got}")
        print("\n" + ("AUTH TESTS PASSED" if ok else "AUTH TESTS FAILED"))
        sys.exit(0 if ok else 1)
    finally:
        srv.terminate()
        srv.wait(timeout=10)

if __name__ == "__main__":
    main()
