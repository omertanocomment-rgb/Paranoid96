#!/usr/bin/env python3
"""
omerta_brain — Brain Studio for the Omerta AI app.

Build, teach, inspect and chat with portable offline brains (`*.brain`,
format `omerta-brain/1`) on a PC, then load them onto the phone.

  omerta_brain.py new "Luna" --tone playful -o luna.brain
  omerta_brain.py build sources/omerta -o omerta.brain       # from a folder (see README)
  omerta_brain.py teach luna.brain "the wifi password is hunter2"
  omerta_brain.py reply luna.brain "good morning" "rise and grind"
  omerta_brain.py rule  luna.brain "Always answer in one paragraph"
  omerta_brain.py add-docs luna.brain notes/*.md manual.txt
  omerta_brain.py persona luna.brain --name Luna --tone playful --trait curious --catchphrase "Stay shiny!"
  omerta_brain.py info luna.brain
  omerta_brain.py chat luna.brain                             # offline chat in the terminal
  omerta_brain.py merge a.brain b.brain -o both.brain
  omerta_brain.py push luna.brain                             # adb → phone Downloads, opens in the app

Pure standard library. No network. Python 3.8+.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
import zipfile
from typing import Dict, List, Optional

FORMAT = "omerta-brain/1"
TONES = ["calm", "friendly", "playful", "serious", "sarcastic", "mentor", "hype"]

STOP = set("""a an the and or but if then of to in on at for with by from as is are was were be been being am
do does did doing have has had it its this that these those there here what which who whom whose when where why
how can could would should will shall may might must i me you your yours we us our they them their he him his
she her hers so not no yes just about into tell know please some any all more much very really whats what's hows
ok okay hey u ur im i'm s explain describe give show say""".split())


# ----------------------------------------------------------------------------- text

def words(s: str) -> List[str]:
    return [w.strip("'.-") for w in re.split(r"[^\w'#+.-]+", s.lower()) if w.strip("'.-")]


def stem(w: str) -> str:
    if len(w) <= 3 or any(c.isdigit() for c in w):
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("sses"):
        return w[:-2]
    if w.endswith("ing") and len(w) > 5:
        return w[:-3]
    if w.endswith("ed") and len(w) > 4:
        return w[:-2]
    if w.endswith("'s"):
        return w[:-2]
    if w.endswith("s") and not w.endswith("ss") and not w.endswith("us"):
        return w[:-1]
    return w


def tokens(s: str) -> List[str]:
    return [stem(w) for w in words(s) if w not in STOP]


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", s.lower())).strip()


def sentences(text: str) -> List[str]:
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+|\n+", text) if p.strip()]


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def trigrams(s: str) -> set:
    n = " " + normalize(s) + " "
    if len(n) < 3:
        return {n}
    return {n[i:i + 3] for i in range(len(n) - 2)}


def fuzzy_similarity(a: str, b: str) -> float:
    """Model-free paraphrase/typo-tolerant similarity (token + char-trigram Jaccard)."""
    tok = jaccard(set(tokens(a)), set(tokens(b)))
    tri = jaccard(trigrams(a), trigrams(b))
    return 0.55 * tok + 0.45 * tri


def chunk(text: str, max_chars: int = 700) -> List[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r", "")) if p.strip()]
    out, cur = [], ""
    for p in paras:
        if len(p) > max_chars:
            if cur.strip():
                out.append(cur.strip())
            cur = ""
            for s in sentences(p):
                if len(cur) + len(s) > max_chars and cur.strip():
                    out.append(cur.strip())
                    cur = ""
                cur += s + " "
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        else:
            if len(cur) + len(p) > max_chars and cur.strip():
                out.append(cur.strip())
                cur = ""
            cur += p + "\n\n"
    if cur.strip():
        out.append(cur.strip())
    return out


def guess_topic(text: str) -> str:
    m = re.match(r"^(.{2,60}?)\s+(?:is|are|was|were|means|=|:)\s+", text.strip(), re.I)
    if m and len(m.group(1).split()) <= 6:
        return m.group(1).strip()
    first = (sentences(text) or [""])[0]
    return " ".join(first.split()[:6]).rstrip(",.:")


def flip(s: str) -> str:
    pairs = [(r"\bI am\b", "you are"), (r"\bI'm\b", "you're"), (r"\bI was\b", "you were"),
             (r"\bI have\b", "you have"), (r"\bmy\b", "your"), (r"\bmine\b", "yours"),
             (r"\bmyself\b", "yourself"), (r"\bme\b", "you"), (r"\bI\b", "you")]
    for a, b in pairs:
        s = re.sub(a, lambda m: b.capitalize() if m.group(0)[0].isupper() and m.start() == 0 else b, s, flags=re.I)
    return s


# ----------------------------------------------------------------------------- brain io

def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return prefix + format(now_ms(), "x") + format(random.randrange(1 << 20), "x")


def blank(name: str, tone: str = "calm") -> dict:
    t = now_ms()
    return {
        "format": FORMAT, "id": re.sub(r"[^a-z0-9_-]", "-", name.lower()).strip("-") or "brain",
        "name": name, "version": 1, "author": os.environ.get("USER", ""), "description": "",
        "persona": {
            "name": name, "tagline": "your offline brain", "greeting": f"Hey, I'm {name}. What do you need?",
            "description": "", "traits": [], "tone": tone, "verbosity": "medium", "speakingStyle": [],
            "catchphrases": [], "fallbacks": [], "signoff": "", "emoji": False, "flair": 0.35, "systemPrompt": "", "accent": "",
        },
        "knowledge": [], "reflexes": [], "lessons": [], "profile": {}, "model": None,
        "stats": {"conversations": 0, "messages": 0, "taught": 0, "corrections": 0},
        "created": t, "updated": t,
    }


def _read_brain(path: str) -> dict:
    with open(path, encoding="utf-8-sig") as f:
        b = json.load(f)
    if not str(b.get("format", "")).startswith("omerta-brain/"):
        raise ValueError(f"{path}: not an Omerta brain")
    return b


def load(path: str) -> dict:
    try:
        b = _read_brain(path)
    except (json.JSONDecodeError, OSError, ValueError):
        # Fall back to the last-good backup if the primary file is corrupt.
        if os.path.exists(path + ".bak"):
            b = _read_brain(path + ".bak")
        else:
            raise
    base = blank(b.get("name", "Brain"))
    base.update(b)
    base["persona"] = {**blank("x")["persona"], **b.get("persona", {})}
    return base


def save(b: dict, path: str) -> None:
    b["updated"] = now_ms()
    # Keep the previous good copy as <path>.bak before replacing (crash/corruption safety).
    if os.path.exists(path):
        try:
            import shutil
            shutil.copy2(path, path + ".bak")
        except OSError:
            pass
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(b, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def add_fact(b: dict, text: str, topic: str = "", tags=None, source="taught", weight=1.0) -> dict:
    t = text.strip().rstrip(".") + "."
    norm = normalize(t)
    for k in b["knowledge"]:
        if normalize(k["text"]) == norm or fuzzy_similarity(t, k["text"]) >= 0.9:
            k["text"] = t
            k["topic"] = topic or k.get("topic", "")
            k["ts"] = now_ms()
            k["weight"] = max(k.get("weight", 1.0), weight)
            k["tags"] = list(dict.fromkeys((k.get("tags") or []) + (tags or [])))
            return k
    item = {"id": new_id("k"), "topic": topic or guess_topic(t), "text": t, "tags": tags or [],
            "source": source, "ts": now_ms(), "weight": weight}
    b["knowledge"].append(item)
    b["stats"]["taught"] = b["stats"].get("taught", 0) + 1
    return item


def add_reply(b: dict, trigger: str, reply: str) -> None:
    n = normalize(trigger)
    for r in b["reflexes"]:
        if any(normalize(p) == n for p in r["patterns"]):
            if reply not in r["replies"]:
                r["replies"].append(reply)
            return
    b["reflexes"].append({"id": new_id("r"), "patterns": [trigger.strip()], "replies": [reply.strip()]})
    b["stats"]["taught"] = b["stats"].get("taught", 0) + 1


def add_rule(b: dict, text: str) -> None:
    b["lessons"].append({"id": new_id("l"), "text": text.strip(), "ts": now_ms()})


def add_document(b: dict, text: str, source: str, topic: str = "") -> int:
    n = 0
    for i, c in enumerate(chunk(text), 1):
        b["knowledge"].append({"id": new_id("k"), "topic": topic or guess_topic(c), "text": c, "tags": ["doc"],
                               "source": f"{source}#{i}", "ts": now_ms(), "weight": 1.0})
        n += 1
    return n


def read_text(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as f:
        t = f.read()
    if path.lower().endswith((".html", ".htm")):
        t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
        t = re.sub(r"<[^>]+>", " ", t)
    return t


# ----------------------------------------------------------------------------- build from folder

def build_from_folder(folder: str) -> dict:
    """
    folder/
      persona.json      persona fields (+ optional name/description/author at top level)
      facts.txt         one fact per line  (optional "topic :: fact")
      replies.txt       "trigger => reply"  (one per line; multiple lines = multiple replies)
      qa.txt            "Q: question | A: answer"
      rules.txt         one rule per line
      profile.txt       "key: value"
      docs/**           .txt .md .html .csv documents, chunked
    Lines starting with # are comments.
    """
    meta = {}
    pj = os.path.join(folder, "persona.json")
    if os.path.exists(pj):
        with open(pj, encoding="utf-8") as f:
            meta = json.load(f)
    persona = meta.pop("persona", meta if "tone" in meta or "greeting" in meta else {})
    name = meta.get("name") or persona.get("name") or os.path.basename(os.path.abspath(folder))
    b = blank(name, persona.get("tone", "calm"))
    for k in ("id", "author", "description", "version", "model"):
        if k in meta:
            b[k] = meta[k]
    b["persona"].update({k: v for k, v in persona.items() if k != "id"})

    def lines(fn):
        p = os.path.join(folder, fn)
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [l.rstrip("\n") for l in f if l.strip() and not l.lstrip().startswith("#")]

    for l in lines("facts.txt"):
        if "::" in l:
            topic, fact = l.split("::", 1)
            add_fact(b, fact.strip(), topic.strip(), source="studio")
        else:
            add_fact(b, l.strip(), source="studio")
    for l in lines("replies.txt"):
        if "=>" in l:
            t, r = l.split("=>", 1)
            add_reply(b, t.strip(), r.strip())
    for l in lines("qa.txt"):
        m = re.match(r"^\s*Q\s*:\s*(.+?)\s*\|\s*A\s*:\s*(.+)$", l, re.I)
        if m:
            add_reply(b, m.group(1), m.group(2))
            add_fact(b, m.group(2), m.group(1), tags=["qa"], source="studio")
    for l in lines("rules.txt"):
        add_rule(b, l.strip())
    for l in lines("profile.txt"):
        if ":" in l:
            k, v = l.split(":", 1)
            b["profile"][k.strip()] = v.strip()
    docs = os.path.join(folder, "docs")
    if os.path.isdir(docs):
        for p in sorted(glob.glob(os.path.join(docs, "**", "*"), recursive=True)):
            if os.path.isfile(p) and p.lower().endswith((".txt", ".md", ".html", ".htm", ".csv")):
                rel = os.path.relpath(p, docs)
                add_document(b, read_text(p), rel, topic=os.path.splitext(os.path.basename(p))[0].replace("-", " "))
    b["stats"]["taught"] = len(b["knowledge"]) + len(b["reflexes"])
    return b


# ----------------------------------------------------------------------------- mini offline engine (PC chat)

class Engine:
    """Compact port of the app's BrainEngine for PC-side testing."""

    def __init__(self, b: dict):
        self.b = b
        self.last_input: Optional[str] = None
        self._index()

    def _index(self):
        self.docs = self.b["knowledge"]
        self.toks = []
        for d in self.docs:
            t = tokens(d.get("topic", ""))
            self.toks.append(t + t + [x for tag in d.get("tags", []) for x in tokens(tag)] + tokens(d["text"]))
        self.avg = (sum(map(len, self.toks)) / len(self.toks)) if self.toks else 1.0
        self.df: Dict[str, int] = {}
        for t in self.toks:
            for w in set(t):
                self.df[w] = self.df.get(w, 0) + 1

    def search(self, q: str, k: int = 3):
        qt = list(dict.fromkeys(tokens(q)))
        if not qt:
            return []
        hits = []
        n = len(self.docs)
        for i, toks in enumerate(self.toks):
            if not toks:
                continue
            tf: Dict[str, int] = {}
            for w in toks:
                tf[w] = tf.get(w, 0) + 1
            score, matched = 0.0, 0
            for term in qt:
                f = tf.get(term)
                if not f:
                    continue
                matched += 1
                idf = math.log(1 + (n - self.df[term] + 0.5) / (self.df[term] + 0.5))
                score += idf * (f * 2.4) / (f + 1.4 * (0.25 + 0.75 * len(toks) / self.avg))
            if matched:
                hits.append((score * self.docs[i].get("weight", 1.0), matched / len(qt), self.docs[i]))
        return sorted(hits, key=lambda h: -h[0])[:k]

    def respond(self, text: str) -> str:
        p = self.b["persona"]
        t = text.strip()
        m = re.match(r"^(?:please\s+)?(?:remember|note|learn)(?:\s+that)?\s*[:,-]?\s+(.+)$", t, re.I)
        if m:
            add_fact(self.b, m.group(1)); self._index()
            return f"✓ Learned. {m.group(1)}"
        m = re.match(r"^(?:when|if)\s+i\s+say\s+[\"']?(.+?)[\"']?\s*,?\s+(?:you\s+)?(?:say|reply|answer)\s+[\"']?(.+?)[\"']?$", t, re.I)
        if m:
            add_reply(self.b, m.group(1), m.group(2))
            return f"✓ Trained. \"{m.group(1)}\" → \"{m.group(2)}\""
        m = re.match(r"^(?:wrong|that'?s wrong|incorrect|nope)\b[\s,.!:-]*(?:(?:the\s+)?(?:correct\s+|right\s+)?answer\s+is|it'?s|it\s+is|actually)?\s*(.*)$", t, re.I)
        if m and self.last_input and m.group(1):
            add_reply(self.b, self.last_input, m.group(1))
            add_fact(self.b, m.group(1), self.last_input, ["correction"], weight=2.0); self._index()
            return f"✓ Corrected. Next time: {m.group(1)}"
        n = normalize(t)
        for r in self.b["reflexes"]:
            for pat in r["patterns"]:
                pn = normalize(pat)
                if pn == n or (pat.endswith("*") and n.startswith(normalize(pat[:-1]))):
                    self.last_input = t
                    return random.choice(r["replies"]).replace("{me}", p["name"]).replace("{name}", self.b["profile"].get("name", "friend"))
        if re.match(r"^(hi|hello|hey|yo)\b", n):
            return p.get("greeting", "Hi.")
        if n in ("who are you", "what is your name", "what's your name", "whats your name"):
            return f"I'm {p['name']} — {p.get('tagline', '')}."
        q = re.sub(r"^(?:tell me about|what do you know about|what is|what's|who is|define|explain)\s+", "", t, flags=re.I).rstrip("?.!")
        hits = self.search(q)
        self.last_input = t
        d = None
        if hits and hits[0][1] >= (0.5 if len(tokens(q)) <= 2 else 0.34):
            d = hits[0][2]
        else:
            d = self._fuzzy(q)   # paraphrase/typo-tolerant fallback (model-free semantic recall)
        if d is not None:
            out = flip(d["text"]) if d.get("source") == "taught" else d["text"]
            return (out[:1].upper() + out[1:])[:900]
        fb = p.get("fallbacks") or ["I don't know that yet."]
        return random.choice(fb) + " Teach me: \"remember that …\""

    def _fuzzy(self, q: str):
        if not tokens(q) or not self.docs:
            return None
        best, score = None, 0.0
        for d in self.docs:
            s = fuzzy_similarity(q, d.get("topic", "") + " " + d["text"]) * d.get("weight", 1.0)
            if s > score:
                best, score = d, s
        return best if score >= 0.28 else None


# ----------------------------------------------------------------------------- commands

def cmd_new(a):
    b = blank(a.name, a.tone)
    out = a.output or f"{b['id']}.brain"
    save(b, out)
    print(f"created {out}")


def cmd_build(a):
    b = build_from_folder(a.folder)
    out = a.output or f"{b['id']}.brain"
    save(b, out)
    print(f"built {out}: {len(b['knowledge'])} knowledge · {len(b['reflexes'])} replies · {len(b['lessons'])} rules")


def cmd_teach(a):
    b = load(a.brain)
    for fact in a.facts:
        add_fact(b, fact, a.topic or "")
    save(b, a.brain)
    print(f"learned {len(a.facts)} fact(s)")


def cmd_reply(a):
    b = load(a.brain)
    add_reply(b, a.trigger, a.reply)
    save(b, a.brain)
    print("trained")


def cmd_rule(a):
    b = load(a.brain)
    add_rule(b, a.rule)
    save(b, a.brain)
    print("rule added")


def cmd_add_docs(a):
    b = load(a.brain)
    total = 0
    for pattern in a.files:
        for p in glob.glob(pattern) or [pattern]:
            if os.path.isfile(p):
                n = add_document(b, read_text(p), os.path.basename(p), os.path.splitext(os.path.basename(p))[0])
                total += n
                print(f"  {p}: {n} chunk(s)")
    save(b, a.brain)
    print(f"added {total} chunk(s)")


def cmd_persona(a):
    b = load(a.brain)
    p = b["persona"]
    for k in ("name", "tagline", "greeting", "description", "tone", "verbosity", "signoff"):
        v = getattr(a, k)
        if v is not None:
            p[k] = v
    if a.trait:
        p["traits"] = list(dict.fromkeys(p.get("traits", []) + a.trait))
    if a.catchphrase:
        p["catchphrases"] = list(dict.fromkeys(p.get("catchphrases", []) + a.catchphrase))
    if a.fallback:
        p["fallbacks"] = list(dict.fromkeys(p.get("fallbacks", []) + a.fallback))
    if a.style:
        p["speakingStyle"] = list(dict.fromkeys(p.get("speakingStyle", []) + a.style))
    if a.emoji is not None:
        p["emoji"] = a.emoji == "on"
    if a.flair is not None:
        p["flair"] = max(0.0, min(1.0, a.flair))
    save(b, a.brain)
    print(json.dumps(p, indent=2, ensure_ascii=False))


def cmd_info(a):
    b = load(a.brain)
    p = b["persona"]
    print(f"{b['name']}  (id {b['id']}, v{b.get('version', 1)}, {b['format']})")
    print(f"  persona : {p['name']} — {p.get('tagline', '')} · tone {p.get('tone')} · {p.get('verbosity')}")
    print(f"  traits  : {', '.join(p.get('traits', []))}")
    print(f"  memory  : {len(b['knowledge'])} knowledge · {len(b['reflexes'])} replies · {len(b['lessons'])} rules · {len(b['profile'])} profile")
    print(f"  size    : {os.path.getsize(a.brain) / 1024:.1f} KB")
    topics = list(dict.fromkeys(k.get("topic", "") for k in b["knowledge"] if k.get("topic")))
    if topics:
        print(f"  topics  : {', '.join(topics[:15])}{' …' if len(topics) > 15 else ''}")


def cmd_validate(a):
    ok = True
    for path in a.brains:
        try:
            b = load(path)
            ids = [k["id"] for k in b["knowledge"]] + [r["id"] for r in b["reflexes"]]
            assert len(ids) == len(set(ids)), "duplicate ids"
            assert b["persona"].get("tone") in TONES, f"unknown tone {b['persona'].get('tone')}"
            for k in b["knowledge"]:
                assert k.get("text"), "empty knowledge text"
            print(f"ok  {path}")
        except (AssertionError, KeyError, json.JSONDecodeError) as e:
            ok = False
            print(f"BAD {path}: {e}")
    sys.exit(0 if ok else 1)


def cmd_merge(a):
    base = load(a.brains[0])
    for p in a.brains[1:]:
        o = load(p)
        seen = {normalize(k["text"]) for k in base["knowledge"]}
        base["knowledge"] += [k for k in o["knowledge"] if normalize(k["text"]) not in seen]
        for r in o["reflexes"]:
            for pat in r["patterns"]:
                for rep in r["replies"]:
                    add_reply(base, pat, rep)
        have = {l["text"] for l in base["lessons"]}
        base["lessons"] += [l for l in o["lessons"] if l["text"] not in have]
        base["profile"] = {**o["profile"], **base["profile"]}
    save(base, a.output)
    print(f"merged → {a.output}: {len(base['knowledge'])} knowledge · {len(base['reflexes'])} replies")


def cmd_chat(a):
    b = load(a.brain)
    e = Engine(b)
    p = b["persona"]
    print(f"🧠 {p['name']} (offline) — Ctrl-D to quit, changes {'saved' if not a.no_save else 'discarded'}")
    print(f"{p['name']}: {p.get('greeting', '')}")
    try:
        while True:
            try:
                line = input("you> ")
            except EOFError:
                break
            if not line.strip():
                continue
            print(f"{p['name']}: {e.respond(line)}")
    finally:
        if not a.no_save:
            save(b, a.brain)


def cmd_pack(a):
    """Bundle a brain + extra documents into a zip the app imports in one go."""
    with zipfile.ZipFile(a.output, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(a.brain, os.path.basename(a.brain))
        for pattern in a.files:
            for p in glob.glob(pattern):
                z.write(p, "docs/" + os.path.basename(p))
    print(f"packed {a.output}")


def cmd_push(a):
    """Push a brain straight into the app's inbox; the app auto-installs it on next open."""
    adb = shutil.which("adb")
    if not adb:
        sys.exit("adb not found. Copy the .brain file to the phone any way you like "
                 "(USB, Drive, Telegram…) and open it — or use Brain → IMPORT / UPLOAD in the app.")
    pkg = a.package
    inbox = f"/sdcard/Android/data/{pkg}/files/inbox"
    subprocess.call([adb, "shell", "mkdir", "-p", inbox])
    rc = subprocess.call([adb, "push", a.brain, f"{inbox}/{os.path.basename(a.brain)}"])
    if rc != 0:  # some OEMs block Android/data over adb → fall back to Downloads
        dest = f"/sdcard/Download/{os.path.basename(a.brain)}"
        subprocess.check_call([adb, "push", a.brain, dest])
        print(f"pushed to {dest} — in the app: Brain → IMPORT / UPLOAD → Downloads.")
        return
    subprocess.call([adb, "shell", "am", "start", "-n", f"{pkg}/ai.omerta.assistant.MainActivity"])
    print(f"pushed to {inbox}; the app installs it automatically when it opens.")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="omerta_brain", description="Brain Studio for Omerta AI (offline brains).")
    sp = ap.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("new", help="create an empty brain"); s.add_argument("name")
    s.add_argument("--tone", default="calm", choices=TONES); s.add_argument("-o", "--output"); s.set_defaults(f=cmd_new)

    s = sp.add_parser("build", help="build a brain from a source folder"); s.add_argument("folder")
    s.add_argument("-o", "--output"); s.set_defaults(f=cmd_build)

    s = sp.add_parser("teach", help="add facts"); s.add_argument("brain"); s.add_argument("facts", nargs="+")
    s.add_argument("--topic"); s.set_defaults(f=cmd_teach)

    s = sp.add_parser("reply", help="train a reply"); s.add_argument("brain"); s.add_argument("trigger")
    s.add_argument("reply"); s.set_defaults(f=cmd_reply)

    s = sp.add_parser("rule", help="add a standing rule"); s.add_argument("brain"); s.add_argument("rule")
    s.set_defaults(f=cmd_rule)

    s = sp.add_parser("add-docs", help="teach documents (.txt .md .html .csv)"); s.add_argument("brain")
    s.add_argument("files", nargs="+"); s.set_defaults(f=cmd_add_docs)

    s = sp.add_parser("persona", help="edit personality"); s.add_argument("brain")
    for k in ("name", "tagline", "greeting", "description", "signoff"):
        s.add_argument(f"--{k}")
    s.add_argument("--tone", choices=TONES); s.add_argument("--verbosity", choices=["short", "medium", "long"])
    s.add_argument("--trait", action="append"); s.add_argument("--catchphrase", action="append")
    s.add_argument("--fallback", action="append"); s.add_argument("--style", action="append")
    s.add_argument("--emoji", choices=["on", "off"]); s.add_argument("--flair", type=float)
    s.set_defaults(f=cmd_persona)

    s = sp.add_parser("info", help="summarize a brain"); s.add_argument("brain"); s.set_defaults(f=cmd_info)
    s = sp.add_parser("validate", help="check brain files"); s.add_argument("brains", nargs="+"); s.set_defaults(f=cmd_validate)
    s = sp.add_parser("merge", help="merge brains"); s.add_argument("brains", nargs="+")
    s.add_argument("-o", "--output", required=True); s.set_defaults(f=cmd_merge)
    s = sp.add_parser("chat", help="chat offline in the terminal"); s.add_argument("brain")
    s.add_argument("--no-save", action="store_true"); s.set_defaults(f=cmd_chat)
    s = sp.add_parser("pack", help="zip a brain with documents"); s.add_argument("brain"); s.add_argument("files", nargs="*")
    s.add_argument("-o", "--output", required=True); s.set_defaults(f=cmd_pack)
    s = sp.add_parser("push", help="adb-push a brain to the phone"); s.add_argument("brain")
    s.add_argument("--package", default="ai.omerta.assistant"); s.set_defaults(f=cmd_push)

    a = ap.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
