"""Verify: agent proposes -> suspends -> nothing runs -> approve/deny works."""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import router, agent as agent_mod, memory, sandbox

# mock the model: first emit a tool call, then a final answer
SCRIPT = [
    '```tool\n{"tool":"run_shell","args":{"cmd":"touch /tmp/SHOULD_NOT_EXIST"}}\n```',
    'Done — the file was created.',
]
calls = {"n": 0}
def fake_complete(messages, system="", max_tokens=None, stream_cb=None):
    i = min(calls["n"], len(SCRIPT)-1); calls["n"] += 1
    return {"text": SCRIPT[i], "provider": "mock", "model": "mock", "offline": True}
agent_mod.router.complete = fake_complete

if os.path.exists('/tmp/SHOULD_NOT_EXIST'): os.remove('/tmp/SHOULD_NOT_EXIST')

a = agent_mod.Agent(project="safetytest")
r = a.turn("make a file")
print("1) pending:", r["pending"])
assert r["pending"], "FAIL: agent did not suspend for approval"
assert not os.path.exists('/tmp/SHOULD_NOT_EXIST'), "FAIL: command ran without approval!"
print("   -> nothing executed before approval  ✓")

# deny path
calls["n"] = 1
r2 = a.deny(note="don't touch /tmp")
assert not os.path.exists('/tmp/SHOULD_NOT_EXIST'), "FAIL: ran after denial!"
print("2) denied, still not executed  ✓")
print("   learned:", memory.predict("touch /tmp/x", project="safetytest"))

# approve path
calls["n"] = 0
a2 = agent_mod.Agent(project="safetytest")
r3 = a2.turn("make a file")
calls["n"] = 1
r4 = a2.approve()
assert os.path.exists('/tmp/SHOULD_NOT_EXIST'), "FAIL: approval did not execute"
print("3) approved -> executed  ✓")

# hard-deny path
p = sandbox.propose("rm -rf /")
print("4) hard-deny:", p["status"], "✓")
assert p["status"] == "denied_by_policy"

os.remove('/tmp/SHOULD_NOT_EXIST')

# 5) fork bombs, in every spelling.
#
# A fork bomb has no canonical form: `:(){ :|:& };:` and `:(){:|:&};:` are the
# same command, the function can be called anything, and the shell ignores the
# whitespace. The deny list held one literal spelling, so the ordinary spaced
# version classified as NORMAL -- approvable, and it takes the device down.
# Now the SHAPE is matched, so spacing and naming stop mattering.
# Found by scripts/audit.py on its first real run.
_bad = []
for _bomb in (":(){ :|:& };:", ":(){:|:&};:", ":() { : | : & }; :",
              "bomb(){ bomb|bomb& };bomb", "x() { x|x & };x"):
    if sandbox.classify(_bomb) != sandbox.Tier.DENY:
        _bad.append("fork bomb not denied: %r" % _bomb)
for _cmd in ("rm  -rf   /", "rm -rf  /"):
    if sandbox.classify(_cmd) != sandbox.Tier.DENY:
        _bad.append("whitespace variant not denied: %r" % _cmd)
# ...and ordinary work must still not be denied: a refusal cannot be approved,
# so a false positive is a bug the user has no way to work around.
for _ok in ("rm -rf /tmp/build", "rm -rf ./node_modules", "echo hello"):
    if sandbox.classify(_ok) == sandbox.Tier.DENY:
        _bad.append("false deny: %r" % _ok)
assert not _bad, "FAIL: " + "; ".join(_bad)
print("5) fork bombs denied in every spelling, real work still allowed  \u2713")

print("\nALL SAFETY TESTS PASSED")
