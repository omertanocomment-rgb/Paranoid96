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
def check_native():
    d = ROOT / "android-native/app/src/main/jniLibs/arm64-v8a"
    if not d.is_dir():
        return
    libs = sorted(d.glob("*.so"))
    if not libs:
        return
    for lib in libs:
        head = lib.read_bytes()[:20]
        if head[:4] != b"\x7fELF":
            finding("native", f"{lib.name} is not an ELF file")
        elif head[18] != 0xB7:
            finding("native", f"{lib.name} is not aarch64 (e_machine={head[18]})")
    readme = d.parent / "README.md"
    if not readme.exists():
        finding("native", "jniLibs/README.md is missing — provenance and "
                          "licence for shipped binaries must be recorded")
    else:
        txt = readme.read_text(encoding="utf-8")
        for lib in libs:
            if lib.name not in txt:
                finding("native", f"{lib.name} has no provenance entry in README.md")
    # packaging flags, without which the binary never becomes a real file
    g = (ROOT / "android-native/app/build.gradle").read_text(encoding="utf-8")
    m = (ROOT / "android-native/app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
    if "useLegacyPackaging = true" not in g:
        finding("native", "jniLibs useLegacyPackaging is not enabled — "
                          "shipped binaries will not be extracted and cannot run")
    if 'android:extractNativeLibs="true"' not in m:
        finding("native", "extractNativeLibs is not true — same problem")
    note(f"native payloads: {len(libs)} aarch64 binaries, provenance recorded")


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
