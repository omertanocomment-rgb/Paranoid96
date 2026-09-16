"""
Evidence tools for the agent — record and review confidence-tagged findings.

Lets the agent write down what it has established and how sure it is
(CONFIRMED/LIKELY/INFERRED/UNKNOWN), and read it back — so "no guessing" is a
concrete, durable habit, not just a prompt line. Writes go to the agent's own
memory (like remember), so they're not gated.
"""
MANIFEST = {
    "name": "evidence_tools",
    "description": "Record and review confidence-tagged evidence "
                   "(CONFIRMED/LIKELY/INFERRED/UNKNOWN).",
    "version": "1.0",
}


def _e():
    from core import evidence
    return evidence


def evidence_note(args):
    e = _e()
    return e.note(args.get("value", ""), args.get("confidence", "UNKNOWN"),
                  source=args.get("source", ""), project=args.get("project", "general"),
                  notes=args.get("notes", ""))


def evidence_log(args):
    return _e().log(project=args.get("project"))


def register():
    return {
        "evidence_note": {"fn": evidence_note, "description":
                          "Record a finding with a confidence and its source.",
                          "args": {"value": "the claim", "confidence":
                                   "CONFIRMED|LIKELY|INFERRED|UNKNOWN",
                                   "source": "where it came from",
                                   "project": "scope"},
                          "side_effects": False},
        "evidence_log": {"fn": evidence_log, "description":
                         "Review recorded evidence, grouped by confidence.",
                         "args": {"project": "scope"},
                         "side_effects": False},
    }
