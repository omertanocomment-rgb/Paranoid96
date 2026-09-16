"""General evidence-confidence facility: record shape, combine, durable log."""
import os
import sys
import tempfile

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import evidence  # noqa: E402


def test_record_and_norm():
    r = evidence.record("MT6765", "confirmed", "stock DTB")
    assert r == {"value": "MT6765", "confidence": "CONFIRMED",
                 "source": "stock DTB", "notes": ""}
    assert evidence.record("x", "banana")["confidence"] == "UNKNOWN"
    print("  ✓ record normalises confidence; unknown → UNKNOWN")


def test_combine_is_weakest_link():
    recs = [evidence.record("a", "CONFIRMED"), evidence.record("b", "LIKELY"),
            evidence.record("c", "INFERRED")]
    assert evidence.combine(recs) == "INFERRED"
    assert evidence.combine([]) == "UNKNOWN"
    assert evidence.rank("CONFIRMED") > evidence.rank("UNKNOWN")
    print("  ✓ combine = weakest link; ranking orders confidence")


def test_evidence_log_class():
    log = evidence.EvidenceLog()
    log.add("soc is mt6765", "CONFIRMED", "dtb")
    log.add("panel is X", "UNKNOWN")
    rep = log.report()
    assert rep["overall"] == "UNKNOWN" and rep["unknown_count"] == 1
    print("  ✓ EvidenceLog overall reflects an UNKNOWN in the chain")


def test_durable_note_and_grouping():
    evidence.note("RAM is 4GB", "CONFIRMED", source="meminfo", project="evtest")
    evidence.note("charger is mt6357", "LIKELY", source="dmesg", project="evtest")
    evidence.note("exact PMIC reg", "UNKNOWN", project="evtest")
    out = evidence.log(project="evtest")
    assert out["total"] == 3
    assert "CONFIRMED" in out["by_confidence"] and "UNKNOWN" in out["by_confidence"]
    assert any("RAM is 4GB" in x for x in out["by_confidence"]["CONFIRMED"])
    print("  ✓ notes persist to memory and group by confidence")


def test_firmware_uses_same_shape():
    # firmware plugin's _field now delegates to evidence.record
    from plugins import firmware_bringup as fw
    f = fw._field("v", "CONFIRMED", "src")
    assert f["confidence"] == "CONFIRMED" and "notes" in f
    print("  ✓ firmware tools share the evidence record shape")


if __name__ == "__main__":
    test_record_and_norm()
    test_combine_is_weakest_link()
    test_evidence_log_class()
    test_durable_note_and_grouping()
    test_firmware_uses_same_shape()
    print("\nEVIDENCE TESTS PASSED")
