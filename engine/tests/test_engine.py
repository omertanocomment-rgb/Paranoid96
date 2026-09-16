"""Core engine tests — Phases 2, 5, 6, 12 (no network / no provider calls)."""
import os
import tempfile
from pathlib import Path

import pytest

from omerta.config import Config
from omerta.memory.db import Memory
from omerta.evidence import Evidence, EvidenceRecord
from omerta.codebase.index import Index
from omerta import constitution
from omerta.models.router import Router, CATEGORIES


def test_config_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("OMERTA_HOME", str(tmp_path))
    cfg = Config()
    cfg.default_model = "claude-opus-5"
    path = cfg.save()
    assert path.exists()
    loaded = Config.load()
    assert loaded.default_model == "claude-opus-5"
    assert loaded.effort == "high"


def test_memory_teach_search_forget(tmp_path):
    mem = Memory(db_path=tmp_path / "m.db")
    mid = mem.teach("build.tool", "use gradle 8.9", scope="project", type="LESSON")
    assert mid > 0
    assert any("gradle" in i.value for i in mem.search("gradle"))
    assert mem.forget(mid) is True
    assert mem.search("gradle") == []
    mem.close()


def test_memory_records_outcomes(tmp_path):
    mem = Memory(db_path=tmp_path / "m.db")
    mem.record_outcome(False, "gradle assembleRelease", "exit 1: keystore not found")
    fails = mem.show(type="FAILURE")
    assert len(fails) == 1 and "keystore" in fails[0].value
    mem.close()


def test_evidence_levels():
    r = EvidenceRecord("build succeeded", Evidence.CONFIRMED, detail="exit 0")
    assert r.level.tag() == "[CONFIRMED]"
    assert "CONFIRMED" in r.render()


def test_index_and_symbol_search(tmp_path):
    (tmp_path / "a.py").write_text("def hello():\n    return 1\n\nclass Widget:\n    pass\n")
    (tmp_path / "b.txt").write_text("hello world\nsecond line\n")
    idx = Index(tmp_path)
    nf, ns = idx.build()
    assert nf >= 1 and ns >= 2
    syms = {h.text for h in idx.symbol("Widget")}
    assert "Widget" in syms
    hits = idx.search("hello")
    assert any(h.path == "b.txt" for h in hits)
    idx.close()


def test_constitution_init(tmp_path):
    path = constitution.init(tmp_path)
    assert path.exists()
    assert "Evidence" in constitution.load(tmp_path)


def test_router_reports_provider_status(tmp_path, monkeypatch):
    monkeypatch.setenv("OMERTA_HOME", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = Router(Config())
    status = dict((n, ok) for n, ok, _ in r.status())
    # All three providers are registered ("all different AI").
    assert {"anthropic", "openai", "ollama"} <= set(status)
    # No key -> anthropic reports unavailable (honest degradation).
    assert status["anthropic"] is False
    assert "planning" in CATEGORIES


def test_router_resolves_provider_model(tmp_path, monkeypatch):
    monkeypatch.setenv("OMERTA_HOME", str(tmp_path))
    r = Router(Config())
    p, m = r.resolve("openai:gpt-4o")
    assert p.name == "openai" and m == "gpt-4o"
    p, m = r.resolve("ollama:llama3.1")
    assert p.name == "ollama" and m == "llama3.1"
    # Bare id -> default provider (anthropic), model passed through.
    p, m = r.resolve("claude-opus-5")
    assert p.name == "anthropic" and m == "claude-opus-5"


def test_memory_learned_context_injects_rules(tmp_path):
    mem = Memory(db_path=tmp_path / "m.db")
    mem.teach("style", "always answer in bullet points", scope="global", type="RULE")
    mem.teach("fact.board", "target is a Pixel 6", scope="project", type="FACT")
    ctx = mem.learned_context()
    assert "bullet points" in ctx and "Pixel 6" in ctx
    # RULE ranked before FACT.
    assert ctx.index("bullet points") < ctx.index("Pixel 6")
    mem.close()


def test_firmware_toolchain_covers_spec():
    from omerta.firmware.inspect import toolchain, run_tool
    tc = toolchain()
    for t in ("dtc", "fdtdump", "mkbootimg", "unpack_bootimg", "avbtool",
              "simg2img", "lpunpack", "adb", "fastboot", "repo", "make"):
        assert t in tc, f"{t} missing from firmware toolchain detection"
    # Missing tool is reported honestly, not guessed.
    r = run_tool("definitely_not_a_real_tool_xyz", [])
    assert r["available"] is False and r["evidence"] == "UNKNOWN"


def test_tool_controller_has_all_phase7_groups(tmp_path):
    from omerta.tools.controller import ToolController
    tc = ToolController(root=tmp_path)
    groups = {t.group for t in tc.list()}
    for g in ("filesystem", "terminal", "process", "search", "git", "build",
              "test", "package", "firmware-analysis", "device-io"):
        assert g in groups, f"tool group {g} missing"
    # Destructive device/build tools require approval.
    names = {t.name: t for t in tc.list()}
    assert names["device.fastboot"].requires_approval
    assert names["build.run"].requires_approval


def test_config_writes_companion_files(tmp_path, monkeypatch):
    monkeypatch.setenv("OMERTA_HOME", str(tmp_path))
    from omerta.config import Config, scaffold_project
    Config().save()
    for f in ("config.toml", "providers.toml", "policies.toml"):
        assert (tmp_path / f).exists(), f"{f} not written"
    proj = scaffold_project(tmp_path)
    for sub in ("artifacts", "snapshots", "reports"):
        assert (proj / sub).is_dir()
