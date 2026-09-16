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
            else:
                why = f"not running at {spec.get('base_url','')}"
        except Exception as e:  # noqa: BLE001
            ready, why = False, str(e)
        out[pid] = {"label": spec["label"], "model": spec["model"],
                    "ready": ready, "why": why}
    return out


def _try(pid, messages, system, max_tokens, stream_cb):
    spec = config.PROVIDERS[pid]
    fn = KINDS[spec["kind"]]
    text = fn(spec, messages, system=system, max_tokens=max_tokens, stream_cb=stream_cb)
    return {"text": text, "provider": pid, "model": spec["model"],
            "offline": not spec.get("needs_internet", False)}


def complete(messages, system="", max_tokens=None, stream_cb=None) -> dict:
    max_tokens = max_tokens or config.MAX_TOKENS
    active = config.get("OMERTA_PROVIDER", config.ACTIVE_PROVIDER)
    errors = []

    if active != "auto" and active in config.PROVIDERS:
        order = [active]
        fb = config.OFFLINE_FALLBACK
        if fb and fb != active and fb in config.PROVIDERS:
            order.append(fb)
    else:
        net = has_internet()
        order = [p for p in config.ROUTING_ORDER if p in config.PROVIDERS]
        if not net:
            order = [p for p in order
                     if not config.PROVIDERS[p].get("needs_internet")]

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
