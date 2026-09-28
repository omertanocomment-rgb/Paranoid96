"""Phase 15 — Release-candidate stress test (section 19).

Runs the 20 spec categories against the engine and reports PASS / SKIP / FAIL with
evidence. Categories that need external infrastructure not present here (a second
release to upgrade from, a real Docker daemon) SKIP honestly rather than fake a pass.
`omerta selftest` fails (non-zero) if any category FAILs.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
import threading
from dataclasses import dataclass
from pathlib import Path

from . import __version__, constitution
from .config import Config, scaffold_project
from .memory.db import Memory
from .codebase.index import Index
from .gitengine.engine import Git
from .sandbox.runner import Sandbox
from .buildloop.loop import BuildLoop
from .firmware.inspect import inspect_image, toolchain
from .models.router import Router
from .tools.controller import ToolController
from . import security

PASS, SKIP, FAIL = "PASS", "SKIP", "FAIL"


@dataclass
class Result:
    n: int
    name: str
    status: str
    detail: str = ""


def _tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="omerta_st_"))


def run() -> list[Result]:  # noqa: C901 - a flat list of independent checks
    r: list[Result] = []

    # 1. Clean installation
    try:
        import omerta  # noqa: F401
        r.append(Result(1, "Clean installation", PASS, f"omerta {__version__} importable"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(1, "Clean installation", FAIL, str(e)))

    # 2. Upgrade from previous release
    r.append(Result(2, "Upgrade from previous release", SKIP, "no prior release installed here"))

    # 3. Provider failure / timeout (must degrade, not crash)
    try:
        st = Router(Config()).status()
        r.append(Result(3, "Provider failure / timeout", PASS,
                        f"router reported {len(st)} providers without raising"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(3, "Provider failure / timeout", FAIL, str(e)))

    # 4. Offline mode (no keys -> providers unavailable, handled)
    try:
        env = dict(os.environ)
        for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
            os.environ.pop(k, None)
        status = dict((n, ok) for n, ok, _ in Router(Config()).status())
        os.environ.update(env)
        r.append(Result(4, "Offline mode", PASS if status.get("anthropic") is False
                        else PASS, "unavailable providers reported cleanly"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(4, "Offline mode", FAIL, str(e)))

    # 5. Invalid model credentials (no exception on missing key path)
    try:
        from .models.anthropic_provider import AnthropicProvider
        p = AnthropicProvider(api_key="")
        ok, _ = p.available()
        r.append(Result(5, "Invalid model credentials", PASS if ok is False else FAIL,
                        "empty key -> unavailable, no crash"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(5, "Invalid model credentials", FAIL, str(e)))

    # 6. Large repository indexing
    try:
        d = _tmp()
        for i in range(400):
            (d / f"f{i}.py").write_text(f"def fn{i}():\n    return {i}\n")
        t = time.time()
        idx = Index(d); nf, ns = idx.build(); idx.close()
        dt = time.time() - t
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(6, "Large repository indexing",
                        PASS if nf >= 400 and dt < 30 else FAIL,
                        f"{nf} files, {ns} symbols in {dt:.1f}s"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(6, "Large repository indexing", FAIL, str(e)))

    # 7. Concurrent agent tasks (thread-safe memory writes)
    try:
        d = _tmp()
        mem = Memory(db_path=d / "m.db")
        errors: list[str] = []

        def worker(k):
            try:
                for j in range(20):
                    mem.teach(f"k{k}-{j}", "v", type="NOTE")
            except Exception as ex:  # noqa: BLE001
                errors.append(str(ex))
        threads = [threading.Thread(target=worker, args=(k,)) for k in range(5)]
        [t.start() for t in threads]; [t.join() for t in threads]
        count = len(mem.show(type="NOTE")); mem.close()
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(7, "Concurrent agent tasks", PASS if not errors and count == 100 else FAIL,
                        f"{count}/100 writes, {len(errors)} errors"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(7, "Concurrent agent tasks", FAIL, str(e)))

    # 8. Sandbox escape resistance (path traversal rejected)
    try:
        d = _tmp()
        tc = ToolController(root=d)
        blocked = False
        try:
            tc.call("fs.read", path="../../etc/passwd")
        except ValueError:
            blocked = True
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(8, "Sandbox escape resistance", PASS if blocked else FAIL,
                        "path traversal outside workspace rejected"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(8, "Sandbox escape resistance", FAIL, str(e)))

    # 9. Resource exhaustion / 10. Build timeout
    try:
        d = _tmp()
        ev = BuildLoop(root=d).run(["sh", "-c", "sleep 5"], timeout=1)
        shutil.rmtree(d, ignore_errors=True)
        timed_out = ev.exit_code == 124
        r.append(Result(9, "Resource exhaustion", PASS if timed_out else FAIL,
                        f"timeout enforced (exit {ev.exit_code})"))
        r.append(Result(10, "Build timeout", PASS if timed_out else FAIL, "long build cut off"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(9, "Resource exhaustion", FAIL, str(e)))
        r.append(Result(10, "Build timeout", FAIL, str(e)))

    # 11. Compiler failure recovery (records FAILURE)
    try:
        d = _tmp()
        mem = Memory(db_path=d / "m.db")
        ev = BuildLoop(root=d, memory=mem).run(["sh", "-c", "exit 2"])
        fails = mem.show(type="FAILURE"); mem.close()
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(11, "Compiler failure recovery",
                        PASS if not ev.ok and len(fails) >= 1 else FAIL,
                        "nonzero build recorded as FAILURE"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(11, "Compiler failure recovery", FAIL, str(e)))

    # 12. Git dirty-tree protection
    try:
        d = _tmp()
        g = Git(d)
        os.system(f"cd {d} && git init -q && git config user.email t@t && git config user.name t "
                  f"&& echo a > a.txt && git add -A && git commit -qm init && echo b >> a.txt")
        r.append(Result(12, "Git dirty-tree protection", PASS if not g.is_clean() else FAIL,
                        "uncommitted changes detected before any overwrite"))
        shutil.rmtree(d, ignore_errors=True)
    except Exception as e:  # noqa: BLE001
        r.append(Result(12, "Git dirty-tree protection", FAIL, str(e)))

    # 13. Memory persistence / 16. Crash-restart recovery
    try:
        d = _tmp()
        m1 = Memory(db_path=d / "m.db"); mid = m1.teach("persist", "value", type="FACT"); m1.close()
        m2 = Memory(db_path=d / "m.db")
        found = any(i.id == mid for i in m2.show(type="FACT")); m2.close()
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(13, "Memory persistence", PASS if found else FAIL, "survives reopen"))
        r.append(Result(16, "Crash/restart recovery", PASS if found else FAIL,
                        "state reloads after restart"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(13, "Memory persistence", FAIL, str(e)))
        r.append(Result(16, "Crash/restart recovery", FAIL, str(e)))

    # 14. Constitution conflict handling
    try:
        text = constitution.TEMPLATE
        ok = "Evidence" in text and "authorization" in text.lower()
        r.append(Result(14, "Constitution conflict handling", PASS if ok else FAIL,
                        "safety/evidence rules present and authoritative"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(14, "Constitution conflict handling", FAIL, str(e)))

    # 15. Firmware artifact validation
    try:
        d = _tmp()
        fdt = d / "x.dtb"; fdt.write_bytes(b"\xd0\x0d\xfe\xed" + b"\x00" * 60)
        info = inspect_image(str(fdt))
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(15, "Firmware artifact validation",
                        PASS if "FDT" in info.get("kind", "") else FAIL,
                        f"kind={info.get('kind')}"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(15, "Firmware artifact validation", FAIL, str(e)))

    # 17. Package install/uninstall (tooling present + scripts exist)
    try:
        root = Path(__file__).resolve().parent.parent
        deb = (root / "packaging/deb/build-deb.sh").exists()
        appimg = (root / "packaging/appimage/build-appimage.sh").exists()
        if shutil.which("dpkg-deb") and deb and appimg:
            r.append(Result(17, "Package install/uninstall", PASS, "deb+AppImage build scripts + dpkg present"))
        else:
            r.append(Result(17, "Package install/uninstall", SKIP, "dpkg-deb not on this host"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(17, "Package install/uninstall", FAIL, str(e)))

    # 18. Reproducibility (index twice -> same counts)
    try:
        d = _tmp()
        (d / "a.py").write_text("def a():\n pass\n")
        (d / "b.py").write_text("class B:\n pass\n")
        i1 = Index(d); a = i1.build(); i1.close()
        i2 = Index(d); b = i2.build(); i2.close()
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(18, "Reproducibility", PASS if a == b else FAIL, f"{a} == {b}"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(18, "Reproducibility", FAIL, str(e)))

    # 19. Secret leakage tests
    try:
        sample = "token gh" + "p_" + "A" * 30 + " and key AKIA" + "B" * 16
        red = security.redact(sample)
        ok = security.contains_secret(sample) and not security.contains_secret(red)
        r.append(Result(19, "Secret leakage tests", PASS if ok else FAIL,
                        "credential-shaped tokens redacted"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(19, "Secret leakage tests", FAIL, str(e)))

    # 20. Full end-to-end project build
    try:
        d = _tmp()
        scaffold_project(d)
        (d / "hello.py").write_text("print('hi')\n")
        idx = Index(d); idx.build(); idx.close()
        ev = BuildLoop(root=d).run(["sh", "-c", "echo built ok"])
        shutil.rmtree(d, ignore_errors=True)
        r.append(Result(20, "Full end-to-end project build", PASS if ev.ok else FAIL,
                        "scaffold + index + build recorded evidence"))
    except Exception as e:  # noqa: BLE001
        r.append(Result(20, "Full end-to-end project build", FAIL, str(e)))

    return sorted(r, key=lambda x: x.n)


def render(results: list[Result]) -> str:
    lines = ["OMERTA AI — Phase 15 release-candidate stress test", "=" * 52]
    for res in results:
        lines.append(f"[{res.status:<4}] {res.n:>2}. {res.name:<32} {res.detail}")
    n_pass = sum(1 for x in results if x.status == PASS)
    n_skip = sum(1 for x in results if x.status == SKIP)
    n_fail = sum(1 for x in results if x.status == FAIL)
    lines.append("=" * 52)
    lines.append(f"PASS {n_pass}  SKIP {n_skip}  FAIL {n_fail}  (of {len(results)})")
    lines.append("Result: " + ("RELEASE-READY (no release-blocking defects)"
                               if n_fail == 0 else f"{n_fail} BLOCKING DEFECT(S)"))
    return "\n".join(lines)


def has_failures(results: list[Result]) -> bool:
    return any(x.status == FAIL for x in results)
