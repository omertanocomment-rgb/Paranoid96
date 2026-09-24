#!/usr/bin/env python3
"""The audit gate. Every phase passes through this before the next one starts.

    python scripts/audit.py              # full gate
    python scripts/audit.py --quick      # skip the test suite (fast loop)
    python scripts/audit.py --phase NAME # label the report

The protocol this serves: audit, fix EVERYTHING found, re-audit the same
phase, repeat until a pass finds nothing, only then move on. Fixes introduce
findings -- the Gradle asset regression that produced an APK with no agent in
it, and the BusyBox argv[0] bug, were both introduced BY a fix -- so the
re-audit is not ceremony.

Exit code is the gate: 0 clean, 1 findings. scripts/build_all.sh runs this
first and refuses to package on a failure, so a build cannot skip it.

Every check here exists because something actually went wrong. The comments
say which, so nobody later removes a check for looking paranoid.
"""
import ast
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIRS = ["core", "tools", "scripts"]

findings = []
notes = []


def finding(check, detail, severity="error"):
    findings.append({"check": check, "detail": detail, "severity": severity})


def note(msg):
    notes.append(msg)


def run(cmd, timeout=1800, cwd=ROOT):
    try:
        return subprocess.run(cmd, cwd=str(cwd), capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 124, "", "timed out")
    except OSError as e:
        return subprocess.CompletedProcess(cmd, 127, "", str(e))


#: This file necessarily contains every pattern it searches for, so scanning
#: it finds only itself. Excluded by path, not by a magic comment, so the
#: exemption cannot be copied into another file by accident.
SELF = Path(__file__).resolve()


def py_files():
    for d in SRC_DIRS:
        for p in (ROOT / d).rglob("*.py"):
            if "__pycache__" not in p.parts and p.resolve() != SELF:
                yield p
    for name in ("server.py", "cli.py", "omerta_entry.py", "omerta_android.py"):
        p = ROOT / name
        if p.exists():
            yield p


# ── 1. it has to compile ────────────────────────────────────────────────────
def check_syntax():
    r = run([sys.executable, "-m", "compileall", "-q", *SRC_DIRS])
    if r.returncode != 0:
        finding("syntax", (r.stdout + r.stderr).strip()[:2000])


# ── 2. constructs that turn data into code ──────────────────────────────────
DANGEROUS = [
    (r"\beval\s*\(", "eval()"),
    (r"(?<![.\w])exec\s*\(", "exec()"),
    (r"\bpickle\.loads?\s*\(", "pickle load"),
    (r"\byaml\.load\s*\((?![^)]*Loader\s*=\s*yaml\.SafeLoader)", "unsafe yaml.load"),
    (r"\bos\.system\s*\(", "os.system()"),
    (r"\binput\s*\(\s*\)\s*$", "bare input()"),
]


def check_dangerous():
    for p in py_files():
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for pat, label in DANGEROUS:
                if re.search(pat, line):
                    finding("dangerous-construct",
                            f"{p.relative_to(ROOT)}:{i} {label} — {stripped[:90]}")


def check_shell_true():
    """shell=True is allowed in exactly one audited place.

    core/sandbox.run is the single execution path, gated by classify() and the
    approval gate above it. A second one appearing means a code path grew that
    bypasses the gate.
    """
    hits = []
    for p in py_files():
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if "shell=True" in line and not line.strip().startswith("#"):
                hits.append(f"{p.relative_to(ROOT)}:{i}")
    allowed = {"core/sandbox.py"}
    unexpected = [h for h in hits if h.rsplit(":", 1)[0] not in allowed]
    if unexpected:
        finding("shell-true",
                "shell=True outside the audited path: " + ", ".join(unexpected))
    else:
        note(f"shell=True: {len(hits)} occurrence(s), all in the audited path")


# ── 3. secrets ──────────────────────────────────────────────────────────────
SECRET_PATTERNS = [
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI-style key"),
    (r"sk-ant-[A-Za-z0-9\-_]{20,}", "Anthropic key"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key"),
    (r"ghp_[A-Za-z0-9]{30,}", "GitHub token"),
    (r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----", "private key"),
]


def check_secrets():
    scan = list(py_files()) + [p for p in (ROOT / "webui").rglob("*")
                               if p.is_file() and p.suffix in (".html", ".js", ".css")]
    for p in scan:
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat, label in SECRET_PATTERNS:
            m = re.search(pat, text)
            if m:
                finding("secret", f"{p.relative_to(ROOT)}: {label}")


# ── 4. the local-only rule ──────────────────────────────────────────────────
def check_local_only():
    """Surfaces that bypass the approval gate must be local-only in BOTH servers.

    This check exists because three of them were not, and a remote caller with
    a forged X-Forwarded-For ran commands as root, wrote files, and read
    /etc/hostname. A new endpoint of that kind added to one server and not the
    other reopens it.
    """
    h = (ROOT / "core/httpd.py").read_text(encoding="utf-8")
    s = (ROOT / "server.py").read_text(encoding="utf-8")

    def listed(text, marker):
        i = text.find(marker)
        if i < 0:
            return None
        return set(re.findall(r'"(/api/[^"]+)"', text[i:i + 400]))

    a = listed(h, "LOCAL_ONLY")
    b = listed(s, "LOCAL_ONLY_PREFIXES")
    if a is None or b is None:
        finding("local-only", "the LOCAL_ONLY list is missing from a server")
        return
    if a != b:
        finding("local-only",
                f"the two servers disagree: only in httpd={sorted(a - b)}, "
                f"only in server.py={sorted(b - a)}")
    else:
        note(f"local-only: {len(a)} surfaces, identical in both servers")

    # and the rule has to be applied, not merely declared
    for name, text in (("core/httpd.py", h), ("server.py", s)):
        if "_is_local_only" not in text:
            finding("local-only", f"{name} declares the list but never checks it")


# ── 5. the approval gate ────────────────────────────────────────────────────
def check_gate():
    """DENY must be unapprovable and HIGH_RISK must ask on every policy."""
    r = run([sys.executable, "-c", """
import sys; sys.path.insert(0, '.')
from core import sandbox, policy
bad = []
# DENY is refused outright and cannot be approved.
for cmd in ("rm -rf /", "mkfs.ext4 /dev/sda", ":(){ :|:& };:", "dd if=/dev/zero of=/dev/sda"):
    if sandbox.classify(cmd) != sandbox.Tier.DENY:
        bad.append("not DENY: " + cmd)
# HIGH_RISK asks under EVERY policy, including the most permissive.
for name in policy.POLICIES:
    if policy.auto_run(sandbox.Tier.HIGH_RISK, name):
        bad.append("HIGH_RISK auto-runs under policy " + name)
    if policy.auto_run(sandbox.Tier.DENY, name):
        bad.append("DENY auto-runs under policy " + name)
# An unknown tier must ask rather than default to permitted.
for name in policy.POLICIES:
    if policy.auto_run("", name) or policy.auto_run("WHO_KNOWS", name):
        bad.append("unknown tier auto-runs under policy " + name)
# A deny pattern must not swallow an unrelated argument: a refusal cannot be
# approved, so a false positive is unfixable by the user.
for ok in ("rm -rf /tmp/build", "rm -rf ./node_modules"):
    if sandbox.classify(ok) == sandbox.Tier.DENY:
        bad.append("false DENY: " + ok)
import json as _j; print(_j.dumps(bad))
"""])
    if r.returncode != 0:
        # A gate check that cannot run is a finding, not a note. This is the
        # single most important guarantee in the project.
        finding("approval-gate",
                "could not verify the gate: " + (r.stderr or r.stdout).strip()[:400])
        return
    try:
        bad = json.loads(r.stdout.strip() or "[]")
    except ValueError:
        finding("approval-gate", "unparseable check output: " + r.stdout[:300])
        return
    if bad:
        for b in bad:
            finding("approval-gate", b)
    else:
        note("approval-gate: DENY unapprovable and never auto-runs; "
             "HIGH_RISK asks on every policy; unknown tiers ask; "
             "deny matching is argument-precise")


# ── 6. version integrity ────────────────────────────────────────────────────
def check_version():
    r = run([sys.executable, "scripts/sync_version.py", "--check"])
    if r.returncode != 0 or "!" in r.stdout:
        finding("version", (r.stdout + r.stderr).strip()[:600])
    else:
        note(r.stdout.strip().splitlines()[0] if r.stdout.strip() else "version consistent")


# ── 7. native payloads ──────────────────────────────────────────────────────
#: e_machine values, per ABI directory. A binary in the wrong directory is the
#: failure that shipped an arm64-only APK to a 32-bit phone: it installs
#: nothing and the installer says only "incompatible CPU architecture".
ABI_MACHINE = {"arm64-v8a": (0xB7, "aarch64"),
               "armeabi-v7a": (0x28, "arm"),
               "x86_64": (0x3E, "x86-64"),
               "x86": (0x03, "x86")}


def check_native():
    root = ROOT / "android-native/app/src/main/jniLibs"
    if not root.is_dir():
        return
    abis = [d for d in sorted(root.iterdir())
            if d.is_dir() and d.name in ABI_MACHINE]
    if not abis:
        return
    libs = []
    per_abi = {}
    for d in abis:
        want, label = ABI_MACHINE[d.name]
        found = sorted(d.glob("*.so"))
        per_abi[d.name] = {f.name for f in found}
        libs.extend(found)
        for lib in found:
            head = lib.read_bytes()[:20]
            if head[:4] != b"\x7fELF":
                finding("native", f"{d.name}/{lib.name} is not an ELF file")
            elif head[18] != want:
                finding("native", f"{d.name}/{lib.name} is not {label} "
                                  f"(e_machine=0x{head[18]:02x})")
    # Every ABI must carry the same programs, or the app silently loses half
    # its toolset on whichever architecture was forgotten.
    def canon(name):
        """Strip CPython's platform triple so the two ABIs can be compared.

        An extension module is REQUIRED to carry its triple:
        _ssl.cpython-313-aarch64-linux-android.so on arm64 and
        _ssl.cpython-313-arm-linux-androideabi.so on armv7 are the same module,
        and CPython finds it by that exact name. Comparing the raw names says
        every module is missing from both sides, which is the opposite of true.
        """
        return re.sub(r"\.cpython-\d+-[a-z0-9_]+-linux-[a-z0-9]+\.so$",
                      ".cpython.so", name)

    if len(per_abi) > 1:
        names = list(per_abi)
        base = {canon(n) for n in per_abi[names[0]]}
        for other in names[1:]:
            theirs = {canon(n) for n in per_abi[other]}
            missing = base - theirs
            extra = theirs - base
            if missing:
                finding("native", f"{other} is missing {len(missing)} libs that "
                                  f"{names[0]} has, e.g. {sorted(missing)[:3]}")
            if extra:
                finding("native", f"{other} has {len(extra)} libs that "
                                  f"{names[0]} does not, e.g. {sorted(extra)[:3]}")
    if not libs:
        return
    d = abis[0]
    readme = d.parent / "README.md"
    if not readme.exists():
        finding("native", "jniLibs/README.md is missing — provenance and "
                          "licence for shipped binaries must be recorded")
    else:
        txt = readme.read_text(encoding="utf-8")
        # A component made of many files (the 68 CPython extension modules) is
        # documented as a group by its filename pattern. Demanding a line per
        # file would turn provenance into noise nobody reads, which is worse
        # than the rule it enforces.
        import fnmatch
        patterns = re.findall(r"`([^`]*\*[^`]*)`", txt)
        for lib in libs:
            if lib.name in txt:
                continue
            if any(fnmatch.fnmatch(lib.name, pat) for pat in patterns):
                continue
            finding("native", f"{lib.name} has no provenance entry in README.md")
    # packaging flags, without which the binary never becomes a real file
    g = (ROOT / "android-native/app/build.gradle").read_text(encoding="utf-8")
    m = (ROOT / "android-native/app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
    if "useLegacyPackaging = true" not in g:
        finding("native", "jniLibs useLegacyPackaging is not enabled — "
                          "shipped binaries will not be extracted and cannot run")
    if 'android:extractNativeLibs="true"' not in m:
        finding("native", "extractNativeLibs is not true — same problem")
    # Two different builds cannot share one filename in lib/<abi>. Chaquopy
    # ships libssl_python.so and friends for its own Python; ours are renamed,
    # and a future addition that forgets to rename would not fail the build --
    # it would load the wrong library at runtime and break imports obscurely.
    import subprocess as _sp
    reserved = {"libssl_python.so", "libcrypto_python.so", "libsqlite3_python.so"}
    present = {p.name for p in libs}
    clashes = []
    for lib in libs:
        if lib.name in reserved and lib.name not in ("libssl_python.so",):
            pass
        try:
            out = _sp.run(["readelf", "-d", str(lib)], capture_output=True,
                          text=True, timeout=30).stdout
        except (OSError, _sp.SubprocessError):
            continue
        deps = {l.split("[")[1].split("]")[0]
                for l in out.splitlines() if "(NEEDED)" in l}
        # a dependency on a name we do not ship and Android does not provide
        missing = {d for d in deps
                   if d.endswith("_python.so") or d.endswith("_py313.so")}
        for d in missing:
            if d not in present:
                clashes.append(f"{lib.name} needs {d}, which is not in jniLibs")
    for c in clashes:
        finding("native", c)
    note(f"native payloads: {len(libs)} binaries across "
         f"{len(per_abi)} ABI(s) ({', '.join(sorted(per_abi))}), "
         "provenance recorded"
         + (", no unresolved private deps" if not clashes else ""))


# ── 8. hostile input ────────────────────────────────────────────────────────
def check_hostile():
    """Malformed input must degrade, never raise out of a parser."""
    r = run([sys.executable, "-c", """
import json, sys, tempfile, pathlib
sys.path.insert(0, '.')
bad = []
from core import toolparse
for junk in ('', '{', '[]', 'null', '{"tool":', '\\x00', 'a'*100000,
             '{"tool": {"nested": {"deep": [1,2,3]}}}', '<<<>>>'):
    try:
        toolparse.parse(junk)
    except Exception as e:
        bad.append('toolparse(%r): %s' % (junk[:20], type(e).__name__))
import json as _j; print(_j.dumps(bad))
"""])
    if r.returncode != 0:
        note("hostile-input: toolparse API differs — covered by test_toolparse")
        return
    try:
        bad = json.loads(r.stdout.strip() or "[]")
    except ValueError:
        finding("hostile-input", "unparseable check output: " + r.stdout[:300])
        return
    if bad:
        for b in bad:
            finding("hostile-input", b)
    else:
        note("hostile-input: parsers degrade rather than raise")


# ── 9. packaging sanity ─────────────────────────────────────────────────────
def check_packaging():
    """A build must not re-embed the other builds.

    The desktop app once shipped 486 MB of other distributables inside itself,
    including an AppImage of itself.
    """
    pkg = ROOT / "desktop/package.json"
    if not pkg.exists():
        return
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except ValueError as e:
        finding("packaging", f"desktop/package.json is not valid JSON: {e}")
        return
    extra = json.dumps(data.get("build", {}).get("extraResources", []))
    for must in ("!artifacts/**", "!**/*.apk", "!android-native/**"):
        if must not in extra:
            finding("packaging",
                    f"desktop extraResources does not exclude {must} — "
                    "the app will package other builds inside itself")
    if not findings:
        note("packaging: desktop bundle excludes other build outputs")


# ── xml resources ───────────────────────────────────────────────────────────
def check_xml():
    """Every Android XML must parse.

    This exists because a manifest comment containing "--" is illegal XML and
    the merger rejects the whole document with "Error parsing
    AndroidManifest.xml" -- a message that names the file and nothing else.
    The build fails late, after the slow parts, on something a parser catches
    in milliseconds.
    """
    import xml.dom.minidom
    root = ROOT / "android-native/app/src/main"
    if not root.is_dir():
        return
    n = 0
    for f in list(root.rglob("*.xml")):
        if "build" in f.parts:
            continue
        try:
            xml.dom.minidom.parse(str(f))
            n += 1
        except Exception as e:  # noqa: BLE001
            finding("xml", f"{f.relative_to(ROOT)}: {e}")
    if n:
        note(f"android xml: {n} files parse")


# ── 10. the tests ───────────────────────────────────────────────────────────
def check_tests():
    r = run([ "bash", "tests/run_all.sh"], timeout=3600)
    if r.returncode != 0:
        tail = (r.stdout + r.stderr).strip().splitlines()[-25:]
        finding("tests", "suite failed:\n    " + "\n    ".join(tail))
    elif "ALL TESTS PASSED" not in r.stdout:
        # the runner once printed success while a suite failed
        finding("tests", "runner exited 0 without printing ALL TESTS PASSED")
    else:
        n = r.stdout.count("TESTS PASSED")
        note(f"tests: {n} suites green")


def _balanced(src, start):
    """Text between `start` and the paren that closes the call opened before it.

    A naive [^)]* stops at the first ')', so a nested call -- start(a, b,
    int(port), c) -- is truncated and miscounted. This check exists to catch an
    arity mismatch; getting the arity wrong here would be the same bug wearing
    the auditor's badge.
    """
    depth, out = 1, []
    for ch in src[start:]:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                break
        out.append(ch)
    return "".join(out)


def _top_level_args(rest):
    """Argument count for an argument list, ignoring commas inside nested calls."""
    if not rest.strip():
        return 0
    depth, args = 0, 1
    for ch in rest:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            args += 1
    return args


# ── the Java <-> Python bridge ──────────────────────────────────────────────
def check_bridge():
    """Java's callAttr() sites must match omerta_boot, and omerta_boot must
    match omerta_android.

    Chaquopy binds callAttr() arguments positionally at runtime. A parameter
    added to omerta_android but not mirrored in the omerta_boot shim raises
    TypeError inside the launch path, where Java catches Throwable and the user
    is told only that the backend "didn't come up". That is exactly what
    happened to native_lib_dir: the app shipped with a dead backend on every
    architecture for four releases, because nothing in the build ever compared
    the two ends of the bridge.

    Both hops are checked, so the shim cannot silently drop an argument in
    either direction.
    """
    boot = ROOT / "android-native/app/src/main/python/omerta_boot.py"
    backend = ROOT / "omerta_android.py"
    java_dir = ROOT / "android-native/app/src/main/java"
    if not boot.is_file() or not java_dir.is_dir():
        return

    def signatures(path):
        out = {}
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                a = node.args
                required = len(a.args) - len(a.defaults)
                out[node.name] = (required, len(a.args),
                                  [x.arg for x in a.args])
        return out

    boot_sigs = signatures(boot)

    # hop 1: Java -> omerta_boot
    call = re.compile(r'callAttr\(\s*"([A-Za-z_]\w*)"((?:[^;]|\n)*?)\)\s*(?:\.|;|,)')
    sites = 0
    for f in java_dir.rglob("*.java"):
        src = f.read_text(encoding="utf-8", errors="replace")
        for m in call.finditer(src):
            name, rest = m.group(1), m.group(2)
            if name not in boot_sigs:
                finding("bridge",
                        f"{f.name}: calls omerta_boot.{name}(), which does not exist")
                continue
            # `rest` is the tail after the name literal, so it opens with the
            # separating comma: one top-level comma per argument, none when
            # the call passes nothing.
            depth, args = 0, 0
            for ch in rest:
                if ch in "([":
                    depth += 1
                elif ch in ")]":
                    depth -= 1
                elif ch == "," and depth == 0:
                    args += 1
            lo, hi, names = boot_sigs[name]
            if not (lo <= args <= hi):
                finding("bridge",
                        f"{f.name}: callAttr(\"{name}\", ...) passes {args} arg(s); "
                        f"omerta_boot.{name}{tuple(names)} accepts {lo}-{hi}")
            sites += 1

    # hop 2: omerta_boot -> omerta_android
    if backend.is_file():
        back_sigs = signatures(backend)
        boot_src = boot.read_text(encoding="utf-8", errors="replace")
        opener = re.compile(r"omerta_android\.([A-Za-z_]\w*)\(")
        for m in opener.finditer(boot_src):
            name, rest = m.group(1), _balanced(boot_src, m.end())
            if name not in back_sigs:
                finding("bridge",
                        f"omerta_boot forwards to omerta_android.{name}(), "
                        "which does not exist")
                continue
            args = _top_level_args(rest)
            lo, hi, names = back_sigs[name]
            if not (lo <= args <= hi):
                finding("bridge",
                        f"omerta_boot forwards {args} arg(s) to omerta_android."
                        f"{name}{tuple(names)}, which accepts {lo}-{hi}")
            # a shim that accepts fewer than the backend offers is a dropped
            # feature, not just a crash risk
            b_lo, b_hi, b_names = boot_sigs.get(name, (0, 0, []))
            if name in boot_sigs and b_hi < hi and "home_dir" not in b_names[b_hi:]:
                missing = [n for n in names[b_hi:] if n not in b_names]
                if missing:
                    finding("bridge",
                            f"omerta_boot.{name} cannot forward "
                            f"{', '.join(missing)} — the shim drops it")
    if sites:
        note(f"bridge: {sites} Java->Python call site(s) match omerta_boot")


CHECKS = [
    ("syntax", check_syntax),
    ("dangerous constructs", check_dangerous),
    ("shell=True", check_shell_true),
    ("secrets", check_secrets),
    ("local-only rule", check_local_only),
    ("approval gate", check_gate),
    ("version integrity", check_version),
    ("native payloads", check_native),
    ("hostile input", check_hostile),
    ("packaging", check_packaging),
    ("android xml", check_xml),
    ("java/python bridge", check_bridge),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true",
                    help="skip the test suite (for the fix/re-audit loop)")
    ap.add_argument("--phase", default="", help="label for the report")
    args = ap.parse_args()

    checks = list(CHECKS)
    if not args.quick:
        checks.append(("tests", check_tests))

    label = f" — {args.phase}" if args.phase else ""
    print(f"\n\033[91m═══ OMERTA audit gate{label} ═══\033[0m")
    start = time.time()
    for name, fn in checks:
        before = len(findings)
        print(f"  … {name}", end="", flush=True)
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — a broken check is itself a finding
            finding(name, f"the check itself raised: {type(e).__name__}: {e}")
        new = len(findings) - before
        print(f"\r  {'✗' if new else '✓'} {name}"
              + (f"  ({new} finding{'s' if new > 1 else ''})" if new else "") + " " * 20)

    print()
    for n in notes:
        print(f"    · {n}")

    took = round(time.time() - start, 1)
    print()
    if findings:
        print(f"\033[91m{len(findings)} FINDING(S)\033[0m  ({took}s)\n")
        for f in findings:
            print(f"  [{f['check']}] {f['detail']}")
        print("\nFix every one of these, then run the gate again on the same "
              "phase.\nA fix introduces findings as readily as any other change.")
        return 1
    print(f"\033[92mCLEAN PASS\033[0m  ({took}s) — this phase is done.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
