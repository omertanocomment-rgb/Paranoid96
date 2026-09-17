#!/usr/bin/env python3
"""The on-device inference engine.

The engine binary is aarch64 Android and cannot be executed here, so what is
tested is the part that decides things: that a missing engine and a missing
model are reported as the different problems they are, that the control API
refuses anything it does not recognise, that the endpoint is local-only, and
that sizing advice stays within what a handset can actually do.
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def main():
    print("=== on-device engine ===")
    from core import localai, api, config

    # the engine really is in this build
    shipped = ROOT / "android-native/app/src/main/jniLibs/arm64-v8a/libllamaserver.so"
    check("engine binary is in the tree", shipped.is_file())
    if shipped.is_file():
        head = shipped.read_bytes()[:20]
        check("engine is an aarch64 ELF",
              head[:4] == b"\x7fELF" and head[18] == 0xB7)
        check("engine is a sensible size (5-60 MB)",
              5_000_000 < shipped.stat().st_size < 60_000_000)

    # sizing must stay within what a phone can sustain
    t = localai.suggest_threads()
    check(f"thread count is sane ({t})", 1 <= t <= 4)
    adv = localai.advice()
    check("advice names a models directory", bool(adv["models_dir"]))
    check("advice explains what will run", len(adv["guidance"]) >= 4)
    check("advice says models are not uploaded",
          any("nothing is uploaded" in g.lower() for g in adv["guidance"]))

    # a missing model is a different problem from a missing engine, and the
    # message has to say which, because the fixes are not the same
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["OMERTA_MODELS_DIR"] = tmp
        st = localai.status()
        check("reports no models when the directory is empty", st["models"] == [])
        res = localai.start()
        check("start without a model does not raise", isinstance(res, dict))
        check("start without a model explains itself",
              "no .gguf" in res.get("error", ""))
        check("start without a model is not 'running'", not res.get("running"))

        # a file that is not a model must not be offered as one
        Path(tmp, "notes.txt").write_text("not a model")
        Path(tmp, "model-a.gguf").write_bytes(b"\x00" * 64)
        names = [m["name"] for m in localai.models()]
        check("only .gguf files are listed", names == ["model-a.gguf"])

        res = localai.start(model="does-not-exist.gguf")
        check("an unknown model name is refused",
              "not found" in res.get("error", ""))
    os.environ.pop("OMERTA_MODELS_DIR", None)

    # control surface
    check("advice action works", "guidance" in api.localai_control({"action": "advice"}))
    for bad in ({"action": "nope"}, {}, None):
        check(f"rejects {bad!r}", "error" in api.localai_control(bad))

    # stopping when nothing runs must be harmless
    check("stop when idle is a no-op", localai.stop().get("running") is False)

    # the endpoint is direct operation of the device, so it must be local-only
    for f in ("core/httpd.py", "server.py"):
        txt = (ROOT / f).read_text()
        check(f"{f} marks /api/localai local-only", "/api/localai" in txt
              and "localai" in txt.split("LOCAL_ONLY")[1][:260])

    # the provider exists and is honest about needing no network
    check("on-device provider is registered", "omerta" in config.PROVIDERS)
    if "omerta" in config.PROVIDERS:
        spec = config.PROVIDERS["omerta"]
        check("on-device provider needs no internet",
              spec.get("needs_internet") is False)
        check("on-device provider is managed by us", spec.get("managed") is True)

    print()
    if fails:
        print(f"LOCALAI TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("LOCALAI TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
