"""
OMERTA firmware bring-up tools — evidence-first, read-only (Level 0).

Realises the `omerta firmware dtb` / `omerta device report` ideas as agent
tools that never guess: every field they emit carries a confidence
(CONFIRMED / LIKELY / INFERRED / UNKNOWN), and anything not supported by the
input is reported as UNKNOWN rather than invented.

Tools (all read-only, so none require approval):
  - analyze_dtb(path)          decode a flattened device tree (.dtb) with a
                               pure-Python FDT parser — no `dtc` needed — and
                               summarise board/soc/cpu/memory/display/touch/…
  - board_report(evidence_dir) fuse an adb-collected evidence dir (getprop,
                               cpuinfo, meminfo, partitions, dmesg, + optional
                               .dtb) into a BOARD REPORT with confidences
  - collect_evidence_plan()    the ordered, read-only adb command list to
                               gather evidence (the agent proposes each through
                               the normal gate)

Anything that writes to a device (adb push, fastboot flash, erase, format) is
NOT here: those stay Level 3/4 and go through the agent's approval gate and
hard-deny list.
"""
import os
import re
import json
import struct
import hashlib

MANIFEST = {
    "name": "firmware_bringup",
    "description": "Read-only firmware/device-tree analysis: decode a DTB, and "
                   "build a hardware BOARD REPORT from adb evidence, with "
                   "CONFIDENCE markings and no guessing.",
    "version": "1.0",
}

FDT_MAGIC = 0xD00DFEED
FDT_BEGIN_NODE, FDT_END_NODE, FDT_PROP, FDT_NOP, FDT_END = 1, 2, 3, 4, 9

# SoC families we can name with confidence straight from a `compatible` string.
_SOC_HINTS = {
    "mt6765": "MediaTek MT6765 (Helio P35/G35/G36 family)",
    "mt6768": "MediaTek MT6768 (Helio P65/G70 family)",
    "mt6785": "MediaTek MT6785 (Helio G90 family)",
    "mt6833": "MediaTek Dimensity 700 (MT6833)",
    "mt6853": "MediaTek Dimensity 720/800 (MT6853)",
    "sm6115": "Qualcomm Snapdragon 662 (SM6115)",
    "sm8250": "Qualcomm Snapdragon 865 (SM8250)",
}


# ── pure-Python flattened device tree (FDT/DTB) parser ──────────────────────
class DTBError(Exception):
    pass


def _cstr(buf, off):
    end = buf.index(b"\x00", off)
    return buf[off:end].decode("utf-8", "replace")


# Property names that are integer cell arrays, never strings — DTB stores no
# type, so (like dtc) we use the name to avoid decoding a reg as text.
_INT_PROPS = {
    "reg", "#address-cells", "#size-cells", "#interrupt-cells", "interrupts",
    "interrupt-parent", "clocks", "clock-frequency", "phandle", "linux,phandle",
    "gpios", "reg-names", "dma-ranges", "ranges", "cpu-release-addr",
}


def _prop_value(name, raw):
    """Best-effort decode of a property value into something human-readable."""
    if not raw:
        return True                       # boolean/empty property
    if name not in _INT_PROPS and raw[-1] == 0 and \
            all(b >= 32 or b in (0, 9, 10, 13) for b in raw):
        try:
            parts = [p.decode("utf-8") for p in raw.split(b"\x00") if p]
        except UnicodeDecodeError:
            parts = []
        if parts:
            return parts if len(parts) > 1 else parts[0]
    if len(raw) % 4 == 0:                 # array of big-endian u32 cells
        return list(struct.unpack(">%dI" % (len(raw) // 4), raw))
    return "<%d bytes>" % len(raw)


def parse_dtb(data: bytes) -> dict:
    if len(data) < 40:
        raise DTBError("file too small to be a DTB")
    (magic, totalsize, off_struct, off_strings, _off_rsv, _version,
     _last_comp, _boot_cpuid, size_strings, size_struct) = struct.unpack(
        ">10I", data[:40])
    if magic != FDT_MAGIC:
        raise DTBError("bad FDT magic 0x%08x (not a flattened device tree)" % magic)
    strings = data[off_strings:off_strings + size_strings]
    s = data[off_struct:off_struct + size_struct] if size_struct else data[off_struct:]

    pos = 0
    root = {"name": "", "props": {}, "children": []}
    stack = [root]

    def u32():
        nonlocal pos
        v = struct.unpack_from(">I", s, pos)[0]
        pos += 4
        return v

    while pos < len(s):
        tok = u32()
        if tok == FDT_BEGIN_NODE:
            name = _cstr(s, pos)
            pos += len(name.encode()) + 1
            pos = (pos + 3) & ~3
            node = {"name": name, "props": {}, "children": []}
            stack[-1]["children"].append(node)
            stack.append(node)
        elif tok == FDT_END_NODE:
            if len(stack) > 1:
                stack.pop()
        elif tok == FDT_PROP:
            plen = u32()
            noff = u32()
            raw = s[pos:pos + plen]
            pos = (pos + plen + 3) & ~3
            pname = _cstr(strings, noff)
            stack[-1]["props"][pname] = _prop_value(pname, raw)
        elif tok == FDT_NOP:
            continue
        elif tok == FDT_END:
            break
        else:
            raise DTBError("unknown FDT token %d at offset %d" % (tok, pos - 4))
    # unwrap the synthetic container: the DTB's own root is its first child
    if not root["props"] and len(root["children"]) == 1:
        return root["children"][0]
    return root


def _walk(node, path=""):
    here = path + "/" + node["name"] if node["name"] else path or "/"
    yield here, node
    for c in node["children"]:
        yield from _walk(c, here if here != "/" else "")


def _find(root, needles):
    """Nodes whose name or `compatible` mentions any needle. Returns hits with
    their compatibles so nothing is asserted beyond what the DTB declares."""
    out = []
    for path, node in _walk(root):
        comp = node["props"].get("compatible", "")
        comp_s = " ".join(comp) if isinstance(comp, list) else str(comp)
        hay = (path + " " + comp_s).lower()
        if any(n in hay for n in needles):
            out.append({"path": path, "compatible": comp_s or None})
    return out


def _field(value, confidence, source):
    return {"value": value, "confidence": confidence, "source": source}


def _summarize_root(root, path, source="dtb") -> dict:
    props = root["props"]
    model = props.get("model")
    compat = props.get("compatible")
    compat_list = compat if isinstance(compat, list) else ([compat] if compat else [])

    soc = _field(None, "UNKNOWN", "not found in DTB")
    for c in compat_list:
        for key, label in _SOC_HINTS.items():
            if key in str(c).lower():
                soc = _field(label, "CONFIRMED", f"compatible '{c}'")
                break

    cpus = [n for p, n in _walk(root)
            if n["name"].startswith("cpu@") or n["name"] == "cpu"]
    cpu_compat = sorted({(" ".join(n["props"]["compatible"])
                          if isinstance(n["props"].get("compatible"), list)
                          else str(n["props"].get("compatible")))
                         for n in cpus if n["props"].get("compatible")})

    def present(label, needles):
        hits = _find(root, needles)
        if not hits:
            return _field(None, "UNKNOWN", "no matching node in DTB")
        comps = sorted({h["compatible"] for h in hits if h["compatible"]})
        return _field(comps or [h["path"] for h in hits[:4]],
                      "CONFIRMED" if comps else "LIKELY",
                      f"{len(hits)} node(s) in DTB")

    report = {
        "model": _field(model, "CONFIRMED" if model else "UNKNOWN", "DTB root /model"),
        "compatible": _field(compat_list or None,
                             "CONFIRMED" if compat_list else "UNKNOWN",
                             "DTB root /compatible"),
        "soc": soc,
        "cpu": _field(cpu_compat or (f"{len(cpus)} cpu node(s)" if cpus else None),
                      "CONFIRMED" if cpus else "UNKNOWN", "DTB /cpus"),
        "memory_nodes": _field([p for p, n in _walk(root)
                                if n["name"].startswith("memory")] or None,
                               "LIKELY", "DTB memory node (decode reg with #cells)"),
        "regulators": present("regulators", ["regulator", "pmic", "mt635", "mt6357", "mt6358"]),
        "pinctrl_gpio": present("pinctrl/gpio", ["pinctrl", "gpio", "pio"]),
        "display_panel": present("display/panel", ["panel", "dsi", "display", "mipi"]),
        "touchscreen": present("touchscreen", ["touch", "goodix", "focal", "fts", "synaptics", "novatek", "himax"]),
        "usb": present("usb", ["usb", "dwc3", "musb", "typec", "tcpc"]),
        "audio": present("audio", ["audio", "codec", "sound", "mt6357-sound"]),
        "camera": present("camera", ["camera", "cam", "imx", "ov", "gc", "s5k", "hi"]),
        "thermal": present("thermal", ["thermal", "thermal-zones"]),
        "battery_charger": present("battery/charger", ["battery", "charger", "charging", "fuel", "gauge"]),
    }
    unknown = [k for k, v in report.items() if v["confidence"] == "UNKNOWN"]
    return {"status": "ok", "source": source, "path": path,
            "node_count": sum(1 for _ in _walk(root)),
            "report": report,
            "unknown_fields": unknown,
            "note": "UNKNOWN fields need more evidence (kernel source, DTBO, dmesg). "
                    "Values are only what the DTB actually declares — nothing guessed."}


def analyze_dtb(args: dict) -> dict:
    """Analyze a device tree. Accepts a raw .dtb, a dtbo/dt_table image (decodes
    an entry, default 0), or an Android boot image with an embedded DTB (v2).
    Read-only."""
    path = args.get("path") or args.get("dtb") or ""
    if not path or not os.path.isfile(path):
        return {"status": "error", "reason": f"no such file: {path}"}
    data = open(path, "rb").read()
    kind = _detect(data)
    try:
        if kind == "dtb":
            return _summarize_root(parse_dtb(data), path, "dtb")
        if kind == "dt_table":
            entries = parse_dt_table(data)
            if not entries:
                return {"status": "error", "reason": "dt_table has no entries"}
            idx = int(args.get("index", 0))
            if idx >= len(entries):
                return {"status": "error", "reason": f"index {idx} of {len(entries)}"}
            e = entries[idx]
            blob = data[e["offset"]:e["offset"] + e["size"]]
            out = _summarize_root(parse_dtb(blob), path, f"dt_table[{idx}]")
            out["dt_table"] = {"entries": len(entries), "index": idx,
                               "id": e["id"], "rev": e["rev"]}
            return out
        if kind == "bootimg":
            info = parse_bootimg(data)
            if info.get("_dtb_size"):
                blob = data[info["_dtb_offset"]:info["_dtb_offset"] + info["_dtb_size"]]
                out = _summarize_root(parse_dtb(blob), path, "boot.img(dtb)")
                out["boot_image"] = {k: v for k, v in info.items()
                                     if not k.startswith("_")}
                return out
            return {"status": "ok", "source": info.get("type"), "path": path,
                    "report": {}, "info": {k: v for k, v in info.items()
                                           if not k.startswith("_")},
                    "note": "No embedded DTB in this image "
                            "(boot v3+/vendor_boot keep the DTB in vendor_boot.img)."}
    except (DTBError, struct.error) as e:
        return {"status": "error", "reason": str(e)}
    return {"status": "error", "reason": "unrecognized image (not FDT/dt_table/boot)"}


# ── Android boot image + DTBO/DT table containers (read-only) ────────────────
DT_TABLE_MAGIC = 0xD7B7AB1E
BOOT_MAGIC = b"ANDROID!"
VENDOR_BOOT_MAGIC = b"VNDRBOOT"


def _os_version(v):
    """Decode the packed os_version+patch field of an Android boot header."""
    if not v:
        return None
    ver = v >> 11
    a, b, c = (ver >> 14) & 0x7F, (ver >> 7) & 0x7F, ver & 0x7F
    patch = v & 0x7FF
    year, month = 2000 + (patch >> 4), patch & 0xF
    return f"{a}.{b}.{c} (patch {year:04d}-{month:02d})"


def _round(x, page):
    return ((x + page - 1) // page) * page if page else x


def parse_bootimg(data: bytes) -> dict:
    """Parse an Android boot/vendor_boot image header (v0–v4). Read-only."""
    if data[:8] == VENDOR_BOOT_MAGIC:
        # vendor_boot v3/v4: magic, header_version, page_size, kernel_addr,
        # ramdisk_addr, vendor_ramdisk_size, cmdline[2048], tags_addr, name[16],
        # header_size, dtb_size ...
        hv, page = struct.unpack_from("<II", data, 8)
        vraml, = struct.unpack_from("<I", data, 16 + 8)   # after two addrs
        cmd = data[28:28 + 2048].split(b"\x00", 1)[0].decode("utf-8", "replace")
        # dtb_size sits after cmdline(2048)+tags_addr(4)+name(16)+header_size(4)
        off = 28 + 2048 + 4 + 16 + 4
        dtb_size, = struct.unpack_from("<I", data, off)
        return {"type": "vendor_boot", "header_version": hv, "page_size": page,
                "vendor_ramdisk_size": vraml, "dtb_size": dtb_size,
                "cmdline": cmd, "has_dtb": dtb_size > 0}

    if data[:8] != BOOT_MAGIC:
        raise DTBError("not an Android boot image (missing ANDROID! magic)")
    header_version = struct.unpack_from("<I", data, 40)[0]
    if header_version >= 3:
        kernel_size, ramdisk_size, os_ver, header_size = struct.unpack_from("<IIII", data, 8)
        cmd = data[44:44 + 1536].split(b"\x00", 1)[0].decode("utf-8", "replace")
        return {"type": "boot", "header_version": header_version,
                "page_size": 4096, "kernel_size": kernel_size,
                "ramdisk_size": ramdisk_size, "os_version": _os_version(os_ver),
                "cmdline": cmd, "has_dtb": False,
                "note": "boot v3+/vendor_boot holds the DTB in vendor_boot.img"}
    # classic v0/v1/v2
    (kernel_size, ka, ramdisk_size, ra, second_size, sa, tags,
     page_size) = struct.unpack_from("<IIIIIIII", data, 8)
    os_ver = struct.unpack_from("<I", data, 44)[0]
    name = data[48:48 + 16].split(b"\x00", 1)[0].decode("utf-8", "replace")
    cmd = data[64:64 + 512].split(b"\x00", 1)[0].decode("utf-8", "replace")
    extra = data[608:608 + 1024].split(b"\x00", 1)[0].decode("utf-8", "replace")
    out = {"type": "boot", "header_version": header_version, "page_size": page_size,
           "kernel_size": kernel_size, "ramdisk_size": ramdisk_size,
           "second_size": second_size, "os_version": _os_version(os_ver),
           "cmdline": (cmd + " " + extra).strip(), "has_dtb": False}
    # fields needed to rebuild the image byte-faithfully (hidden from inspect)
    raw = {"header_version": header_version, "page_size": page_size,
           "kernel_addr": ka, "ramdisk_addr": ra, "second_addr": sa,
           "tags_addr": tags, "os_version": os_ver, "name": name,
           "cmdline": cmd, "extra_cmdline": extra}
    recovery_dtbo_size = 0
    if header_version >= 1:
        recovery_dtbo_size = struct.unpack_from("<I", data, 1632)[0]
        raw["header_size"] = struct.unpack_from("<I", data, 1644)[0]
    if header_version >= 2:
        dtb_size = struct.unpack_from("<I", data, 1648)[0]
        raw["dtb_addr"] = struct.unpack_from("<Q", data, 1652)[0]
        out["dtb_size"] = dtb_size
        out["has_dtb"] = dtb_size > 0
        if dtb_size:
            p = page_size
            off = (_round(p, p) + _round(kernel_size, p) + _round(ramdisk_size, p)
                   + _round(second_size, p) + _round(recovery_dtbo_size, p))
            out["_dtb_offset"], out["_dtb_size"] = off, dtb_size
    out["_raw"] = raw
    return out


def parse_dt_table(data: bytes) -> list:
    """Parse a dt_table (dtbo.img / dtb.img). Returns entry list. Read-only."""
    magic, total, hsize, esize, ecount, eoff, page, ver = struct.unpack(">8I", data[:32])
    if magic != DT_TABLE_MAGIC:
        raise DTBError("not a dt_table (bad magic 0x%08x)" % magic)
    entries = []
    for i in range(ecount):
        base = eoff + i * esize
        dt_size, dt_off, dt_id, rev = struct.unpack_from(">IIII", data, base)
        entries.append({"index": i, "size": dt_size, "offset": dt_off,
                        "id": dt_id, "rev": rev})
    return entries


def _detect(data: bytes) -> str:
    if data[:8] in (BOOT_MAGIC, VENDOR_BOOT_MAGIC):
        return "bootimg"
    if len(data) >= 4 and struct.unpack(">I", data[:4])[0] == DT_TABLE_MAGIC:
        return "dt_table"
    if len(data) >= 4 and struct.unpack(">I", data[:4])[0] == FDT_MAGIC:
        return "dtb"
    return "unknown"


def inspect_image(args: dict) -> dict:
    """Identify a firmware image (boot / vendor_boot / dtbo table / raw dtb) and
    report its structure. Read-only; nothing is unpacked to disk."""
    path = args.get("path") or ""
    if not path or not os.path.isfile(path):
        return {"status": "error", "reason": f"no such file: {path}"}
    data = open(path, "rb").read()
    kind = _detect(data)
    if kind == "bootimg":
        try:
            info = parse_bootimg(data)
        except (DTBError, struct.error) as e:
            return {"status": "error", "reason": str(e)}
        info = {k: v for k, v in info.items() if not k.startswith("_")}
        return {"status": "ok", "path": path, "container": info.get("type"),
                "info": info,
                "note": "Read-only header parse. Use analyze_dtb to pull the "
                        "embedded/vendor DTB where present."}
    if kind == "dt_table":
        try:
            entries = parse_dt_table(data)
        except (DTBError, struct.error) as e:
            return {"status": "error", "reason": str(e)}
        return {"status": "ok", "path": path, "container": "dt_table",
                "entry_count": len(entries), "entries": entries,
                "note": "DTBO/DT table. analyze_dtb will decode entry 0 (or set index)."}
    if kind == "dtb":
        return {"status": "ok", "path": path, "container": "dtb",
                "note": "Raw flattened device tree — analyze_dtb decodes it."}
    return {"status": "error", "reason": "unrecognized image "
            "(not ANDROID!/VNDRBOOT/dt_table/FDT)"}


def extract_image(args: dict) -> dict:
    """Extract the parts of a firmware image to a directory (read the image,
    write the pieces). Boot images yield kernel/ramdisk/second/dtb; dtbo/dt_table
    images yield one .dtb per entry. Writes files, so it is a side-effecting tool
    (approval-gated when the agent uses it)."""
    path = args.get("path") or ""
    out = args.get("out") or args.get("dir") or ""
    if not path or not os.path.isfile(path):
        return {"status": "error", "reason": f"no such file: {path}"}
    if not out:
        out = path + ".extracted"
    data = open(path, "rb").read()
    kind = _detect(data)
    os.makedirs(out, exist_ok=True)
    written = []

    def dump(name, blob):
        p = os.path.join(out, name)
        with open(p, "wb") as f:
            f.write(blob)
        written.append({"file": p, "bytes": len(blob)})

    try:
        if kind == "bootimg":
            info = parse_bootimg(data)
            page = info.get("page_size", 4096)
            if info.get("type") == "boot" and info.get("header_version", 9) <= 2:
                ks, rs, ss = (info.get("kernel_size", 0), info.get("ramdisk_size", 0),
                              info.get("second_size", 0))
                off = _round(page, page)
                if ks:
                    dump("kernel", data[off:off + ks]); off += _round(ks, page)
                if rs:
                    dump("ramdisk", data[off:off + rs]); off += _round(rs, page)
                if ss:
                    dump("second", data[off:off + ss]); off += _round(ss, page)
                if info.get("_dtb_size"):
                    dump("dtb.dtb", data[info["_dtb_offset"]:
                                        info["_dtb_offset"] + info["_dtb_size"]])
                # manifest so repack_image can rebuild the header faithfully
                manifest = os.path.join(out, "bootimg.json")
                with open(manifest, "w") as f:
                    json.dump(info.get("_raw", {}), f, indent=2)
                written.append({"file": manifest, "bytes": os.path.getsize(manifest)})
            else:
                return {"status": "error",
                        "reason": "extract supports classic boot v0–v2; boot v3+/"
                                  "vendor_boot repack is a Planned follow-up"}
        elif kind == "dt_table":
            for e in parse_dt_table(data):
                dump(f"{e['index']:02d}_id{e['id']}_rev{e['rev']}.dtb",
                     data[e["offset"]:e["offset"] + e["size"]])
        elif kind == "dtb":
            dump("copy.dtb", data)
        else:
            return {"status": "error", "reason": "unrecognized image"}
    except (DTBError, struct.error) as e:
        return {"status": "error", "reason": str(e)}
    return {"status": "ok", "source": kind, "out": out,
            "written": written, "count": len(written),
            "note": "Extracted read-only from the image. Analyze any .dtb with "
                    "analyze_dtb. Repack is not implemented (Planned)."}


def repack_image(args: dict) -> dict:
    """Rebuild a classic Android boot image (v0–v2) from a directory produced by
    extract_image (kernel/ramdisk/second/dtb.dtb + bootimg.json). Writes a new
    image; the standard SHA1 id is recomputed. Boot v3+/vendor_boot repack is not
    supported (returns an honest error)."""
    d = args.get("dir") or args.get("in") or ""
    out = args.get("out") or (os.path.join(d, "repacked-boot.img") if d else "")
    manifest = os.path.join(d, "bootimg.json")
    if not d or not os.path.isfile(manifest):
        return {"status": "error",
                "reason": f"no bootimg.json in {d} — run extract_image on a classic "
                          "boot image first (v3+/vendor_boot repack is unsupported)"}
    raw = json.loads(open(manifest).read())
    hv = int(raw.get("header_version", 0))
    if hv > 2:
        return {"status": "error", "reason": "only classic boot v0–v2 repack is supported"}
    page = int(raw.get("page_size", 2048))

    def rd(name):
        p = os.path.join(d, name)
        return open(p, "rb").read() if os.path.isfile(p) else b""

    kernel, ramdisk, second, dtb = (rd("kernel"), rd("ramdisk"), rd("second"),
                                    rd("dtb.dtb"))

    def pad(b):
        return b + b"\x00" * ((_round(len(b), page)) - len(b))

    # standard mkbootimg SHA1 id over the pieces (+ their sizes)
    sha = hashlib.sha1()
    for part, size in ((kernel, len(kernel)), (ramdisk, len(ramdisk)),
                       (second, len(second))):
        sha.update(part); sha.update(struct.pack("<I", size))
    if hv >= 2:
        sha.update(dtb); sha.update(struct.pack("<I", len(dtb)))
    img_id = (sha.digest() + b"\x00" * 32)[:32]

    hdr = bytearray(_round(1660, page) if page < 1660 else page)
    hdr[0:8] = b"ANDROID!"
    struct.pack_into("<IIIIIIII", hdr, 8,
                     len(kernel), int(raw.get("kernel_addr", 0)),
                     len(ramdisk), int(raw.get("ramdisk_addr", 0)),
                     len(second), int(raw.get("second_addr", 0)),
                     int(raw.get("tags_addr", 0)), page)
    struct.pack_into("<I", hdr, 40, hv)
    struct.pack_into("<I", hdr, 44, int(raw.get("os_version", 0)))
    nm = raw.get("name", "").encode()[:16]
    hdr[48:48 + len(nm)] = nm
    cm = raw.get("cmdline", "").encode()[:512]
    hdr[64:64 + len(cm)] = cm
    hdr[576:576 + 32] = img_id
    ex = raw.get("extra_cmdline", "").encode()[:1024]
    hdr[608:608 + len(ex)] = ex
    if hv >= 1:
        struct.pack_into("<I", hdr, 1632, 0)          # recovery_dtbo_size
        struct.pack_into("<Q", hdr, 1636, 0)          # recovery_dtbo_offset
        struct.pack_into("<I", hdr, 1644, int(raw.get("header_size", 1648)))
    if hv >= 2:
        struct.pack_into("<I", hdr, 1648, len(dtb))
        struct.pack_into("<Q", hdr, 1652, int(raw.get("dtb_addr", 0)))

    blob = bytes(hdr[:page]) if len(hdr) >= page else pad(bytes(hdr))
    for part in (kernel, ramdisk, second):
        if part:
            blob += pad(part)
    if hv >= 2 and dtb:
        blob += pad(dtb)

    with open(out, "wb") as f:
        f.write(blob)
    return {"status": "ok", "out": out, "bytes": len(blob),
            "header_version": hv, "id_sha1": img_id[:20].hex(),
            "parts": {"kernel": len(kernel), "ramdisk": len(ramdisk),
                      "second": len(second), "dtb": len(dtb)},
            "note": "Rebuilt classic boot image with a recomputed SHA1 id. Verify "
                    "with inspect_image before flashing; flashing stays gated."}


# ── evidence-directory → BOARD REPORT ───────────────────────────────────────
def _read(d, name):
    p = os.path.join(d, name)
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def _getprop(text, key):
    m = re.search(r"^\[" + re.escape(key) + r"\]:\s*\[(.*)\]\s*$", text, re.M)
    return m.group(1) if m else None


def board_report(args: dict) -> dict:
    d = args.get("dir") or args.get("evidence_dir") or ""
    if not d or not os.path.isdir(d):
        return {"status": "error", "reason": f"no such evidence dir: {d}"}

    getprop = _read(d, "getprop.txt") or _read(d, "stock-getprop.txt")
    cpuinfo = _read(d, "cpuinfo.txt") or _read(d, "stock-cpuinfo.txt")
    meminfo = _read(d, "meminfo.txt") or _read(d, "stock-meminfo.txt")
    partitions = (_read(d, "by-name.txt") or _read(d, "stock-by-name.txt")
                  or _read(d, "partitions.txt"))
    dmesg = _read(d, "dmesg.txt") or _read(d, "stock-dmesg.txt")

    rep = {}

    def prop_field(key):
        v = _getprop(getprop, key) if getprop else None
        return _field(v, "CONFIRMED" if v else "UNKNOWN",
                      f"getprop {key}" if v else "not in getprop")

    rep["model"] = prop_field("ro.product.model")
    rep["device"] = prop_field("ro.product.device")
    rep["board"] = prop_field("ro.board.platform")
    rep["hardware"] = prop_field("ro.hardware")
    rep["android"] = prop_field("ro.build.version.release")
    rep["security_patch"] = prop_field("ro.build.version.security_patch")
    rep["slot_suffix"] = prop_field("ro.boot.slot_suffix")

    mt = re.search(r"^MemTotal:\s*(\d+)\s*kB", meminfo, re.M) if meminfo else None
    if mt:
        gb = round(int(mt.group(1)) / (1024 * 1024), 2)
        rep["ram"] = _field(f"{gb} GB ({mt.group(1)} kB MemTotal)", "CONFIRMED", "meminfo")
    else:
        rep["ram"] = _field(None, "UNKNOWN", "meminfo missing")

    proc = re.search(r"^Hardware\s*:\s*(.+)$", cpuinfo, re.M) if cpuinfo else None
    ncores = len(re.findall(r"^processor\s*:", cpuinfo, re.M)) if cpuinfo else 0
    rep["cpu"] = _field(
        (f"{proc.group(1).strip()}" if proc else None,
         f"{ncores} cores" if ncores else None),
        "CONFIRMED" if (proc or ncores) else "UNKNOWN", "cpuinfo")

    def dmesg_scan(label, patterns):
        if not dmesg:
            return _field(None, "UNKNOWN", "no dmesg")
        hits = []
        for pat in patterns:
            for m in re.finditer(pat, dmesg, re.I):
                line = dmesg[m.start():dmesg.find("\n", m.start())].strip()
                if line and line not in hits:
                    hits.append(line[:160])
                if len(hits) >= 3:
                    break
        return _field(hits or None, "LIKELY" if hits else "UNKNOWN",
                      "dmesg match" if hits else "no dmesg match")

    rep["display"] = dmesg_scan("display", [r"panel", r"\bdsi\b", r"display"])
    rep["touchscreen"] = dmesg_scan("touch", [r"touch", r"goodix", r"focal|fts", r"synaptics|novatek|himax"])
    rep["camera"] = dmesg_scan("camera", [r"camera", r"\bimx\d+", r"\bov\d+", r"sensor"])
    rep["wifi_bt"] = dmesg_scan("wifi/bt", [r"wlan|wifi", r"bluetooth|\bbt\b"])
    rep["charger_pmic"] = dmesg_scan("charger/pmic", [r"charger|charging", r"pmic|mt63\d\d"])
    rep["usb"] = dmesg_scan("usb", [r"\busb\b", r"dwc3|musb", r"typec|tcpc"])

    parts = None
    if partitions:
        names = re.findall(r"->\s*/dev/block/\S+/(\w+)", partitions) \
            or re.findall(r"\b(boot|vendor_boot|dtbo|vbmeta|super|recovery|system|vendor|userdata|metadata|misc)\b",
                          partitions)
        parts = sorted(set(names)) or None
    rep["partitions"] = _field(parts, "CONFIRMED" if parts else "UNKNOWN",
                               "by-name / partitions list")

    # fold in a DTB if one was dropped in the evidence dir
    dtb = next((f for f in sorted(os.listdir(d)) if f.endswith(".dtb")), None)
    dtb_report = None
    if dtb:
        a = analyze_dtb({"path": os.path.join(d, dtb)})
        if a.get("status") == "ok":
            dtb_report = {"file": dtb, "report": a["report"]}

    unknown = [k for k, v in rep.items() if v["confidence"] == "UNKNOWN"]
    return {"status": "ok", "source": "evidence_dir", "dir": d,
            "have": {"getprop": bool(getprop), "cpuinfo": bool(cpuinfo),
                     "meminfo": bool(meminfo), "partitions": bool(partitions),
                     "dmesg": bool(dmesg), "dtb": bool(dtb)},
            "board": rep, "dtb": dtb_report, "unknown_fields": unknown,
            "note": "Evidence-only report. UNKNOWN = collect more (dmesg, DTB, "
                    "kernel). Nothing here is guessed."}


def collect_evidence_plan(args: dict) -> dict:
    serial = (args or {}).get("serial")
    dev = f"-s {serial} " if serial else ""
    out = (args or {}).get("out", "~/t509k-evidence")
    cmds = [
        f"mkdir -p {out}",
        f"adb {dev}devices > {out}/adb-devices.txt",
        f"adb {dev}shell getprop > {out}/getprop.txt",
        f"adb {dev}shell cat /proc/cpuinfo > {out}/cpuinfo.txt",
        f"adb {dev}shell cat /proc/meminfo > {out}/meminfo.txt",
        f"adb {dev}shell cat /proc/partitions > {out}/partitions.txt",
        f"adb {dev}shell cat /proc/cmdline > {out}/cmdline.txt",
        f"adb {dev}shell ls -la /dev/block/by-name > {out}/by-name.txt",
        f"adb {dev}shell cat /proc/device-tree/compatible > {out}/compatible.txt",
        f"adb {dev}shell dmesg > {out}/dmesg.txt",
        f"adb {dev}shell dumpsys battery > {out}/battery.txt",
        f"adb {dev}shell dumpsys thermalservice > {out}/thermal.txt",
    ]
    return {"status": "ok", "level": "0 (read-only)",
            "note": "Run each through the approval gate; all are read-only. "
                    "Then: board_report(dir) and analyze_dtb(<stock.dtb>).",
            "commands": cmds}


def register():
    return {
        "analyze_dtb": {"fn": analyze_dtb, "description":
                        "Decode a device tree — raw .dtb, a dtbo/dt_table image, or "
                        "an Android boot.img with an embedded DTB — and summarise "
                        "board/soc/cpu/display/touch/etc. with confidences. Read-only.",
                        "args": {"path": "path to .dtb / dtbo.img / boot.img",
                                 "index": "dt_table entry index (default 0)"},
                        "side_effects": False},
        "extract_image": {"fn": extract_image, "description":
                          "Extract the parts of a firmware image to a directory "
                          "(boot: kernel/ramdisk/dtb; dtbo: one .dtb per entry). "
                          "Writes files.",
                          "args": {"path": "image path", "out": "output dir"},
                          "side_effects": True},
        "repack_image": {"fn": repack_image, "description":
                         "Rebuild a classic boot image (v0–v2) from an extracted "
                         "dir (+ bootimg.json), recomputing the SHA1 id. Writes a file.",
                         "args": {"dir": "extracted dir", "out": "output image"},
                         "side_effects": True},
        "inspect_image": {"fn": inspect_image, "description":
                          "Identify and structurally inspect a firmware image "
                          "(boot / vendor_boot / dtbo table / raw dtb): header "
                          "version, sizes, cmdline, os_version, dt entries. Read-only.",
                          "args": {"path": "path to a firmware image"},
                          "side_effects": False},
        "board_report": {"fn": board_report, "description":
                         "Fuse an adb evidence directory (getprop/dmesg/partitions/"
                         "+optional .dtb) into a BOARD REPORT with confidences. Read-only.",
                         "args": {"dir": "evidence directory"},
                         "side_effects": False},
        "collect_evidence_plan": {"fn": collect_evidence_plan, "description":
                                  "Return the ordered, read-only adb commands to "
                                  "collect device evidence.",
                                  "args": {"serial": "optional adb serial",
                                           "out": "output dir"},
                                  "side_effects": False},
    }
