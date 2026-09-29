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
    """Best-effort: is there a route off this device?

    This is a HINT, never a veto. Plenty of real networks refuse raw sockets
    to 1.1.1.1:443 and 8.8.8.8:53 -- carrier networks, captive portals,
    corporate DNS, a phone that only allows DNS through its own resolver --
    while api.anthropic.com is perfectly reachable. Treating a failed probe as
    "no internet" silently removed every cloud provider from the routing
    order, so a correct API key produced "No model available" and nothing
    explained why. Whether a provider works is now decided by CALLING it.

    DNS is tried first because it is what actually breaks when a phone is
    offline, and it succeeds on networks that block the two IPs below.
    """
    try:
        socket.setdefaulttimeout(timeout)
        socket.getaddrinfo("api.anthropic.com", 443)
        return True
    except OSError:
        pass
    for host in (("1.1.1.1", 443), ("8.8.8.8", 53), ("9.9.9.9", 53)):
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
            # A configured provider is still worth trying: the probe can fail
            # on a network that reaches the API perfectly well. Say what is
            # actually known rather than declaring it dead.
            keyed = _configured(pid)
            out[pid] = {
                "label": spec["label"], "model": spec["model"],
                "ready": keyed,
                "why": ("no network detected — will still try"
                        if keyed
                        else f"no key in ${spec.get('api_key_env', '?')}"),
            }
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
    # Meter it. No provider here reports real token usage, so the counts are
    # estimated from text length and flagged as such -- an indicative figure
    # that says it is indicative beats a precise-looking one that is invented.
    try:
        from . import usage
        sent = sum(len(str(m.get("content", ""))) for m in messages) + len(system)
        usage.record(pid, spec.get("model", ""),
                     tokens_in=usage.estimate_tokens("x" * sent),
                     tokens_out=usage.estimate_tokens(text),
                     project=config.get("OMERTA_PROJECT", "general"),
                     estimated=True)
    except Exception:  # noqa: BLE001 — metering must never break a reply
        pass
    return {"text": text, "provider": pid, "model": spec["model"],
            "offline": not spec.get("needs_internet", False)}


def _configured(pid):
    """Has this provider been given what it needs to be worth trying?

    For a cloud provider that means a key; trying one without a key just
    produces noise in the error list.
    """
    spec = config.PROVIDERS.get(pid) or {}
    env = spec.get("api_key_env")
    if not env:
        return True
    # Through config.secret so a project-scoped key counts, and so a project
    # whose own key is missing is reported as NOT configured rather than
    # inheriting the shared one.
    return bool(config.secret(env))


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
        order = [p for p in config.ROUTING_ORDER if p in config.PROVIDERS]
        if mode == "offline":
            # An explicit instruction, not a guess. Offline means the network
            # is not touched, so the cloud providers are removed here and the
            # guarantee does not depend on a later filter still being right.
            order = [p for p in order
                     if not config.PROVIDERS[p].get("needs_internet")]
        elif not has_internet():
            # Prefer local providers, but do NOT drop the cloud ones: the probe
            # is a guess about a network we have not actually tried yet, and a
            # provider holding a valid key is more likely to work than a local
            # server that is not running. If the network really is down, the
            # call fails and its real error is reported instead of a silent
            # omission.
            local = [p for p in order
                     if not config.PROVIDERS[p].get("needs_internet")]
            remote = [p for p in order
                      if config.PROVIDERS[p].get("needs_internet")
                      and _configured(p)]
            order = local + remote

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
