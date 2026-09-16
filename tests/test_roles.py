"""Engineering roles: focus blocks + system-prompt integration."""
import os
import sys
import tempfile

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import roles, agent as agent_mod  # noqa: E402


def test_role_blocks_and_aliases():
    assert "Reviewer" in roles.block("reviewer")
    assert "Do NOT modify" in roles.block("reviewer")
    assert "Firmware" in roles.block("fw")            # alias
    assert roles.resolve("dev") == "developer"
    assert roles.block("") == "" and roles.block("nope") == ""
    assert len(roles.names()) == 10
    print(f"  ✓ {len(roles.names())} roles, aliases resolve, unknown → no block")


def test_role_enters_system_prompt():
    os.environ.pop("OMERTA_ROLE", None)
    base = agent_mod.system_prompt("general", "hello")
    assert "ROLE: Reviewer" not in base
    os.environ["OMERTA_ROLE"] = "reviewer"
    try:
        withrole = agent_mod.system_prompt("general", "hello")
        assert "ROLE: Reviewer" in withrole, "role block not injected into prompt"
    finally:
        os.environ.pop("OMERTA_ROLE", None)
    print("  ✓ OMERTA_ROLE injects the focus block into the system prompt")


def test_compact_prompt_gets_role():
    os.environ["OMERTA_ROLE"] = "firmware"
    os.environ["OMERTA_COMPACT"] = "1"
    try:
        import importlib
        from core import config
        importlib.reload(config)          # pick up COMPACT
        importlib.reload(agent_mod)
        p = agent_mod.system_prompt("general", "bring up the panel")
        assert "Firmware Engineer" in p
    finally:
        os.environ.pop("OMERTA_ROLE", None)
        os.environ.pop("OMERTA_COMPACT", None)
        import importlib
        from core import config
        importlib.reload(config)
        importlib.reload(agent_mod)
    print("  ✓ compact (small-model) prompt also carries the role")


if __name__ == "__main__":
    test_role_blocks_and_aliases()
    test_role_enters_system_prompt()
    test_compact_prompt_gets_role()
    print("\nROLES TESTS PASSED")
