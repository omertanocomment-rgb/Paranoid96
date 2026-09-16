"""Phase 10 — Multi-agent orchestration.

A central orchestrator routes a task through role-specialized prompts (Architect,
Developer, Reviewer, ...) against the model router. Lightweight by design: roles are
system-prompt personas sharing the constitution and evidence discipline.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..models.base import Message
from ..models.router import Router
from .. import constitution

ROLES = {
    "architect": "You are the Architect. Produce a concrete plan and file-level changes.",
    "developer": "You are the Developer. Implement precisely; output complete code.",
    "researcher": "You are the Researcher. Analyze docs/source and cite what you found.",
    "reviewer": "You are the Reviewer. Find correctness and maintainability issues.",
    "tester": "You are the Tester. Propose reproductions and concrete test cases.",
    "debugger": "You are the Debugger. Root-cause from evidence; no guessing.",
    "builder": "You are the Builder. Give exact build/package commands.",
    "firmware": "You are the Firmware Engineer. ARM/AOSP/DTS; never flash without approval.",
    "documentation": "You are the Documentation writer. Clear, minimal, accurate.",
}


@dataclass
class AgentResult:
    role: str
    text: str
    model: str


class Orchestrator:
    def __init__(self, router: Router | None = None):
        self.router = router or Router()
        self.constitution = constitution.load()

    def _system(self, role: str) -> str:
        persona = ROLES.get(role, ROLES["developer"])
        base = ("You are part of OMERTA AI, an evidence-backed engineering agent. "
                "Be direct and technical. No claims of success without verification. "
                "Label uncertainty as UNKNOWN.")
        parts = [base, persona]
        if self.constitution:
            parts.append("Project constitution:\n" + self.constitution)
        return "\n\n".join(parts)

    def run(self, role: str, task: str, category: str = "coding") -> AgentResult:
        provider = self.router.provider()
        model = self.router.model_for(category)
        comp = provider.complete(
            [Message("user", task)], model=model,
            system=self._system(role), effort=self.router.config.effort,
        )
        return AgentResult(role=role, text=comp.text, model=comp.model)

    def plan_and_build(self, task: str) -> list[AgentResult]:
        """Minimal Architect -> Developer -> Reviewer chain."""
        results = []
        plan = self.run("architect", task, "planning")
        results.append(plan)
        impl = self.run("developer", f"Task: {task}\n\nPlan:\n{plan.text}", "coding")
        results.append(impl)
        review = self.run("reviewer", f"Task: {task}\n\nImplementation:\n{impl.text}", "review")
        results.append(review)
        return results
