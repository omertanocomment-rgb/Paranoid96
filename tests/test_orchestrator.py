"""Role pipeline: runs stages in order, feeds output forward, stops on approval."""
import os
import sys
import tempfile

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import orchestrator, agent as agent_mod  # noqa: E402


def test_pipeline_runs_all_stages_in_order():
    import re
    seen = []

    def fake_complete(messages, system="", max_tokens=None, stream_cb=None):
        # read the exact injected role block ("[ROLE: Architect. …]"), which is
        # unambiguous and not present in recalled memory
        m = re.search(r"ROLE: (\w+)\.", system)
        role = m.group(1) if m else "?"
        seen.append(role)
        return {"text": f"{role} says ok", "provider": "mock",
                "model": "mock", "offline": True}
    agent_mod.router.complete = fake_complete

    res = orchestrator.run("build a thing", pipeline="analyze")
    assert res["status"] == "ok"
    assert res["stages"] == ["architect", "reviewer"], res["stages"]
    assert seen == ["Architect", "Reviewer"], seen
    assert res["transcript"][1]["text"] == "Reviewer says ok"
    # the active role must be cleared after the run (no leak)
    from core import roles
    assert roles.active() is None, "active role leaked after pipeline"
    print("  ✓ analyze pipeline ran architect→reviewer, active role cleared after")


def test_pipeline_stops_on_pending_approval():
    calls = {"n": 0}

    def fake_complete(messages, system="", max_tokens=None, stream_cb=None):
        calls["n"] += 1
        # first stage proposes a side-effecting shell command -> suspends
        if calls["n"] == 1:
            return {"text": '```tool\n{"tool":"run_shell","args":{"cmd":"make"}}\n```',
                    "provider": "mock", "model": "mock", "offline": True}
        return {"text": "next", "provider": "mock", "model": "mock", "offline": True}
    agent_mod.router.complete = fake_complete

    res = orchestrator.run("compile it", pipeline="full")
    assert res["stages"] == ["architect"], res["stages"]     # stopped after stage 1
    assert res["transcript"][0]["pending"], "should have suspended for approval"
    print("  ✓ pipeline halts at the first stage that needs approval")


def test_unknown_pipeline():
    r = orchestrator.run("x", pipeline="nope")
    assert r["status"] == "error" and "unknown pipeline" in r["reason"]
    print("  ✓ unknown pipeline rejected")


if __name__ == "__main__":
    test_pipeline_runs_all_stages_in_order()
    test_pipeline_stops_on_pending_approval()
    test_unknown_pipeline()
    print("\nORCHESTRATOR TESTS PASSED")
