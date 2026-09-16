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
import struct

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


def analyze_dtb(args: dict) -> dict:
    path = args.get("path") or args.get("dtb") or ""
    if not path or not os.path.isfile(path):
        return {"status": "error", "reason": f"no such file: {path}"}
    try:
        root = parse_dtb(open(path, "rb").read())
    except DTBError as e:
        return {"status": "error", "reason": str(e)}

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
    return {"status": "ok", "source": "dtb", "path": path,
            "node_count": sum(1 for _ in _walk(root)),
            "report": report,
            "unknown_fields": unknown,
            "note": "UNKNOWN fields need more evidence (kernel source, DTBO, dmesg). "
                    "Values are only what the DTB actually declares — nothing guessed."}


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
                        "Decode a flattened device tree (.dtb) and summarise "
                        "board/soc/cpu/display/touch/etc. with confidences. Read-only.",
                        "args": {"path": "path to a .dtb file"},
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
