"""
Engineering roles — focus profiles for the one agent.

The spec lists Architect / Developer / Researcher / Reviewer / Tester /
Debugger / Builder / Firmware / Security / Documentation "agents". Rather than
pretend there are ten orchestrated agents (there aren't — that's a documented
Planned item), a role is a focus block prepended to the system prompt. It
steers the same agent, under the same approval gate, toward one job. Selectable
per run (`omerta plan/review/...`, `OMERTA_ROLE`) without changing safety.
"""
from . import config

ROLES = {
    "architect": "ROLE: Architect. Focus on design and planning. Produce a clear, "
                 "staged plan with the critical files and trade-offs. Do NOT modify "
                 "files in this role — propose, don't implement.",
    "developer": "ROLE: Developer. Implement the requested change with minimal, "
                 "correct edits. Read before you write; keep diffs small; run the "
                 "relevant tests before claiming done.",
    "researcher": "ROLE: Researcher. Gather evidence from the source, docs and "
                  "tests. Cite where each fact came from and mark confidence "
                  "(CONFIRMED/LIKELY/INFERRED/UNKNOWN). Do not act on guesses.",
    "reviewer": "ROLE: Reviewer. Review the diff for correctness, safety, and "
                "style. Point to file:line. Do NOT modify files — report findings "
                "ranked by severity.",
    "tester": "ROLE: Tester. Find and run the project's tests and static checks. "
              "Report pass/fail with the ACTUAL output. Never claim a test passed "
              "without its result.",
    "debugger": "ROLE: Debugger. Parse the error, locate the root cause "
                "(file:line), propose one fix, apply it only when approved, then "
                "re-run to verify. Don't repeat a fix that already failed.",
    "builder": "ROLE: Builder. Discover the build system, check dependencies, and "
               "build. Capture the output; on failure, analyse the real error and "
               "propose a fix. Never say the build passed without build output.",
    "firmware": "ROLE: Firmware Engineer. Evidence-first device bring-up. Never "
                "guess hardware (GPIOs, regulators, panel timings, partitions). "
                "Use analyze_dtb / inspect_image / board_report; mark UNKNOWN when "
                "the evidence isn't there. Flashing is destructive and needs approval.",
    "security": "ROLE: Security Engineer. Look for secrets, unsafe permissions, "
                "injection, and destructive operations. Flag risks with severity "
                "and prefer the safer fix. Never expose or commit secrets.",
    "docs": "ROLE: Documentation Engineer. Write clear docs that match the code "
            "exactly. Do not invent behaviour; if something is unverified, say so.",
}

ALIASES = {"dev": "developer", "arch": "architect", "review": "reviewer",
           "test": "tester", "debug": "debugger", "build": "builder",
           "sec": "security", "fw": "firmware", "research": "researcher"}


def names():
    return sorted(ROLES)


def resolve(role):
    if not role:
        return ""
    return ALIASES.get(role.lower(), role.lower())


def block(role=None):
    """The focus block for the current role (arg, else OMERTA_ROLE), or ''. """
    r = resolve(role or config.get("OMERTA_ROLE", ""))
    body = ROLES.get(r)
    return f"[{body}]" if body else ""
