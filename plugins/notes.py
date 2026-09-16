"""Quick scratch notes kept alongside memory — TODOs, findings, snippets."""
import time
from pathlib import Path
from core import config

PLUGIN = {"name": "notes", "description": "Append-only project notes/TODO file",
          "version": "1.0"}
NOTES = config.DATA_DIR / "notes.md"


def _add(args):
    line = f"- [{time.strftime('%Y-%m-%d %H:%M')}] {args['text']}\n"
    with open(NOTES, "a") as f:
        f.write(line)
    return {"added": args["text"], "file": str(NOTES)}


def _list(args):
    if not NOTES.exists():
        return {"notes": [], "file": str(NOTES)}
    lines = NOTES.read_text().strip().splitlines()
    n = int(args.get("limit", 30))
    return {"notes": lines[-n:], "file": str(NOTES)}


def register():
    return {
        "note_add": {"description": "Append a note/TODO",
                     "params": {"text": "str"}, "handler": _add, "mutating": True},
        "note_list": {"description": "List recent notes",
                      "params": {"limit": "int"}, "handler": _list, "mutating": False},
    }
