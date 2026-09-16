"""
Sandbox — command execution with mandatory confirmation.

ALWAYS_ASK (default ON) means every single command is proposed to you and
executes only after an explicit approval. Nothing is auto-run, ever.
DENY_PATTERNS are refused outright even if you try to approve them.

Every proposal and every decision is recorded to memory, so the agent
learns which actions you green-light and which you kill — without that
learning ever being allowed to skip the asking.
"""
import subprocess
import time
import json
import shlex
from . import config, memory

LOG_FILE = config.DATA_DIR / "command_log.jsonl"


class Tier:
    DENY = "DENY"
    HIGH_RISK = "HIGH_RISK"
    NORMAL = "NORMAL"
    LOW_RISK = "LOW_RISK"


def classify(cmd: str) -> str:
    c = cmd.strip()
    for pat in config.DENY_PATTERNS:
        if pat in c:
            return Tier.DENY
    for p in config.HIGH_RISK_PREFIXES:
        if c.startswith(p):
            return Tier.HIGH_RISK
    for p in config.LOW_RISK_PREFIXES:
        if c.startswith(p):
            return Tier.LOW_RISK
    return Tier.NORMAL


def _log(entry):
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def propose(cmd, cwd=".", project="general", reason="") -> dict:
    """Build the confirmation request the user sees. Runs nothing."""
    tier = classify(cmd)
    if tier == Tier.DENY:
        return {"status": "denied_by_policy", "cmd": cmd, "tier": tier,
                "reason": "matches a hard-deny pattern that can destroy the "
                          "host or brick a device — not runnable even with approval"}
    hint = memory.predict(cmd, project=project)
    return {"status": "needs_confirmation", "cmd": cmd, "cwd": cwd,
            "tier": tier, "reason": reason, "history": hint,
            "danger": tier == Tier.HIGH_RISK}


def run(cmd, cwd=".", timeout=None, project="general") -> dict:
    """Execute. Only call after the user approved this exact command."""
    if classify(cmd) == Tier.DENY:
        return {"status": "denied_by_policy", "cmd": cmd,
                "reason": "hard-deny pattern"}
    timeout = timeout or config.COMMAND_TIMEOUT
    start = time.time()
    try:
        p = subprocess.run(cmd, shell=True, cwd=cwd, timeout=timeout,
                           capture_output=True, text=True)
        out = {"status": "ran", "cmd": cmd, "cwd": cwd, "returncode": p.returncode,
               "stdout": p.stdout[-8000:], "stderr": p.stderr[-4000:],
               "duration": round(time.time() - start, 2)}
    except subprocess.TimeoutExpired:
        out = {"status": "ran", "cmd": cmd, "cwd": cwd, "returncode": -1,
               "stdout": "", "stderr": f"TIMEOUT after {timeout}s", "duration": timeout}
    except Exception as e:  # noqa: BLE001
        out = {"status": "error", "cmd": cmd, "returncode": -1,
               "stdout": "", "stderr": str(e), "duration": 0}
    out["ts"] = time.time()
    _log(out)
    # learning: a command that ran was, by definition, approved
    memory.record_choice(cmd, "approved", project=project)
    # remember failures so the agent doesn't repeat a broken invocation
    if out.get("returncode") not in (0, None):
        memory.remember(
            f"Command `{cmd}` failed (rc={out['returncode']}): "
            f"{(out.get('stderr') or '')[:200]}",
            project=project, kind="error_fix", tags="failure")
    return out


def deny(cmd, project="general", note=""):
    memory.record_choice(cmd, "denied", project=project, note=note)
    _log({"status": "denied_by_user", "cmd": cmd, "note": note, "ts": time.time()})
    return {"status": "denied_by_user", "cmd": cmd, "note": note}


def edit(cmd, new_cmd, project="general"):
    memory.record_choice(cmd, "edited", project=project, note=new_cmd)
    return {"status": "edited", "cmd": new_cmd, "original": cmd}


def history(n=50):
    if not LOG_FILE.exists():
        return []
    lines = LOG_FILE.read_text().strip().splitlines()[-n:]
    return [json.loads(x) for x in lines if x.strip()]
