"""
Getting a second device onto the same data without typing a 32-character token.

The token this exchanges is the one that authorises everything the LAN server
will do, so the exchange itself is the sensitive part. The design is the
narrowest thing that still works:

  * Nothing is claimable unless the owner OPENS an offer on the device that
    already has the data. There is no standing endpoint to attack -- outside a
    window the route does not answer at all.
  * An offer is single use and expires (two minutes by default). The code is
    eight characters from an alphabet with no 0/O or 1/I/l in it, which is
    about 40 bits -- weak as a password and ample for one attempt-capped
    window, which is exactly what it is.
  * Five wrong codes void the offer. An attacker on the LAN gets five guesses
    at 40 bits inside two minutes, once, and then the owner has to press the
    button again and would wonder why.
  * A claim must come from a private address and must not have been forwarded.
    Pairing is two devices in the same room; a proxy in the path means it is
    not.
  * The offer lives in memory and NEVER on disk. A restart cancels it. Writing
    it down would leave a live path to the token after a crash, which is the
    opposite of a window.

What this does NOT do is prove which device claimed. Anything on the LAN that
guesses the code inside the window gets the token, and the only mitigations are
the ones above. That is stated rather than dressed up: this is a convenience
over reading a token aloud, with the blast radius kept small, not an
authenticated pairing protocol.
"""
import hmac
import secrets
import threading
import time

from . import auth

#: No 0/O, no 1/I/L. A code is read off one screen and typed into another, and
#: the characters people confuse are the ones that make them retype it.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
LENGTH = 8
DEFAULT_TTL = 120
MAX_ATTEMPTS = 5

_lock = threading.Lock()
#: In memory only. See the module docstring.
_offer = None


def _new_code():
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))


def normalise(code):
    """What the person typed, as the code it was meant to be.

    Spaces, dashes and case are noise from reading one screen and typing into
    another. O/0 and I/1 are folded onto the characters the alphabet actually
    contains, because a code shown as `O` will be typed as `0` by somebody
    often enough to matter.
    """
    out = []
    for ch in str(code or "").upper():
        if ch in " -_\t\n":
            continue
        if ch == "O":
            ch = "0"
        if ch in ("I", "L"):
            ch = "1"
        out.append(ch)
    return "".join(out)


def _display(code):
    """Shown in groups of four. Easier to read across, harder to lose place."""
    return " ".join(code[i:i + 4] for i in range(0, len(code), 4))


def offer(payload=None):
    """Open a pairing window on the device that already has the data."""
    ttl = DEFAULT_TTL
    try:
        ttl = max(30, min(600, int((payload or {}).get("ttl") or DEFAULT_TTL)))
    except (TypeError, ValueError):
        pass
    code = _new_code()
    global _offer
    with _lock:
        _offer = {"code": code, "expires": time.time() + ttl,
                  "attempts": 0, "claimed": False}
    return {"status": "ok", "code": _display(code), "raw": code,
            "expires_in": ttl, "attempts_allowed": MAX_ATTEMPTS,
            "note": "Type this on the other device within "
                    f"{ttl} seconds. It works once. Anything on this network "
                    "that guesses it in that window gets the same access, "
                    "which is why the window is short and capped."}


def cancel(payload=None):
    global _offer
    with _lock:
        was = _offer is not None
        _offer = None
    return {"status": "ok", "cancelled": was}


def open_offer():
    """Whether the claim route should answer at all. Read by the transports."""
    with _lock:
        return bool(_offer and not _offer["claimed"]
                    and _offer["expires"] > time.time())


def status(payload=None):
    """Never includes the code: a status call is not a way to read it."""
    with _lock:
        if not _offer:
            return {"status": "ok", "open": False}
        left = int(_offer["expires"] - time.time())
        return {"status": "ok",
                "open": not _offer["claimed"] and left > 0,
                "expires_in": max(0, left),
                "attempts": _offer["attempts"],
                "attempts_allowed": MAX_ATTEMPTS,
                "claimed": _offer["claimed"]}


def claim(payload=None, client_host="", forwarded=False):
    """Redeem a code for this device's token.

    Deliberately returns the same refusal for a wrong code and an expired one.
    Distinguishing them tells somebody guessing whether to keep going.
    """
    global _offer
    code = normalise((payload or {}).get("code", ""))
    with _lock:
        if not _offer or _offer["claimed"] or _offer["expires"] <= time.time():
            return {"status": "error", "reason": "no pairing offer is open",
                    "_status": 403}
        if _offer["attempts"] >= MAX_ATTEMPTS:
            _offer = None
            return {"status": "error",
                    "reason": "too many wrong codes — the offer is closed, "
                              "open a new one on the other device",
                    "_status": 403}
        if forwarded or not _is_private(client_host):
            return {"status": "error",
                    "reason": "pairing only answers devices on this network, "
                              "with nothing forwarding for them",
                    "_status": 403}

        _offer["attempts"] += 1
        # Constant time: a comparison that returns early leaks the prefix.
        if not hmac.compare_digest(normalise(_offer["code"]), code):
            left = MAX_ATTEMPTS - _offer["attempts"]
            if left <= 0:
                _offer = None
            return {"status": "error",
                    "reason": "that code is not valid"
                              + (f" — {left} attempt(s) left" if left > 0
                                 else " — the offer is now closed"),
                    "_status": 403}
        _offer["claimed"] = True

    from . import memory
    return {"status": "ok", "token": auth.get_token(),
            "device": memory.device(),
            "note": "Paired. This code will not work again."}


def _is_private(host):
    """A LAN or loopback address. Anything else is not 'the same room'."""
    h = str(host or "").strip().strip("[]")
    if not h:
        return False
    if h in ("localhost", "::1", "127.0.0.1"):
        return True
    if h.startswith("127.") or h.startswith("fe80:") or h.startswith("fc") \
            or h.startswith("fd"):
        return True
    parts = h.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        a, b = int(parts[0]), int(parts[1])
        if a == 10:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        if a == 192 and b == 168:
            return True
        if a == 169 and b == 254:            # link-local, a direct cable/hotspot
            return True
    return False


def stats():
    s = status()
    return {"offer_open": bool(s.get("open"))}
