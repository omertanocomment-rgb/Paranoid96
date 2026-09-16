"""Offline/online mode routing + unlimited-chat history trimming."""
import os
import sys

os.environ["OMERTA_HISTORY_LIMIT"] = "6"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import config, router, agent as agent_mod  # noqa: E402


def test_mode_filter():
    order = ["claude", "openai", "ollama", "llamacpp", "lmstudio"]
    offline = router._apply_mode(order, "offline")
    online = router._apply_mode(order, "online")
    assert offline == ["ollama", "llamacpp", "lmstudio"], offline
    assert online == ["claude", "openai"], online
    assert router._apply_mode(order, "auto") == order
    print("  ✓ mode filter: offline=local-only, online=cloud-only")


def test_offline_never_calls_network():
    """In offline mode with no local model, we fail fast with guidance and
    never attempt a cloud provider."""
    config.set_setting("OMERTA_MODE", "offline")
    config.set_setting("OMERTA_PROVIDER", "auto")
    called = {"net": False}
    real = router.has_internet
    router.has_internet = lambda *a, **k: called.__setitem__("net", True) or True
    try:
        try:
            router.complete([{"role": "user", "content": "hi"}])
        except router.ProviderError as e:
            assert "offline" in str(e).lower()
    finally:
        router.has_internet = real
        config.set_setting("OMERTA_MODE", "auto")
    assert called["net"] is False, "offline mode must not probe the network"
    print("  ✓ offline mode never probes the network")


def test_history_unbounded_but_trimmed():
    a = agent_mod.Agent(project="histtest")

    def fake_complete(messages, system="", max_tokens=None, stream_cb=None):
        return {"text": "ok", "provider": "mock", "model": "mock", "offline": True}
    agent_mod.router.complete = fake_complete

    for i in range(50):                       # 50 chat turns — no cap, no error
        r = a.turn(f"message {i}")
        assert r["pending"] is None
    assert len(a.history) <= config.HISTORY_LIMIT + 2, len(a.history)
    assert a.history[0]["role"] == "user"
    print(f"  ✓ 50 turns ran; context window bounded to "
          f"{len(a.history)} msgs (limit {config.HISTORY_LIMIT})")


if __name__ == "__main__":
    test_mode_filter()
    test_offline_never_calls_network()
    test_history_unbounded_but_trimmed()
    print("\nMODE + HISTORY TESTS PASSED")
