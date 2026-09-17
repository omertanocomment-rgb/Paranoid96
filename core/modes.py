"""
Work modes — what kind of work OMERTA is doing right now.

A role (`core/roles.py`) says which hat the agent wears. A mode says what it is
allowed to *do* while wearing it, and it is enforced, not suggested:

    plan        think it through. NO side effects at all, not even gated ones.
                Reading and searching are fine. Nothing is written or run.
    brainstorm  pure conversation. No tools at all — just thinking out loud,
                arguing, comparing options.
    research    read, search, index, recall, fetch. Still writes nothing.
    build       the full agent: every tool, behind the usual approval gate.
    debate      argue a position properly, steelman the other side, and say
                which one actually wins. Conversation only.

`plan` and `research` are the ones worth having. A model asked to "just plan"
will cheerfully start editing files halfway through, because planning and doing
feel adjacent from the inside. Making the tool layer refuse is the only thing
that reliably stops it — so in those modes the side-effecting tools are not
merely discouraged in the prompt, they are unavailable, and the agent is told
so plainly rather than being left to discover it as a wall of errors.

Mode never *widens* anything: build is the normal agent with the normal gate.
"""
from . import config

BUILD = "build"
PLAN = "plan"
RESEARCH = "research"
BRAINSTORM = "brainstorm"
DEBATE = "debate"

MODES = (BUILD, PLAN, RESEARCH, BRAINSTORM, DEBATE)

# side_effects: may the agent change anything at all
# tools:        may it call tools at all
SPEC = {
    BUILD: {
        "label": "BUILD",
        "side_effects": True, "tools": True,
        "blurb": "Full agent. Every tool, behind the approval gate.",
        "prompt": (
            "MODE: BUILD. You are doing the work. Use tools, make the change, "
            "run the tests, report what actually happened. Every side effect "
            "still goes through the approval gate — propose precisely, do not "
            "narrate what you are about to do at length first."),
    },
    PLAN: {
        "label": "PLAN",
        "side_effects": False, "tools": True,
        "blurb": "Think it through. Reads and searches; changes nothing.",
        "prompt": (
            "MODE: PLAN. Produce a plan, not a change. You may read files, "
            "search the codebase and recall memory; you CANNOT write, run, "
            "patch, install or flash anything — those tools are switched off, "
            "so do not offer to use them.\n"
            "A good plan names the specific files and functions involved, the "
            "order of the steps, what could break, and how you would know it "
            "worked. Say what you are unsure about instead of smoothing over "
            "it. End with the first concrete step, then stop and let the user "
            "switch to BUILD."),
    },
    RESEARCH: {
        "label": "RESEARCH",
        "side_effects": False, "tools": True,
        "blurb": "Read, search, index, recall. Writes nothing.",
        "prompt": (
            "MODE: RESEARCH. Find out what is true. Read files, search the "
            "index, recall what has been learned, quote sources. You cannot "
            "change anything.\n"
            "Distinguish what you verified from what you are inferring, and "
            "say which is which — CONFIRMED / LIKELY / INFERRED / UNKNOWN is "
            "the house vocabulary. An honest UNKNOWN beats a confident guess."),
    },
    BRAINSTORM: {
        "label": "BRAINSTORM",
        "side_effects": False, "tools": False,
        "blurb": "Ideas only. No tools, no edits — thinking out loud.",
        "prompt": (
            "MODE: BRAINSTORM. No tools. Generate real options, not a list of "
            "synonyms for the same idea. Include at least one that is "
            "genuinely different in kind, and one that is cheaper or smaller "
            "than what was asked for.\n"
            "For each: what it buys, what it costs, and what would make you "
            "drop it. Then say which one you would actually pick and why. "
            "Do not end on a neutral menu — commit to a recommendation."),
    },
    DEBATE: {
        "label": "DEBATE",
        "side_effects": False, "tools": False,
        "blurb": "Argue it properly. Both sides, then a verdict.",
        "prompt": (
            "MODE: DEBATE. Argue the question seriously. Make the strongest "
            "case for the position, then the strongest case against it — the "
            "version its best advocate would recognise, not a strawman.\n"
            "Then give your verdict and defend it. If the user is wrong, say "
            "so and show the reasoning; if they are right, say that too and "
            "do not manufacture a counterargument to seem balanced. Name the "
            "evidence that would change your mind."),
    },
}


def normalize(name):
    n = str(name or "").strip().lower()
    aliases = {"": BUILD, "work": BUILD, "do": BUILD, "agent": BUILD,
               "planning": PLAN, "think": PLAN,
               "read": RESEARCH, "investigate": RESEARCH, "study": RESEARCH,
               "ideas": BRAINSTORM, "brain": BRAINSTORM, "explore": BRAINSTORM,
               "argue": DEBATE, "discuss": DEBATE}
    n = aliases.get(n, n)
    return n if n in MODES else BUILD


def current():
    return normalize(config.get("OMERTA_WORK_MODE", BUILD))


def set_mode(name):
    m = normalize(name)
    config.set_setting("OMERTA_WORK_MODE", m)
    return m


def spec(name=None):
    return SPEC[normalize(name or current())]


def allows_side_effects(name=None):
    return spec(name)["side_effects"]


def allows_tools(name=None):
    return spec(name)["tools"]


def prompt_block(name=None):
    s = spec(name)
    return s["prompt"]


def explain(name=None):
    m = normalize(name or current())
    s = SPEC[m]
    return {"mode": m, "label": s["label"], "blurb": s["blurb"],
            "side_effects": s["side_effects"], "tools": s["tools"],
            "modes": {k: {"label": v["label"], "blurb": v["blurb"],
                          "side_effects": v["side_effects"], "tools": v["tools"]}
                      for k, v in SPEC.items()}}


def refusal(tool, name=None):
    """What the agent is told when it reaches for a tool the mode withholds.

    Phrased as a fact about the mode rather than a failure, so the model
    re-plans instead of retrying the same call.
    """
    m = normalize(name or current())
    s = SPEC[m]
    if not s["tools"]:
        return (f"{s['label']} mode has no tools. Answer from what you know "
                f"and reason it through; switch to BUILD to actually do it.")
    return (f"'{tool}' changes something, and {s['label']} mode cannot change "
            f"anything. Reading and searching still work. Say what you would "
            f"do and let the user switch to BUILD.")
