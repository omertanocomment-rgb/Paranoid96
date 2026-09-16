"""Verify the highest-risk path: flashing is flagged dangerous and gated."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import agent as A
def fake(m,system="",max_tokens=None,stream_cb=None):
    if "[tool_result]" in m[-1]["content"]: return {"text":"Waiting on you.","provider":"mock","model":"m","offline":True}
    return {"text":'```tool\n{"tool":"flash_partition","args":{"image":"boot.img","partition":"boot"}}\n```',
            "provider":"mock","model":"m","offline":True}
A.router.complete=fake
ag=A.Agent(project="flashtest")
r=ag.turn("flash the boot image")
p=r["pending"]
print("action :", p["action"])
print("danger :", p["danger"])
print("tier   :", p["tier"])
assert p["danger"] is True, "FAIL: flashing not flagged dangerous"
assert p["action"]=="fastboot flash boot boot.img"
print("\nFLASH GATING OK — flagged destructive, suspended, exact command shown")
