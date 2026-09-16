"""
Persistence engine — the "tries its hardest" part.

When a tool call fails, the agent doesn't just surrender back to you. It:
  1. records the failure signature
  2. consults memory for a previously-successful fix to the same error
  3. re-plans with the failure in context, explicitly told not to repeat the
     same approach
  4. escalates to a stronger provider if a local model keeps failing
  5. after MAX_RETRY_STRATEGIES distinct attempts, stops and reports honestly
     what it tried and why each failed — rather than looping forever or
     claiming success it didn't achieve
"""
import re
import hashlib
from . import config, memory


def failure_signature(result: dict) -> str:
    """Stable-ish fingerprint of an error so repeats are detectable."""
    blob = f"{result.get('cmd','')}|{result.get('stderr','')[:400]}|{result.get('reason','')[:200]}"
    norm = re.sub(r"0x[0-9a-f]+|\d+|/[\w./-]+", "", blob.lower())
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


def is_failure(result: dict) -> bool:
    if not isinstance(result, dict):
        return False
    if result.get("status") in ("error", "denied_by_policy"):
        return True
    return result.get("returncode", 0) not in (0, None)


class AttemptTracker:
    """Per-turn record of what's been tried, so we don't loop."""

    def __init__(self, project="general"):
        self.project = project
        self.attempts = []          # [{sig, cmd, err}]
        self.seen_sigs = {}

    def record(self, result):
        sig = failure_signature(result)
        self.seen_sigs[sig] = self.seen_sigs.get(sig, 0) + 1
        self.attempts.append({
            "sig": sig,
            "cmd": result.get("cmd") or result.get("tool", "?"),
            "err": (result.get("stderr") or result.get("reason") or "")[:300],
        })
        return sig

    def repeated(self, result):
        return self.seen_sigs.get(failure_signature(result), 0) >= 2

    def exhausted(self):
        return len(self.attempts) >= config.MAX_RETRY_STRATEGIES

    def known_fix(self, result):
        """Has this exact error been solved before?"""
        err = (result.get("stderr") or result.get("reason") or "")[:120]
        if not err:
            return None
        hits = memory.recall(err, project=self.project, top_k=3, kind="error_fix")
        return hits[0]["content"] if hits else None

    def guidance(self, result):
        """Text injected back into the model so the retry is actually different."""
        parts = [f"[tool_failed] The previous action failed: "
                 f"{(result.get('stderr') or result.get('reason') or 'unknown error')[:500]}"]
        fix = self.known_fix(result)
        if fix:
            parts.append(f"[memory] You have solved a similar error before: {fix}")
        if self.repeated(result):
            parts.append("[warning] This is the SAME failure as a previous attempt. "
                         "Do NOT retry the same command. Change approach: check "
                         "assumptions (tool installed? path correct? env var set? "
                         "permissions?), inspect state with a read-only command "
                         "first, or decompose the step.")
        tried = "; ".join(a["cmd"] for a in self.attempts[-4:])
        if tried:
            parts.append(f"[already tried] {tried}")
        if self.exhausted():
            parts.append("[final] You have exhausted your retry budget. Stop "
                         "attempting fixes. Report clearly: what you tried, what "
                         "each attempt returned, your best hypothesis, and the "
                         "single most useful thing the user could check. Do not "
                         "claim the task succeeded.")
        return "\n".join(parts)

    def summary(self):
        return {"attempts": len(self.attempts),
                "distinct_errors": len(self.seen_sigs),
                "log": self.attempts}


def record_success(cmd, project="general", context=""):
    """Bank a working solution so the next failure can recall it."""
    memory.remember(f"WORKED: `{cmd}` {context}".strip(),
                    project=project, kind="error_fix", tags="success", weight=1.5)
