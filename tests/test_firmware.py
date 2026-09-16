"""Firmware bring-up tools: pure-Python DTB decode + evidence fusion, no guessing."""
import os
import sys
import struct
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from plugins import firmware_bringup as fw  # noqa: E402

FDT_BEGIN, FDT_END_NODE, FDT_PROP, FDT_END = 1, 2, 3, 9


def _pad(b):
    return b + b"\x00" * ((-len(b)) % 4)


def build_dtb(tree):
    """Serialize a simple {name, props{str:str|list}, children[]} tree to a DTB."""
    strings = bytearray()
    offs = {}

    def soff(name):
        if name not in offs:
            offs[name] = len(strings)
            strings.extend(name.encode() + b"\x00")
        return offs[name]

    st = bytearray()

    def emit(node):
        st.extend(struct.pack(">I", FDT_BEGIN))
        st.extend(_pad(node["name"].encode() + b"\x00"))
        for k, v in node.get("props", {}).items():
            vals = v if isinstance(v, list) else [v]
            raw = b"".join(s.encode() + b"\x00" for s in vals)
            st.extend(struct.pack(">III", FDT_PROP, len(raw), soff(k)))
            st.extend(_pad(raw))
        for ch in node.get("children", []):
            emit(ch)
        st.extend(struct.pack(">I", FDT_END_NODE))

    emit(tree)
    st.extend(struct.pack(">I", FDT_END))

    rsv = b"\x00" * 16                       # single terminating reserve entry
    header_len = 40
    off_rsv = header_len
    off_struct = off_rsv + len(rsv)
    off_strings = off_struct + len(st)
    total = off_strings + len(strings)
    header = struct.pack(">IIIIIIIIII", 0xD00DFEED, total, off_struct,
                         off_strings, off_rsv, 17, 16, 0, len(strings), len(st))
    return bytes(header) + rsv + bytes(st) + bytes(strings)


def test_analyze_dtb():
    tree = {"name": "", "props": {
        "model": "TCL T509K — OMERTA AI",
        "compatible": ["tcl,t509k", "mediatek,mt6765"]},
        "children": [
            {"name": "cpus", "children": [
                {"name": "cpu@0", "props": {"compatible": "arm,cortex-a53"}}]},
            {"name": "memory@40000000", "props": {"device_type": "memory"}},
            {"name": "touchscreen@38", "props": {"compatible": "goodix,gt9xx"}},
        ]}
    with tempfile.NamedTemporaryFile(suffix=".dtb", delete=False) as f:
        f.write(build_dtb(tree))
        path = f.name
    try:
        r = fw.analyze_dtb({"path": path})
    finally:
        os.unlink(path)

    assert r["status"] == "ok", r
    rep = r["report"]
    assert rep["model"]["value"] == "TCL T509K — OMERTA AI"
    assert rep["model"]["confidence"] == "CONFIRMED"
    assert "mediatek,mt6765" in rep["compatible"]["value"]
    assert "MT6765" in rep["soc"]["value"] and rep["soc"]["confidence"] == "CONFIRMED"
    assert rep["touchscreen"]["confidence"] == "CONFIRMED"
    assert "goodix,gt9xx" in rep["touchscreen"]["value"]
    # a subsystem the DTB never declared must be UNKNOWN, never guessed
    assert rep["camera"]["confidence"] == "UNKNOWN"
    assert "camera" in r["unknown_fields"]
    print("  ✓ DTB decoded: model/soc/touch CONFIRMED, camera UNKNOWN (not guessed)")


def test_board_report():
    d = tempfile.mkdtemp()
    open(os.path.join(d, "getprop.txt"), "w").write(
        "[ro.product.model]: [T509K]\n"
        "[ro.board.platform]: [mt6765]\n"
        "[ro.build.version.release]: [14]\n")
    open(os.path.join(d, "meminfo.txt"), "w").write("MemTotal:        3878400 kB\n")
    open(os.path.join(d, "cpuinfo.txt"), "w").write(
        "processor\t: 0\nprocessor\t: 1\nHardware\t: MT6765\n")
    open(os.path.join(d, "dmesg.txt"), "w").write(
        "[    1.2] goodix_ts 5-0014: goodix touchscreen probe ok\n"
        "[    1.3] mt6357-charger: charger online\n")
    r = fw.board_report({"dir": d})
    assert r["status"] == "ok", r
    b = r["board"]
    assert b["model"]["value"] == "T509K" and b["model"]["confidence"] == "CONFIRMED"
    assert "3.7" in b["ram"]["value"] and b["ram"]["confidence"] == "CONFIRMED"
    assert b["touchscreen"]["confidence"] == "LIKELY"      # from dmesg
    assert b["camera"]["confidence"] == "UNKNOWN"          # no evidence -> honest
    print("  ✓ evidence fused: model/ram CONFIRMED, touch LIKELY, camera UNKNOWN")


def _simple_dtb():
    return build_dtb({"name": "", "props": {
        "model": "TCL T509K — OMERTA AI",
        "compatible": ["tcl,t509k", "mediatek,mt6765"]}, "children": []})


def test_bootimg_v2_embedded_dtb():
    dtb = _simple_dtb()
    page = 2048
    kernel, ramdisk = b"KERNELDATA", b"RAMD"
    dtb_off = page + page + page          # header + kernel page + ramdisk page
    img = bytearray(dtb_off + len(dtb))
    img[0:8] = b"ANDROID!"
    struct.pack_into("<IIIIIIII", img, 8,
                     len(kernel), 0, len(ramdisk), 0, 0, 0, 0, page)
    struct.pack_into("<I", img, 40, 2)                    # header_version = 2
    struct.pack_into("<I", img, 1632, 0)                  # recovery_dtbo_size
    struct.pack_into("<I", img, 1648, len(dtb))           # dtb_size
    img[page:page + len(kernel)] = kernel
    img[2 * page:2 * page + len(ramdisk)] = ramdisk
    img[dtb_off:dtb_off + len(dtb)] = dtb
    with tempfile.NamedTemporaryFile(suffix=".img", delete=False) as f:
        f.write(img); path = f.name
    try:
        info = fw.inspect_image({"path": path})
        assert info["status"] == "ok" and info["container"] == "boot", info
        assert info["info"]["header_version"] == 2 and info["info"]["has_dtb"]
        a = fw.analyze_dtb({"path": path})
        assert a["status"] == "ok" and a["source"] == "boot.img(dtb)", a
        assert "mediatek,mt6765" in a["report"]["compatible"]["value"]
    finally:
        os.unlink(path)
    print("  ✓ boot.img v2 inspected; embedded DTB extracted + decoded")


def test_dt_table():
    dtb = _simple_dtb()
    hdr = struct.pack(">8I", 0xD7B7AB1E, 64 + len(dtb), 32, 32, 1, 32, 2048, 0)
    entry = struct.pack(">IIII", len(dtb), 64, 0, 0) + b"\x00" * 16
    blob = hdr + entry + dtb
    with tempfile.NamedTemporaryFile(suffix=".img", delete=False) as f:
        f.write(blob); path = f.name
    try:
        info = fw.inspect_image({"path": path})
        assert info["status"] == "ok" and info["container"] == "dt_table"
        assert info["entry_count"] == 1
        a = fw.analyze_dtb({"path": path})
        assert a["status"] == "ok" and a["source"] == "dt_table[0]", a
        assert a["report"]["soc"]["confidence"] == "CONFIRMED"
    finally:
        os.unlink(path)
    print("  ✓ dtbo/dt_table inspected; entry 0 decoded")


def test_extract_bootimg():
    dtb = _simple_dtb()
    page = 2048
    kernel, ramdisk = b"KERNELDATA", b"RAMD"
    dtb_off = page * 3
    img = bytearray(dtb_off + len(dtb))
    img[0:8] = b"ANDROID!"
    struct.pack_into("<IIIIIIII", img, 8, len(kernel), 0, len(ramdisk), 0, 0, 0, 0, page)
    struct.pack_into("<I", img, 40, 2)
    struct.pack_into("<I", img, 1648, len(dtb))
    img[page:page + len(kernel)] = kernel
    img[2 * page:2 * page + len(ramdisk)] = ramdisk
    img[dtb_off:dtb_off + len(dtb)] = dtb
    d = tempfile.mkdtemp()
    ipath = os.path.join(d, "boot.img")
    open(ipath, "wb").write(img)
    out = os.path.join(d, "ex")
    r = fw.extract_image({"path": ipath, "out": out})
    assert r["status"] == "ok", r
    files = {os.path.basename(w["file"]) for w in r["written"]}
    assert {"kernel", "ramdisk", "dtb.dtb"} <= files, files
    assert open(os.path.join(out, "kernel"), "rb").read() == kernel
    a = fw.analyze_dtb({"path": os.path.join(out, "dtb.dtb")})
    assert a["status"] == "ok" and a["report"]["soc"]["confidence"] == "CONFIRMED"
    print("  ✓ boot.img extracted (kernel/ramdisk/dtb) and extracted DTB decodes")


def test_plan_is_readonly():
    r = fw.collect_evidence_plan({})
    assert r["status"] == "ok" and r["level"].startswith("0")
    assert all(("flash" not in c and "erase" not in c and "format" not in c)
               for c in r["commands"]), "evidence plan must be read-only"
    print("  ✓ evidence plan is read-only (no flash/erase/format)")


if __name__ == "__main__":
    test_analyze_dtb()
    test_board_report()
    test_bootimg_v2_embedded_dtb()
    test_dt_table()
    test_extract_bootimg()
    test_plan_is_readonly()
    print("\nFIRMWARE TESTS PASSED")
