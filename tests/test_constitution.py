#!/usr/bin/env python3
"""The project's rules actually reach the model.

OMERTA.md has been in this repository from early on, stating what the agent
must always do and must never do -- inspect before modifying, mark it UNKNOWN
rather than guessing, never claim a build passed without evidence. Nothing read
it. The approval gate and the evidence model enforce the parts expressible in
code; the rest is behaviour, and behaviour comes from the prompt. A
constitution the model never sees is a document, not a constitution.

What is pinned here: the rules are found, they reach BOTH prompts (the small
local-model one especially, where they matter most and where a naive
implementation would drop them to save context), a project's own rules outrank
the shipped ones, and none of it can take the agent down or blow the context
window.
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


print("=== project constitution ===")

from core import constitution, agent  # noqa: E402

# ── 1. the shipped charter is found and used ───────────────────────────────
check("the repository ships a constitution", (ROOT / "OMERTA.md").is_file())

found = constitution.files(str(ROOT))
check("and it is found", any(f.endswith("OMERTA.md") for f in found), found)

block = constitution.block(str(ROOT))
check("it becomes a prompt block", bool(block))
check("marked binding, so it outranks the model's defaults",
      "binding" in block.lower(), block[:80])
check("and carries the actual rules",
      "Inspect before modifying" in block or "UNKNOWN" in block)

# ── 2. it reaches BOTH prompts ─────────────────────────────────────────────
full = agent.system_prompt("general", "hello")
check("the full system prompt carries it", "PROJECT CONSTITUTION" in full)

compact = constitution.block(str(ROOT), compact=True)
check("the compact prompt carries it too", "PROJECT CONSTITUTION" in compact)
check("and the compact form is genuinely smaller",
      0 < len(compact) < len(block), (len(compact), len(block)))

# ── 3. a project's own rules win ───────────────────────────────────────────
with tempfile.TemporaryDirectory() as td:
    proj = Path(td) / "someproject"
    (proj / "sub" / "deep").mkdir(parents=True)
    (proj / "CLAUDE.md").write_text("Never use tabs in this repository.",
                                    encoding="utf-8")
    (proj / "OMERTA.md").write_text("This project forbids force pushes.",
                                    encoding="utf-8")

    b = constitution.block(str(proj / "sub" / "deep"))
    check("rules are found by walking up from the working directory",
          "force pushes" in b, b[:120])
    check("a repository's CLAUDE.md is honoured as well",
          "Never use tabs" in b)
    names = constitution.files(str(proj / "sub" / "deep"))
    check("the project's own file comes before the shipped one",
          names and str(proj) in names[0], names[:3])

    # ── 4. it cannot blow the context window ───────────────────────────────
    big = Path(td) / "big"
    big.mkdir()
    (big / "OMERTA.md").write_text("x" * 500_000, encoding="utf-8")
    huge = constitution.block(str(big))
    check("an enormous rules file is bounded",
          len(huge) < constitution.MAX_CHARS + 500, len(huge))
    check("and says it was truncated rather than cutting a rule silently",
          "truncated" in huge)
    small = constitution.block(str(big), compact=True)
    check("the compact bound is tighter still",
          len(small) < constitution.COMPACT_CHARS + 500, len(small))

    # ── 5. it degrades rather than raising ─────────────────────────────────
    empty = Path(td) / "empty"
    empty.mkdir()
    check("nowhere to look is not an error",
          isinstance(constitution.block(str(empty)), str))

    bad = Path(td) / "bad"
    bad.mkdir()
    (bad / "OMERTA.md").write_bytes(b"\xff\xfe\x00rules \xc3\x28 here")
    try:
        got = constitution.block(str(bad))
        ok = isinstance(got, str)
    except Exception as e:  # noqa: BLE001
        ok, got = False, repr(e)
    check("an undecodable rules file degrades instead of raising", ok, got)

    missing = Path(td) / "gone"
    check("a directory that does not exist is handled",
          isinstance(constitution.block(str(missing)), str))

# ── 6. the prompt still works with no rules at all ────────────────────────
saved = os.getcwd()
try:
    with tempfile.TemporaryDirectory() as td2:
        os.chdir(td2)
        p = agent.system_prompt("general", "hi")
        check("a prompt is still produced when there are no rules", len(p) > 200)
finally:
    os.chdir(saved)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nCONSTITUTION TESTS PASSED")
