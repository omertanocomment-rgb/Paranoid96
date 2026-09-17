"""A cost meter, so a long run cannot surprise you.

Agent work is bursty: one instruction can turn into forty model calls while
you are not watching. On a metered API that is a bill you find out about
afterwards. This records what was actually spent, per project and per day.

Two honesty rules built into the numbers.

**Local models cost nothing and are reported as nothing**, not as a notional
figure. The whole point of running on-device is that there is no meter.

**A price that is not known is not guessed.** Rates change, and inventing one
would produce a confident number that is wrong -- worse than no number. An
unpriced model reports its token counts with `priced: false`, and the totals
say how many calls were unpriced rather than quietly folding them in as zero.
"""
import json
import threading
import time
from pathlib import Path

from . import config

LOCK = threading.Lock()
MAX_DAYS = 90


#: USD per million tokens, (input, output). Only what can be stated plainly.
#: Anything absent is counted but not priced -- see the module docstring.
RATES = {
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-1": (15.00, 75.00),
    "gpt-4o": (2.50, 10.00),
    "gemini-2.0-flash": (0.10, 0.40),
}

#: Providers that run on hardware you own. No meter, and none implied.
FREE_PROVIDERS = {"omerta", "ollama", "llamacpp", "lmstudio"}


def _path():
    return Path(config.DATA_DIR) / "usage.json"


def _load():
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"days": {}}
    return data if isinstance(data, dict) and "days" in data else {"days": {}}


def _save(data):
    days = data.get("days", {})
    # Keep the file bounded: a meter that grows without limit becomes a
    # problem of its own on a phone.
    for key in sorted(days)[:-MAX_DAYS]:
        days.pop(key, None)
    try:
        tmp = _path().with_suffix(".tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(_path())
    except OSError:
        pass


def price(model, provider, tokens_in, tokens_out):
    """Cost in USD, or None when it is not known."""
    if provider in FREE_PROVIDERS:
        return 0.0
    rate = RATES.get(str(model or "").strip())
    if not rate:
        return None
    return (tokens_in / 1e6) * rate[0] + (tokens_out / 1e6) * rate[1]


#: Characters per token, for the estimate. Roughly right for English and code
#: across current tokenizers; wrong for dense non-Latin text. It is only used
#: when a provider does not report real counts, and everything derived from it
#: is labelled an estimate rather than presented as measurement.
CHARS_PER_TOKEN = 4


def estimate_tokens(text):
    return max(0, len(str(text or "")) // CHARS_PER_TOKEN)


def record(provider, model, tokens_in=0, tokens_out=0, project="general",
           estimated=False):
    """Log one model call. Never raises into the caller."""
    try:
        tokens_in, tokens_out = int(tokens_in or 0), int(tokens_out or 0)
        cost = price(model, provider, tokens_in, tokens_out)
        day = time.strftime("%Y-%m-%d")
        with LOCK:
            data = _load()
            bucket = data["days"].setdefault(day, {})
            row = bucket.setdefault(str(project), {
                "calls": 0, "in": 0, "out": 0, "usd": 0.0, "unpriced": 0,
                "estimated": 0, "providers": {}})
            row["calls"] += 1
            if estimated:
                row["estimated"] += 1
            row["in"] += tokens_in
            row["out"] += tokens_out
            if cost is None:
                row["unpriced"] += 1
            else:
                row["usd"] = round(row["usd"] + cost, 6)
            row["providers"][str(provider)] = \
                row["providers"].get(str(provider), 0) + 1
            _save(data)
        return {"usd": cost, "priced": cost is not None}
    except Exception:  # noqa: BLE001 — metering must never break a reply
        return {"usd": None, "priced": False}


def summary(days=30, project=None):
    data = _load()
    keys = sorted(data.get("days", {}))[-days:]
    total = {"calls": 0, "in": 0, "out": 0, "usd": 0.0, "unpriced": 0,
             "estimated": 0}
    per_day, per_project = [], {}
    for k in keys:
        day_total = {"day": k, "calls": 0, "in": 0, "out": 0, "usd": 0.0}
        for proj, row in data["days"][k].items():
            if project and proj != project:
                continue
            for f in ("calls", "in", "out", "unpriced", "estimated"):
                total[f] += row.get(f, 0)
            total["usd"] = round(total["usd"] + row.get("usd", 0.0), 6)
            for f in ("calls", "in", "out"):
                day_total[f] += row.get(f, 0)
            day_total["usd"] = round(day_total["usd"] + row.get("usd", 0.0), 6)
            p = per_project.setdefault(proj, {"calls": 0, "usd": 0.0,
                                              "in": 0, "out": 0})
            p["calls"] += row.get("calls", 0)
            p["in"] += row.get("in", 0)
            p["out"] += row.get("out", 0)
            p["usd"] = round(p["usd"] + row.get("usd", 0.0), 6)
        per_day.append(day_total)
    notes = []
    if total["estimated"]:
        notes.append("token counts are estimated from text length — providers "
                     "here do not report real usage, so treat these as "
                     "indicative, not a bill")
    if total["unpriced"]:
        notes.append("some calls could not be priced; their tokens are counted "
                     "and their cost is not, rather than guessed at")
    return {"total": total, "days": per_day, "projects": per_project,
            "note": " · ".join(notes)}


def today(project=None):
    s = summary(days=1, project=project)
    return s["days"][-1] if s["days"] else {"day": time.strftime("%Y-%m-%d"),
                                            "calls": 0, "in": 0, "out": 0,
                                            "usd": 0.0}


def reset():
    with LOCK:
        _save({"days": {}})
    return {"status": "ok"}


def stats():
    t = summary(days=30)["total"]
    return {"calls_30d": t["calls"], "usd_30d": round(t["usd"], 4),
            "unpriced": t["unpriced"], "today_usd": round(today()["usd"], 4)}
