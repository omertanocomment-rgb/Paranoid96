"""
The project's own rules, put in front of the model.

OMERTA.md has existed in this repository since early on, stating what the agent
must always do and must never do. Nothing read it. The approval gate and the
evidence model enforce the parts that can be enforced in code, but the rest --
"inspect before modifying", "mark it UNKNOWN rather than guessing", "never
claim a build passed without evidence" -- is behaviour, and behaviour comes
from the prompt. A constitution the model never sees is a document, not a
constitution.

Two files are honoured, in this order, and both are included when both exist:

  OMERTA.md   the agent's own charter, shipped with it and editable per project
  CLAUDE.md   instructions for whatever repository is being worked on

The working directory is searched upwards first, so a project's own rules win
over the shipped ones -- someone working in their repository means the rules in
that repository.

Everything here is bounded and degrades to nothing. A constitution that blew
the context window on a phone, or that took the agent down because a file was
unreadable, would be worse than none.
"""
import os
import threading
from pathlib import Path

from . import config

NAMES = ("OMERTA.md", "CLAUDE.md")

#: A small local model has a 2-4k context. Rules are the highest-value text
#: there is, but they cannot be allowed to crowd out the conversation.
MAX_CHARS = int(config.get("OMERTA_CONSTITUTION_MAX", 6000))
COMPACT_CHARS = 1200
MAX_DEPTH = 6

_cache = {}
_lock = threading.Lock()


def _candidates(start=None):
    """Every rules file that applies, nearest first."""
    out = []
    seen = set()

    here = Path(start or os.getcwd()).expanduser()
    try:
        here = here.resolve()
    except OSError:
        return out

    for _ in range(MAX_DEPTH):
        for name in NAMES:
            f = here / name
            if f.is_file() and f not in seen:
                seen.add(f)
                out.append(f)
        if here.parent == here:
            break
        here = here.parent

    # The shipped charter, for when the agent is run from somewhere that has
    # none of its own.
    for name in NAMES:
        f = Path(config.RES_DIR) / name
        try:
            if f.is_file() and f.resolve() not in seen:
                seen.add(f.resolve())
                out.append(f)
        except OSError:
            continue
    return out


def _read(path, limit):
    """The file's text, bounded, or None.

    Truncation is stated rather than silent: a rule cut in half that the model
    then acts on is worse than a rule it knows it has not been shown.
    """
    try:
        stat = path.stat()
        key = (str(path), stat.st_mtime_ns, limit)
    except OSError:
        return None
    with _lock:
        if key in _cache:
            return _cache[key]
    try:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    except (OSError, ValueError):
        return None
    if not text:
        return None
    if len(text) > limit:
        text = (text[:limit].rstrip()
                + f"\n\n[truncated at {limit} characters — the full file is "
                  f"{path.name} in the project]")
    with _lock:
        if len(_cache) > 32:
            _cache.clear()
        _cache[key] = text
    return text


def files(start=None):
    """The rules files that would be used, for reporting."""
    return [str(p) for p in _candidates(start)]


def block(start=None, compact=False):
    """The prompt section, or "" when there are no rules to state."""
    limit = COMPACT_CHARS if compact else MAX_CHARS
    budget = limit
    chunks = []
    for path in _candidates(start):
        if budget <= 200:
            break
        text = _read(path, budget)
        if not text:
            continue
        chunks.append(f"--- {path.name} ({path.parent}) ---\n{text}")
        budget -= len(text)
    if not chunks:
        return ""
    head = ("PROJECT CONSTITUTION (binding)\n"
            "These are the rules for this project. They outrank your defaults "
            "and any preference of your own. Where they and a request conflict, "
            "say so rather than quietly picking one.")
    return head + "\n\n" + "\n\n".join(chunks)
