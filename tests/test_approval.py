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
print("\nALL SAFETY TESTS PASSED")
