"""
Role pipelines — run a task through a sequence of role-focused agent turns.

This is an honest, sequential step toward the spec's multi-agent picture: not
ten agents running in parallel (that stays a documented Planned item), but ONE
agent run once per role in order, each stage seeing the previous stage's output.
It is most useful for the read-only stages (plan → review); a stage that wants
to change the world suspends for approval exactly as normal, and the pipeline
stops there and returns the pending request rather than acting unattended.
"""
from . import roles
from .agent import Agent

PIPELINES = {
    "plan": ["architect"],
    "review": ["reviewer"],
    "analyze": ["architect", "reviewer"],       # plan, then critique the plan
    "default": ["architect", "reviewer"],
    "firmware": ["firmware", "reviewer"],
    "debug": ["debugger", "reviewer"],
    "full": ["architect", "developer", "tester", "reviewer"],
}


def pipelines():
    return {k: list(v) for k, v in PIPELINES.items()}


def run(task, pipeline="default", project="general", max_stages=6):
    stages = PIPELINES.get(pipeline)
    if stages is None:
        return {"status": "error",
                "reason": f"unknown pipeline '{pipeline}'. "
                          f"try: {', '.join(sorted(PIPELINES))}"}
    transcript = []
    context = ""
    import os
    for role in stages[:max_stages]:
        agent = Agent(project=project)
        seed = (f"[pipeline role: {role}]\n"
                + (f"Prior stage output:\n{context}\n\n" if context else "")
                + f"Task: {task}")
        # apply the role for this stage only
        prev = os.environ.get("OMERTA_ROLE")
        os.environ["OMERTA_ROLE"] = role
        try:
            res = agent.turn(seed)
        finally:
            if prev is None:
                os.environ.pop("OMERTA_ROLE", None)
            else:
                os.environ["OMERTA_ROLE"] = prev
        entry = {"role": role, "text": res.get("text", ""),
                 "pending": res.get("pending"), "provider": res.get("provider")}
        transcript.append(entry)
        context = entry["text"]
        if entry["pending"]:
            entry["stopped"] = ("suspended for approval — pipelines don't approve "
                                "unattended; run this stage interactively")
            break
    return {"status": "ok", "pipeline": pipeline, "stages": [s["role"] for s in transcript],
            "transcript": transcript}
