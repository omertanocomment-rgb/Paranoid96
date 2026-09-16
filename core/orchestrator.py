"""
Role pipelines — run a task through a sequence of role-focused agent turns.

This is an honest, sequential step toward the spec's multi-agent picture: not
ten agents running in parallel (that stays a documented Planned item), but ONE
agent run once per role in order, each stage seeing the previous stage's output.
It is most useful for the read-only stages (plan → review); a stage that wants
to change the world suspends for approval exactly as normal, and the pipeline
stops there and returns the pending request rather than acting unattended.
"""
import threading

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

# Pipelines that run their roles CONCURRENTLY (independent analysis of the same
# task) rather than as a feed-forward chain. Read-only roles only — a parallel
# stage that proposes a side effect is reported as pending, never run unattended.
PARALLEL_PIPELINES = {
    "team": ["architect", "security", "tester", "reviewer"],
    "audit": ["security", "reviewer"],
}


def pipelines():
    out = {k: {"mode": "sequential", "stages": list(v)} for k, v in PIPELINES.items()}
    out.update({k: {"mode": "parallel", "stages": list(v)}
                for k, v in PARALLEL_PIPELINES.items()})
    return out


def run_parallel(task, stages, project="general", timeout=180):
    """Run several role agents CONCURRENTLY on the same task, then collect their
    independent findings. Thread-safe: each thread has its own role (thread-local)
    and its own Agent/DB connection."""
    out, lock = [], threading.Lock()

    def worker(role):
        try:
            agent = Agent(project=project)
            roles.set_active(role)
            res = agent.turn(f"[parallel role: {role}]\nTask: {task}")
            rec = {"role": role, "text": res.get("text", ""),
                   "pending": res.get("pending"), "provider": res.get("provider")}
        except Exception as e:  # noqa: BLE001 — one agent failing must not sink the team
            rec = {"role": role, "text": "", "error": str(e), "pending": None}
        finally:
            roles.set_active(None)
        with lock:
            out.append(rec)

    threads = [threading.Thread(target=worker, args=(r,), name=f"omerta-{r}")
               for r in stages]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout)
    order = {r: i for i, r in enumerate(stages)}
    out.sort(key=lambda x: order.get(x["role"], 99))
    return {"status": "ok", "mode": "parallel", "pipeline_stages": stages,
            "stages": [o["role"] for o in out], "transcript": out}


def run(task, pipeline="default", project="general", max_stages=6):
    if pipeline in PARALLEL_PIPELINES:
        return run_parallel(task, PARALLEL_PIPELINES[pipeline], project=project)
    stages = PIPELINES.get(pipeline)
    if stages is None:
        return {"status": "error",
                "reason": f"unknown pipeline '{pipeline}'. try: "
                          f"{', '.join(sorted(list(PIPELINES) + list(PARALLEL_PIPELINES)))}"}
    transcript = []
    context = ""
    for role in stages[:max_stages]:
        agent = Agent(project=project)
        seed = (f"[pipeline stage: {role}]\n"
                + (f"Prior stage output:\n{context}\n\n" if context else "")
                + f"Task: {task}")
        # apply the role for this stage only (no env mutation → no subprocess leak)
        prev = roles.active()
        roles.set_active(role)
        try:
            res = agent.turn(seed)
        finally:
            roles.set_active(prev)
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
