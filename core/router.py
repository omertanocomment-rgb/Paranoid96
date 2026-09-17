"""
Model router — picks which provider answers each turn.

Modes:
  ACTIVE_PROVIDER = "auto"  -> walk ROUTING_ORDER, first reachable wins,
                               falling back to a local model the instant
                               anything online fails (so losing signal
                               mid-task never stops the agent).
  ACTIVE_PROVIDER = "<id>"  -> pin one provider; still falls back to
                               OFFLINE_FALLBACK if it dies, unless pinned
                               provider is itself local.
"""
import socket
from . import config
from .providers import KINDS, REACHABLE, ProviderError


def has_internet(timeout=config.CONNECTIVITY_TIMEOUT) -> bool:
    for host in (("1.1.1.1", 443), ("8.8.8.8", 53)):
        try:
            s = socket.create_connection(host, timeout=timeout)
            s.close()
            return True
        except OSError:
            continue
    return False


def provider_status() -> dict:
    """Which brains are usable right now — powers /status and the web UI."""
    net = has_internet()
    out = {}
    for pid, spec in config.PROVIDERS.items():
        if spec.get("needs_internet") and not net:
            out[pid] = {"label": spec["label"], "model": spec["model"],
                        "ready": False, "why": "offline"}
            continue
        try:
            ready = REACHABLE[spec["kind"]](spec)
            if ready:
                why = ""
            elif spec.get("needs_internet"):
                why = f"no key in ${spec.get('api_key_env','?')}"
            elif spec.get("managed"):
                from . import localai
                st = localai.stats()
                if not st["available"]:
                    why = "this build has no on-device engine"
                elif not st["models"]:
                    why = "no .gguf model on the device yet"
                else:
                    why = st["error"] or "engine idle — starts on first message"
                    ready = not st["error"]
            else:
                why = f"not running at {spec.get('base_url','')}"
        except Exception as e:  # noqa: BLE001
            ready, why = False, str(e)
        out[pid] = {"label": spec["label"], "model": spec["model"],
                    "ready": ready, "why": why}
    return out


def _ensure_managed(pid, spec):
    """Start the on-device engine if this provider is ours and it is idle.

    Every other provider is a service you run; this is the one OMERTA owns, so
    "not running" is something to fix rather than a reason to fail over to a
    cloud model the user may have chosen this provider specifically to avoid.
    """
    if not spec.get("managed"):
        return
    from . import localai
    if localai.running():
        return
    st = localai.start()
    if not st.get("running"):
        raise ProviderError(st.get("error") or "the on-device engine did not start")


def _try(pid, messages, system, max_tokens, stream_cb):
    spec = config.PROVIDERS[pid]
    _ensure_managed(pid, spec)
    fn = KINDS[spec["kind"]]
    text = fn(spec, messages, system=system, max_tokens=max_tokens, stream_cb=stream_cb)
    return {"text": text, "provider": pid, "model": spec["model"],
            "offline": not spec.get("needs_internet", False)}


def _mode():
    return config._norm_mode(config.get("OMERTA_MODE", config.MODE))


def _apply_mode(order, mode):
    """Restrict provider order to the requested network mode."""
    if mode == "offline":
        return [p for p in order if not config.PROVIDERS[p].get("needs_internet")]
    if mode == "online":
        return [p for p in order if config.PROVIDERS[p].get("needs_internet")]
    return order


def complete(messages, system="", max_tokens=None, stream_cb=None) -> dict:
    max_tokens = max_tokens or config.MAX_TOKENS
    active = config.get("OMERTA_PROVIDER", config.ACTIVE_PROVIDER)
    mode = _mode()
    errors = []

    if active != "auto" and active in config.PROVIDERS:
        order = [active]
        fb = config.OFFLINE_FALLBACK
        if fb and fb != active and fb in config.PROVIDERS:
            order.append(fb)
    else:
        net = has_internet() if mode != "offline" else False
        order = [p for p in config.ROUTING_ORDER if p in config.PROVIDERS]
        if not net:
            order = [p for p in order
                     if not config.PROVIDERS[p].get("needs_internet")]

    order = _apply_mode(order, mode)
    if not order:
        raise ProviderError(
            f"No provider fits '{mode}' mode.\n"
            + ("  offline mode needs a local model — start Ollama or llama.cpp, "
               "or switch to Auto/Online.\n" if mode == "offline"
               else "  online mode needs an API key — set one in Settings, "
                    "or switch to Auto/Offline.\n"))

    for pid in order:
        try:
            return _try(pid, messages, system, max_tokens, stream_cb)
        except ProviderError as e:
            errors.append(f"{pid}: {e}")
            continue

    raise ProviderError(
        "No model available.\n  " + "\n  ".join(errors) +
        "\n\nFix one of these:\n"
        "  • online : export ANTHROPIC_API_KEY=sk-ant-...  (or OPENAI_API_KEY etc.)\n"
        f"  • offline: ollama serve && ollama pull {config.PROVIDERS['ollama']['model']}\n"
        "  • check  : /status"
    )
