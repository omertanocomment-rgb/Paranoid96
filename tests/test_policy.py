"""
The approval policy is a dial for how often OMERTA interrupts you. These tests
pin down what the dial cannot do, because that is the whole safety argument:

  * no policy auto-runs a HIGH_RISK action
  * no policy lets a DENY-tier command through at all
  * loosening the policy never changes what `sandbox.run` refuses

If any of these fail, the dial has become a bypass and the gate is a lie.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import policy, config, sandbox, agent as agent_mod  # noqa: E402

ok = True


def check(label, cond):
    global ok
    ok = ok and bool(cond)
    print(f"  {'✓' if cond else '✗'} {label}")


def main():
    global ok

    # --- the dial itself
    check("default policy is 'always' (ask before everything)",
          policy.normalize(None) == policy.ALWAYS)
    check("an unknown policy name falls back to 'always', never to looser",
          policy.normalize("yolo") == policy.ALWAYS
          and policy.normalize("") == policy.ALWAYS
          and policy.normalize(None) == policy.ALWAYS)
    check("aliases resolve ('high' -> high_risk)",
          policy.normalize("high") == policy.HIGH_RISK_ONLY
          and policy.normalize("HIGH-RISK") == policy.HIGH_RISK_ONLY)

    # --- what each policy auto-runs
    matrix = {
        policy.ALWAYS:         {"LOW_RISK": False, "NORMAL": False},
        policy.LOW_RISK_ONLY:  {"LOW_RISK": True,  "NORMAL": False},
        policy.HIGH_RISK_ONLY: {"LOW_RISK": True,  "NORMAL": True},
    }
    for p, want in matrix.items():
        for tier, expect in want.items():
            check(f"{p}: {tier} auto-run is {expect}",
                  policy.auto_run(tier, p) is expect)

    # --- the invariants no policy may break
    for p in policy.POLICIES:
        check(f"{p}: HIGH_RISK still asks", policy.auto_run("HIGH_RISK", p) is False)
        check(f"{p}: DENY never auto-runs", policy.auto_run("DENY", p) is False)
        check(f"{p}: an unrecognised tier is treated as needing approval",
              policy.auto_run("WHATEVER", p) is False
              and policy.auto_run(None, p) is False)

    # --- non-shell tools carry tiers too, so one dial covers everything
    check("delete_file is HIGH_RISK (asks under every policy)",
          policy.tier_for_tool("delete_file") == "HIGH_RISK")
    check("flash_partition is HIGH_RISK",
          policy.tier_for_tool("flash_partition") == "HIGH_RISK")
    check("write_file is NORMAL (backed up, may auto-run when loosened)",
          policy.tier_for_tool("write_file") == "NORMAL")
    check("an MCP tool is HIGH_RISK until explicitly opted in",
          policy.tier_for_tool("mcp.github.create_issue") == "HIGH_RISK")
    prev = config.get("OMERTA_AUTORUN_MCP")
    config.set_setting("OMERTA_AUTORUN_MCP", "1")
    check("...and NORMAL once OMERTA_AUTORUN_MCP is set",
          policy.tier_for_tool("mcp.github.create_issue") == "NORMAL")
    config.set_setting("OMERTA_AUTORUN_MCP", prev if prev is not None else "0")

    # --- the loosest policy must not change what the sandbox refuses
    saved = config.get("OMERTA_APPROVAL_POLICY")
    policy.set_policy(policy.HIGH_RISK_ONLY)
    try:
        # every actual hard-deny pattern, not a guess at what one looks like
        deny_cmds = list(config.DENY_PATTERNS)
        classified, refused = [], []
        for cmd in deny_cmds:
            classified.append(sandbox.classify(cmd) == sandbox.Tier.DENY)
            refused.append(sandbox.run(cmd, project="policy-test").get("status")
                           in ("denied_by_policy", "refused"))
        check(f"all {len(deny_cmds)} DENY patterns still classify as DENY "
              "under the loosest policy", all(classified))
        check("...and sandbox.run refuses every one of them outright",
              all(refused))

        # these are HIGH_RISK, not DENY: legitimate but irreversible, so the
        # contract is "always ask", not "never run"
        for cmd in ("fastboot flash boot evil.img", "mkfs.ext4 /dev/block/sda"):
            check(f"HIGH_RISK under the loosest policy: {cmd!r} is not auto-run",
                  not policy.auto_run(sandbox.classify(cmd)))

        # a HIGH_RISK shell command must still produce awaiting_approval
        a = agent_mod.Agent(project="policy-test")
        res = a._run_tool({"tool": "flash_partition",
                           "args": {"partition": "boot", "image": "x.img"}})
        check("under the loosest policy, a HIGH_RISK tool still awaits approval",
              res.get("status") == "awaiting_approval")
        check("...and the agent is left suspended with a pending action",
              a.pending is not None)
    finally:
        policy.set_policy(saved or policy.ALWAYS)

    check("policy restored after the test", policy.current() == policy.normalize(saved))

    print("\n" + ("POLICY TESTS PASSED" if ok else "POLICY TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
