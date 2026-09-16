"""Fetch a URL — docs, raw source files, pastebins, API responses."""
import requests

PLUGIN = {"name": "http_fetch", "description": "Fetch web pages and raw files",
          "version": "1.0"}


def _fetch(args):
    url = args["url"]
    r = requests.get(url, timeout=30,
                     headers={"User-Agent": "OMERTA-AGENT/1.0"})
    r.raise_for_status()
    body = r.text[: int(args.get("max_chars", 20000))]
    return {"url": url, "status": r.status_code,
            "content_type": r.headers.get("content-type", ""), "body": body}


def register():
    return {
        "http_fetch": {
            "description": "Fetch the contents of a URL (docs, raw code, APIs)",
            "params": {"url": "str", "max_chars": "int (optional)"},
            "handler": _fetch,
            "mutating": False,
        }
    }
