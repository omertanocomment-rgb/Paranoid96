"""
Skills — folders of reusable expertise the agent loads on demand.

A skill is a directory under skills/ containing SKILL.md with YAML
frontmatter:

    ---
    name: android-build
    description: When to use this and what it covers.
    triggers: [gradle, apk, android, kotlin]
    ---
    ...markdown body: procedures, gotchas, command recipes...

The agent sees every skill's name+description at all times (cheap), and
the full body is injected only when a skill matches the current task
(keeps context small enough for a 7B local model to stay coherent).
"""
import re
from . import config

_FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


def _parse(path):
    raw = path.read_text(encoding="utf-8")
    m = _FM.match(raw)
    meta, body = {}, raw
    if m:
        body = m.group(2)
        try:
            import yaml
            meta = yaml.safe_load(m.group(1)) or {}
        except Exception:  # noqa: BLE001
            meta = {}
    return {
        "name": meta.get("name", path.parent.name),
        "description": meta.get("description", ""),
        "triggers": [t.lower() for t in (meta.get("triggers") or [])],
        "body": body.strip(),
        "path": str(path),
    }


def load_all():
    config.SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    paths = list(config.SKILLS_DIR.glob("*/SKILL.md"))
    # user-authored skills live beside their data and survive upgrades
    if config.USER_SKILLS_DIR.exists():
        paths += list(config.USER_SKILLS_DIR.glob("*/SKILL.md"))
    out = []
    for p in sorted(paths):
        try:
            out.append(_parse(p))
        except Exception as e:  # noqa: BLE001
            out.append({"name": p.parent.name, "description": f"[parse error: {e}]",
                        "triggers": [], "body": "", "path": str(p)})
    return out


def catalog() -> str:
    skills = load_all()
    if not skills:
        return ""
    lines = ["[Available skills — say 'use skill <name>' or I'll auto-load a match]"]
    lines += [f"- {s['name']}: {s['description']}" for s in skills]
    return "\n".join(lines)


def match(text, limit=2):
    """Score skills against the user's message; return the best matches."""
    t = (text or "").lower()
    scored = []
    for s in load_all():
        score = sum(2 for trig in s["triggers"] if trig in t)
        score += sum(1 for w in s["name"].lower().split("-") if w and w in t)
        if score:
            scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return [s for _, s in scored[:limit]]


def load_body(name):
    for s in load_all():
        if s["name"].lower() == name.lower():
            return s["body"]
    return f"[no skill named '{name}'. Available: " \
           f"{', '.join(s['name'] for s in load_all())}]"


def active_block(user_text) -> str:
    hits = match(user_text)
    if not hits:
        return ""
    blocks = [f"[Skill loaded: {s['name']}]\n{s['body']}" for s in hits]
    return "\n\n".join(blocks)
