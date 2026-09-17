"""
Approval policy — one place that decides whether an action needs your consent.

OMERTA's original contract was: ask before every side effect. That is still the
default, and it is the right default. But asking about `ls` with the same
ceremony as `fastboot flash boot` trains you to tap RUN without reading, which
is worse than not asking at all. So the policy is a dial:

    always      ask before every side-effecting tool          (default)
    high_risk   auto-run LOW_RISK and NORMAL, ask on HIGH_RISK
    low_risk    auto-run LOW_RISK only, ask on NORMAL and above

Three things no policy can change, because they are the reason the gate exists:

  * DENY-tier commands are refused. Not asked about — refused. No setting,
    no confirmation, no override. `config.DENY_PATTERNS` is absolute.
  * Every action is logged, whether it was asked about or auto-run. Auto-run
    is not silent: the UI shows what ran.
  * HIGH_RISK always asks. Flashing, wiping, force-pushing, deleting — these
    are the cases the gate was built for, and no policy here can auto-run them.

The dial changes how much it interrupts you, never what it will do unsupervised.
"""
import os

from . import config

# Policy names, loosest last. The order matters: `_RANK` is what decides
# whether a tier clears the bar.
ALWAYS = "always"
HIGH_RISK_ONLY = "high_risk"
LOW_RISK_ONLY = "low_risk"

POLICIES = (ALWAYS, LOW_RISK_ONLY, HIGH_RISK_ONLY)

DESCRIPTIONS = {
    ALWAYS: "Ask before every action. The safest, and the noisiest.",
    LOW_RISK_ONLY: "Auto-run only read-ish commands (ls, cat, git status). "
                   "Ask for anything that changes something.",
    HIGH_RISK_ONLY: "Auto-run normal work (builds, edits, git). Ask only for "
                    "destructive or irreversible actions.",
}

# How permissive each policy is. A tier is auto-run when its rank is <= the
# policy's rank. HIGH_RISK is deliberately absent from every policy's reach.
_TIER_RANK = {"LOW_RISK": 1, "NORMAL": 2}
_POLICY_RANK = {ALWAYS: 0, LOW_RISK_ONLY: 1, HIGH_RISK_ONLY: 2}

# Tools that are not shell-backed still carry a risk tier, so one policy
# covers everything rather than only the commands that happen to be strings.
TOOL_TIERS = {
    "write_file": "NORMAL",        # always backed up first
    "apply_patch": "NORMAL",       # ditto
    "delete_file": "HIGH_RISK",
    "restore_backup": "HIGH_RISK",
    "flash_partition": "HIGH_RISK",
}


def normalize(name):
    n = str(name or "").strip().lower().replace("-", "_")
    aliases = {"all": ALWAYS, "ask": ALWAYS, "everything": ALWAYS,
               "high": HIGH_RISK_ONLY, "highrisk": HIGH_RISK_ONLY,
               "dangerous": HIGH_RISK_ONLY, "danger_only": HIGH_RISK_ONLY,
               "low": LOW_RISK_ONLY, "lowrisk": LOW_RISK_ONLY}
    n = aliases.get(n, n)
    return n if n in POLICIES else ALWAYS


def current():
    """The active policy. Settings win over the environment, as elsewhere."""
    return normalize(config.get("OMERTA_APPROVAL_POLICY", ALWAYS))


def set_policy(name):
    p = normalize(name)
    config.set_setting("OMERTA_APPROVAL_POLICY", p)
    return p


def tier_for_tool(name, shell_tier=None):
    """The risk tier of a tool call. A shell-backed tool already has one from
    `sandbox.classify`; everything else is looked up or defaults to NORMAL."""
    if shell_tier:
        return shell_tier
    if str(name or "").startswith("mcp."):
        # An MCP tool reaches a service outside this device. Auto-running that
        # needs its own deliberate opt-in, not a general loosening.
        return "NORMAL" if config.flag("OMERTA_AUTORUN_MCP") else "HIGH_RISK"
    return TOOL_TIERS.get(name, "NORMAL")


def auto_run(tier, policy=None):
    """True when `tier` may run without asking under `policy`.

    DENY never reaches here (sandbox refuses it first) and HIGH_RISK has no
    rank, so both fall through to False no matter what the policy says.
    """
    if not tier:
        # An absent tier means we do not know the risk. Unknown risk asks.
        return False
    t = str(tier).upper()
    if t not in _TIER_RANK:                     # HIGH_RISK, DENY, anything odd
        return False
    p = normalize(policy or current())
    return _TIER_RANK[t] <= _POLICY_RANK[p]


def explain(policy=None):
    p = normalize(policy or current())
    return {"policy": p, "description": DESCRIPTIONS[p],
            "auto_runs": [t for t in ("LOW_RISK", "NORMAL") if auto_run(t, p)],
            "always_asks": ["HIGH_RISK"],
            "always_refuses": ["DENY"],
            "policies": {name: DESCRIPTIONS[name] for name in POLICIES}}
