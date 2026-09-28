#!/usr/bin/env python3
"""A working API key must not be vetoed by a connectivity guess.

This exists because of a report that no model worked even with an API key
entered. The cause was in complete(): in auto mode it called has_internet(),
and on a False answer it REMOVED every provider marked needs_internet from the
routing order. What was left were the local providers, none of which were
running, so the result was "No model available" with no mention of the cloud
provider that had a perfectly good key.

has_internet() opened a raw socket to 1.1.1.1:443 and 8.8.8.8:53. Carrier
networks, captive portals and phones that force their own resolver block both
while api.anthropic.com stays reachable, so the probe says "offline" on
networks that are not. A guess about the network was overriding a fact about
the configuration.

The rule pinned here: the probe may REORDER providers, never remove a
configured one. Whether a provider works is decided by calling it.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


print("=== routing ===")

from core import router, config  # noqa: E402
from core.providers import ProviderError  # noqa: E402

os.environ["ANTHROPIC_API_KEY"] = "sk-ant-not-a-real-key"
os.environ.pop("OPENAI_API_KEY", None)

# ── the probe says offline; the key says try me ────────────────────────────
real_probe = router.has_internet
attempted = []


def fake_offline(timeout=None):
    return False


def fake_try(pid, messages, system, max_tokens, stream_cb):
    attempted.append(pid)
    raise ProviderError("simulated failure")


real_try = router._try
router.has_internet = fake_offline
router._try = fake_try
try:
    config._runtime.pop("OMERTA_PROVIDER", None)
    os.environ.pop("OMERTA_PROVIDER", None)
    os.environ["OMERTA_MODE"] = "auto"
    try:
        router.complete([{"role": "user", "content": "hi"}])
    except ProviderError:
        pass
    check("a keyed cloud provider is still attempted when the probe says offline",
          any(config.PROVIDERS[p].get("needs_internet") for p in attempted),
          f"attempted={attempted}")
    check("and it is the one that actually has a key",
          "claude" in attempted, f"attempted={attempted}")
    check("an unkeyed cloud provider is not attempted",
          "openai" not in attempted, f"attempted={attempted}")
    check("local providers are still tried first",
          not attempted or not config.PROVIDERS[attempted[0]].get("needs_internet"),
          f"order was {attempted}")

    # ── offline mode is a user instruction, not a guess: it still excludes ──
    attempted.clear()
    # settings.json outranks the environment in config.get(), so set the mode
    # the way the app does rather than via an env var a saved setting shadows.
    prev_mode = config._runtime.get("OMERTA_MODE")
    config._runtime["OMERTA_MODE"] = "offline"
    try:
        router.complete([{"role": "user", "content": "hi"}])
    except ProviderError:
        pass
    check("offline MODE still excludes cloud providers (that one is deliberate)",
          not any(config.PROVIDERS[p].get("needs_internet") for p in attempted),
          f"attempted={attempted}")
finally:
    router.has_internet = real_probe
    router._try = real_try
    if prev_mode is None:
        config._runtime.pop("OMERTA_MODE", None)
    else:
        config._runtime["OMERTA_MODE"] = prev_mode
    os.environ["OMERTA_MODE"] = "auto"

# ── status must not call a keyed provider dead ─────────────────────────────
router.has_internet = fake_offline
try:
    st = router.provider_status()
finally:
    router.has_internet = real_probe
check("status does not report a keyed provider as flatly unavailable",
      st["claude"]["ready"] is True, st["claude"])
check("and says the network is unproven rather than claiming offline",
      "still try" in st["claude"]["why"], st["claude"]["why"])
check("an unkeyed provider still reports the missing key",
      "no key" in st["openai"]["why"], st["openai"]["why"])

# ── the probe itself ───────────────────────────────────────────────────────
check("the probe tries DNS, which works where raw sockets are blocked",
      "getaddrinfo" in (ROOT / "core" / "router.py").read_text(encoding="utf-8"))

os.environ.pop("ANTHROPIC_API_KEY", None)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nROUTING TESTS PASSED")
