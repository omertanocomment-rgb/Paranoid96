"""
Tolerant tool-call parsing.

Frontier models emit the documented ```tool block reliably. 7B models running
on a phone do not — they use the wrong fence, drop it entirely, emit Python
dict syntax, leave trailing commas, or rename the keys to the OpenAI
function-calling shape they saw more of in training.

Rejecting all of that and asking them to retry burns tool iterations and
often produces the same malformed output again. So we parse generously:
extract the most likely JSON object, repair common syntax damage, and
normalize key aliases. The *semantics* stay strict — an unknown tool name or
a missing required arg is still an error, and every side effect still goes
through the approval gate. Only the syntax is forgiving.
"""
import json
import re

# fenced blocks, most-specific first
_FENCES = [
    re.compile(r"```(?:tool|tool_call|tooluse|function|function_call)\s*\n(.*?)```", re.DOTALL | re.I),
    re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.I),
    re.compile(r"<tool(?:_call)?>(.*?)</tool(?:_call)?>", re.DOTALL | re.I),
]
_LABEL = re.compile(r"(?:^|\n)\s*(?:tool|action|tool_call)\s*[:=]\s*(\{.*)", re.DOTALL | re.I)

TOOL_KEYS = ("tool", "name", "tool_name", "function", "action")
ARG_KEYS = ("args", "arguments", "parameters", "params", "input", "kwargs")


def _balanced(text, start):
    """Return the JSON object starting at `start`, respecting strings/escapes."""
    depth = 0
    in_str = False
    esc = False
    quote = ""
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                in_str = False
            continue
        if ch in "\"'":
            in_str, quote = True, ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _candidates(text):
    """Every plausible JSON-object string in the model's reply."""
    out = []
    for pat in _FENCES:
        for m in pat.finditer(text):
            body = m.group(1).strip()
            i = body.find("{")
            if i >= 0:
                out.append(_balanced(body, i) or body)
    m = _LABEL.search(text)
    if m:
        blob = m.group(1)
        out.append(_balanced(blob, blob.find("{")) or blob)
    # bare object anywhere (last resort)
    for m in re.finditer(r"\{", text):
        b = _balanced(text, m.start())
        if b and any(k in b for k in TOOL_KEYS):
            out.append(b)
            break
    seen, uniq = set(), []
    for c in out:
        if c and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def _repair(s):
    """Fix the syntax damage small models actually produce."""
    s = s.strip()
    s = re.sub(r"^//.*$|^#.*$", "", s, flags=re.M)          # comment lines
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)        # block comments
    s = re.sub(r",(\s*[}\]])", r"\1", s)                    # trailing commas
    # python literals -> json (outside strings only)
    s = re.sub(r"(?<![\"\w])True(?![\"\w])", "true", s)
    s = re.sub(r"(?<![\"\w])False(?![\"\w])", "false", s)
    s = re.sub(r"(?<![\"\w])None(?![\"\w])", "null", s)
    return s


def _to_double_quotes(s):
    """Convert a single-quoted pseudo-JSON object to valid JSON."""
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch == '"':
            out.append(ch); i += 1
            while i < n:
                out.append(s[i])
                if s[i] == "\\":
                    i += 2
                    if i - 1 < n:
                        out.append(s[i - 1])
                    continue
                if s[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch == "'":
            out.append('"'); i += 1
            while i < n and s[i] != "'":
                if s[i] == '"':
                    out.append('\\"')
                elif s[i] == "\\":
                    out.append(s[i])
                    i += 1
                    if i < n:
                        out.append(s[i])
                else:
                    out.append(s[i])
                i += 1
            out.append('"'); i += 1
            continue
        out.append(ch); i += 1
    return "".join(out)


def _loads(s):
    for attempt in (s, _repair(s), _to_double_quotes(_repair(s))):
        try:
            v = json.loads(attempt)
            if isinstance(v, dict):
                return v
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def _normalize(d):
    """Map key aliases onto {"tool": str, "args": dict}."""
    if not isinstance(d, dict):
        return None
    tool = None
    for k in TOOL_KEYS:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            tool = v.strip()
            break
        if isinstance(v, dict):  # {"function": {"name": ..., "arguments": ...}}
            inner = _normalize(v)
            if inner:
                return inner
    if not tool:
        return None
    args = {}
    for k in ARG_KEYS:
        v = d.get(k)
        if isinstance(v, dict):
            args = v
            break
        if isinstance(v, str):
            parsed = _loads(v)          # args sometimes arrive JSON-encoded
            if isinstance(parsed, dict):
                args = parsed
                break
    if not args:
        args = {k: v for k, v in d.items()
                if k not in TOOL_KEYS + ARG_KEYS}
    return {"tool": tool, "args": args if isinstance(args, dict) else {}}


def parse(text):
    """Best-effort extraction of a tool call. Returns None if there isn't one."""
    if not text or "{" not in text:
        return None
    for cand in _candidates(text):
        d = _loads(cand)
        norm = _normalize(d) if d else None
        if norm:
            return norm
    return None


def strip_call(text):
    """The prose part of a reply, with the tool block removed."""
    out = text
    for pat in _FENCES:
        out = pat.sub("", out)
    out = _LABEL.sub("", out)
    return out.strip()
