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


def test_repack_roundtrip():
    dtb = _simple_dtb()
    page = 2048
    kernel, ramdisk = b"KERNELDATA-1234", b"RAMDISKXY"
    dtb_off = page * 3
    img = bytearray(dtb_off + len(dtb))
    img[0:8] = b"ANDROID!"
    struct.pack_into("<IIIIIIII", img, 8, len(kernel), 0x8000, len(ramdisk), 0x1000000,
                     0, 0, 0x100, page)
    struct.pack_into("<I", img, 40, 2)
    struct.pack_into("<I", img, 44, 0x9abc)           # os_version raw
    img[64:64 + 11] = b"cmd=verify"
    struct.pack_into("<I", img, 1648, len(dtb))
    img[page:page + len(kernel)] = kernel
    img[2 * page:2 * page + len(ramdisk)] = ramdisk
    img[dtb_off:dtb_off + len(dtb)] = dtb
    d = tempfile.mkdtemp()
    ipath = os.path.join(d, "boot.img")
    open(ipath, "wb").write(img)

    ex = os.path.join(d, "ex")
    assert fw.extract_image({"path": ipath, "out": ex})["status"] == "ok"
    assert os.path.isfile(os.path.join(ex, "bootimg.json"))

    out = os.path.join(d, "repacked.img")
    r = fw.repack_image({"dir": ex, "out": out})
    assert r["status"] == "ok" and r["header_version"] == 2, r
    assert r["parts"]["kernel"] == len(kernel)

    # the rebuilt image must inspect + decode identically
    info = fw.inspect_image({"path": out})
    assert info["container"] == "boot" and info["info"]["kernel_size"] == len(kernel)
    a = fw.analyze_dtb({"path": out})
    assert a["status"] == "ok" and a["report"]["soc"]["confidence"] == "CONFIRMED"
    # extracting the repacked image yields byte-identical kernel/ramdisk/dtb
    ex2 = os.path.join(d, "ex2")
    fw.extract_image({"path": out, "out": ex2})
    assert open(os.path.join(ex2, "kernel"), "rb").read() == kernel
    assert open(os.path.join(ex2, "ramdisk"), "rb").read() == ramdisk
    assert open(os.path.join(ex2, "dtb.dtb"), "rb").read() == dtb
    print("  ✓ repack round-trip: extract→repack→extract preserves parts + decodes")


def _build_vendor_boot(hv, page, vr, dtb, table=b"", bcfg=b""):
    header_size = 2128 if hv >= 4 else 2112

    def pad(b):
        return b + b"\x00" * ((-len(b)) % page)
    hdr = bytearray(((header_size + page - 1) // page) * page)
    hdr[0:8] = b"VNDRBOOT"
    struct.pack_into("<IIIII", hdr, 8, hv, page, 0x8000, 0x1000000, len(vr))
    struct.pack_into("<6s", hdr, 28, b"cmd=vb")     # fixed-width, never resizes
    struct.pack_into("<II", hdr, 2096, header_size, len(dtb))
    if hv >= 4:
        struct.pack_into("<IIII", hdr, 2112, len(table), 1, 108, len(bcfg))
    blob = bytes(hdr) + pad(vr) + pad(dtb)
    if hv >= 4:
        blob += pad(table) + pad(bcfg)
    return blob


def test_vendor_boot_roundtrip():
    dtb = _simple_dtb()
    page = 2048
    vr = b"VENDOR-RAMDISK-CONTENT"
    table = b"T" * 108
    bcfg = b"androidboot.x=1\n"
    img = _build_vendor_boot(4, page, vr, dtb, table, bcfg)
    d = tempfile.mkdtemp()
    ipath = os.path.join(d, "vendor_boot.img")
    open(ipath, "wb").write(img)

    info = fw.inspect_image({"path": ipath})
    assert info["status"] == "ok" and info["container"] == "vendor_boot", info
    assert info["info"]["header_version"] == 4 and info["info"]["has_dtb"]

    ex = os.path.join(d, "ex")
    r = fw.extract_image({"path": ipath, "out": ex})
    assert r["status"] == "ok"
    got = {os.path.basename(w["file"]) for w in r["written"]}
    assert {"vendor_ramdisk", "dtb.dtb", "vendor_ramdisk_table", "bootconfig",
            "vendor_bootimg.json"} <= got, got
    a = fw.analyze_dtb({"path": os.path.join(ex, "dtb.dtb")})
    assert a["report"]["soc"]["confidence"] == "CONFIRMED"

    out = os.path.join(d, "repacked.img")
    rp = fw.repack_image({"dir": ex, "out": out})
    assert rp["status"] == "ok" and rp["type"] == "vendor_boot", rp
    # re-extract the repacked image; parts must be byte-identical
    ex2 = os.path.join(d, "ex2")
    fw.extract_image({"path": out, "out": ex2})
    assert open(os.path.join(ex2, "vendor_ramdisk"), "rb").read() == vr
    assert open(os.path.join(ex2, "dtb.dtb"), "rb").read() == dtb
    assert open(os.path.join(ex2, "bootconfig"), "rb").read() == bcfg
    print("  ✓ vendor_boot v4 inspect→extract→repack→extract preserves all parts")


def test_unsparse():
    blk = 4096
    payload = b"RAWDATA!" + b"\x00" * (blk - 8)      # one block
    # sparse header (28) + one RAW chunk header (12) + payload
    hdr = struct.pack("<IHHHHIIII", 0xED26FF3A, 1, 0, 28, 12, blk, 1, 1, 0)
    chunk = struct.pack("<HHII", 0xCAC1, 0, 1, 12 + len(payload)) + payload
    sparse = hdr + chunk
    d = tempfile.mkdtemp()
    sp = os.path.join(d, "s.img")
    open(sp, "wb").write(sparse)
    r = fw.unsparse_image({"path": sp, "out": os.path.join(d, "raw.img")})
    assert r["status"] == "ok" and r["bytes"] == blk, r
    assert open(os.path.join(d, "raw.img"), "rb").read() == payload
    print("  ✓ sparse image decoded to raw (RAW chunk)")


def _build_super(part_name, part_bytes):
    """Minimal raw super image with LP metadata + one linear partition."""
    reserved = b"\x00" * 4096
    # geometry (52 used, padded to 4096), x2
    geo = struct.pack("<II", 0x616C4467, 52) + b"\x00" * 32 \
        + struct.pack("<III", 4096, 1, 4096)
    geo = geo + b"\x00" * (4096 - len(geo))
    # header (128) at slot0 = 4096 + 2*4096 = 12288
    # descriptors: partitions(off0,n1,es52), extents(off52,n1,es24), groups, bdev
    descs = (struct.pack("<III", 0, 1, 52) + struct.pack("<III", 52, 1, 24)
             + struct.pack("<III", 76, 0, 24) + struct.pack("<III", 76, 0, 24))
    header = (struct.pack("<IHHI", 0x414C5030, 10, 0, 128) + b"\x00" * 32
              + struct.pack("<I", 76 + 0) + b"\x00" * 32 + descs)
    header = header + b"\x00" * (128 - len(header))
    # partition data placed at sector 64 (offset 32768)
    start_sector = 64
    nsec = (len(part_bytes) + 511) // 512
    name = part_name.encode()[:36]
    name = name + b"\x00" * (36 - len(name))
    ptable = name + struct.pack("<IIII", 0, 0, 1, 0)               # 52
    etable = struct.pack("<QIQI", nsec, 0, start_sector, 0)        # 24
    slot0 = header + ptable + etable
    # assemble up to the data region
    img = bytearray(reserved + geo + geo + slot0)
    img += b"\x00" * (start_sector * 512 - len(img))
    img += part_bytes + b"\x00" * (nsec * 512 - len(part_bytes))
    return bytes(img)


def test_super_list_and_extract():
    payload = b"SYSTEM-PARTITION-CONTENT" + b"\x00" * 100
    img = _build_super("system", payload)
    d = tempfile.mkdtemp()
    sp = os.path.join(d, "super.img")
    open(sp, "wb").write(img)

    lst = fw.super_list({"path": sp})
    assert lst["status"] == "ok" and lst["partition_count"] == 1, lst
    assert lst["partitions"][0]["name"] == "system"

    out = os.path.join(d, "parts")
    ex = fw.super_extract({"path": sp, "out": out})
    assert ex["status"] == "ok" and ex["count"] == 1, ex
    got = open(os.path.join(out, "system.img"), "rb").read()
    assert got[:len(payload)] == payload, "extracted partition mismatch"
    print("  ✓ super.img LP metadata parsed; logical partition 'system' extracted")


def test_super_from_sparse():
    payload = b"VENDOR" + b"\x00" * 20
    raw = _build_super("vendor", payload)
    # wrap raw as a single-RAW-chunk sparse image (block size 512 for simplicity)
    blk = 512
    assert len(raw) % blk == 0
    nblk = len(raw) // blk
    hdr = struct.pack("<IHHHHIIII", 0xED26FF3A, 1, 0, 28, 12, blk, nblk, 1, 0)
    chunk = struct.pack("<HHII", 0xCAC1, 0, nblk, 12 + len(raw)) + raw
    d = tempfile.mkdtemp()
    sp = os.path.join(d, "super_sparse.img")
    open(sp, "wb").write(hdr + chunk)
    lst = fw.super_list({"path": sp})            # must unsparse transparently
    assert lst["status"] == "ok" and lst["sparse"] is True
    assert lst["partitions"][0]["name"] == "vendor"
    print("  ✓ sparse super.img unsparsed transparently and listed")


def test_super_repack_roundtrip():
    """super_extract -> super_repack -> super_list/extract recovers every byte,
    and the rebuilt metadata carries valid SHA-256 checksums."""
    import hashlib
    parts = {"system": b"SYS-" + b"A" * 600, "vendor": b"VEN-" + b"B" * 200}
    d = tempfile.mkdtemp()
    src = os.path.join(d, "in")
    os.makedirs(src)
    for n, b in parts.items():
        open(os.path.join(src, n + ".img"), "wb").write(b)

    out = os.path.join(d, "super.img")
    r = fw.super_repack({"dir": src, "out": out})
    assert r["status"] == "ok" and len(r["partitions"]) == 2, r

    lst = fw.super_list({"path": out})
    assert lst["status"] == "ok" and lst["partition_count"] == 2, lst
    assert {p["name"] for p in lst["partitions"]} == {"system", "vendor"}

    ex = os.path.join(d, "out")
    fw.super_extract({"path": out, "out": ex})
    for n, b in parts.items():
        got = open(os.path.join(ex, n + ".img"), "rb").read()
        assert got[:len(b)] == b, f"{n} bytes not preserved"

    # checksums must actually verify (geometry + header + tables)
    img = open(out, "rb").read()
    geo = img[4096:4096 + 52]
    geo_zero = geo[:8] + b"\x00" * 32 + geo[40:]
    assert hashlib.sha256(geo_zero).digest() == geo[8:40], "bad geometry checksum"
    slot0 = 4096 + 2 * 4096
    hdr = img[slot0:slot0 + 128]
    hdr_zero = hdr[:12] + b"\x00" * 32 + hdr[44:]
    assert hashlib.sha256(hdr_zero).digest() == hdr[12:44], "bad header checksum"
    tables_size = struct.unpack_from("<I", hdr, 44)[0]
    tables = img[slot0 + 128:slot0 + 128 + tables_size]
    assert hashlib.sha256(tables).digest() == hdr[48:80], "bad tables checksum"
    print("  ✓ super repack round-trip; geometry/header/tables SHA-256 verify")


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
    test_repack_roundtrip()
    test_vendor_boot_roundtrip()
    test_unsparse()
    test_super_list_and_extract()
    test_super_from_sparse()
    test_super_repack_roundtrip()
    test_plan_is_readonly()
    print("\nFIRMWARE TESTS PASSED")
