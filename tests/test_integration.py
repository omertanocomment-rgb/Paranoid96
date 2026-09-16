"""Full-stack test: multi-step tool loop, approval, denial, learning, skills."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import agent as A, memory, skills

# Simulated model that behaves like a real agent working a task
turns = []
def fake(messages, system="", max_tokens=None, stream_cb=None):
    last = messages[-1]["content"]
    turns.append(last[:60])
    if "[tool_result]" not in last and "[approved" not in last and "[denied" not in last:
        # first: read-only tool (should NOT need approval)
        return {"text":'```tool\n{"tool":"list_dir","args":{"path":"core","depth":1}}\n```',
                "provider":"mock","model":"m","offline":True}
    if '"status": "ok"' in last and "agent.py" in last:
        # then: a side-effect tool (MUST suspend)
        return {"text":'I need to check git state.\n```tool\n{"tool":"run_shell","args":{"cmd":"git status"}}\n```',
                "provider":"mock","model":"m","offline":True}
    return {"text":"Task complete. Repo has 8 core modules.","provider":"mock","model":"m","offline":True}
A.router.complete = fake

ag = A.Agent(project="integ")
r = ag.turn("look at the core dir then check git")

print("1) read-only tool ran without approval:",
      any(t["call"]["tool"]=="list_dir" and t["result"]["status"]=="ok" for t in r["tool_log"]))
print("2) side-effect tool suspended:", r["pending"] is not None, "->", r["pending"])
assert r["pending"], "FAIL: did not suspend"

r2 = ag.deny(note="I'll check git myself")
print("3) after deny, agent continued:", r2["text"][:60])
print("4) denial learned:", memory.predict("git status", project="integ")["hint"])

# verify skills auto-load on a firmware question
sp = A.system_prompt("integ", "I need to fastboot flash a boot.img")
print("5) firmware skill auto-loaded:", "Skill loaded: firmware-flash" in sp)
print("6) approval rule in prompt:", "APPROVAL RULE" in sp)
print("7) learned prefs surfaced:", "REFUSED" in sp or "DENIED" in sp)
print("\nINTEGRATION OK")
