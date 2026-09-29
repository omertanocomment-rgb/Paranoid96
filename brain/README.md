# Omerta Brain: an offline AI you teach

The brain is a personal AI that lives **inside the Omerta AI app** and runs with **no
internet, no API key and no server**. You give it a personality, it remembers what you
teach it, and you can move it between phones as one `.brain` file.

```
                       ┌──────────────── Omerta AI app (phone) ────────────────┐
  you ── chat ───────▶ │  BrainEngine (pure Kotlin, instant, deterministic)    │
                       │   1 teaching   "remember that…", "when I say X say Y" │
                       │   2 reflexes   trained replies                        │
                       │   3 skills     identity · small talk · math · time    │
                       │   4 knowledge  BM25 search over facts + documents     │
                       │   5 fallback   in character, "teach me"               │
                       │          │ (optional)                                  │
                       │          ▼                                             │
                       │  On-device LLM (MediaPipe, Gemma/Phi/Qwen .task)       │
                       │   speaks AS the brain, grounded in what it knows       │
                       └───────────────────────────┬───────────────────────────┘
                                                   │ export / import
                                               my.brain  ◀── Brain Studio (PC)
```

## On the phone

1. **Go offline:** Settings → AI PROVIDER → **BRAIN**, or tap *"go fully OFFLINE"* on the
   start screen, or type `/offline` in chat.
2. **Teach it by talking:**

   | Say | It does |
   |---|---|
   | `remember that the wifi password is hunter2` | stores a fact |
   | `my dog is called Rex` · `I love sushi` · `my name is Sam` | learns about you |
   | `when I say good morning, say rise and grind` | trains a reply (`{name} {me} {time} {date}` work) |
   | `Q: capital of Atlantis? \| A: Poseidonia` | stores a Q&A pair |
   | `always answer in one paragraph` · `never use slang` | adds a standing rule |
   | `your name is Nova` · `be more sarcastic` · `be less formal` | changes its personality |
   | `wrong, it's on Tuesday` | fixes its last answer and uses the fix next time |
   | `forget the gate code` | forgets matching facts, replies and rules |
   | `what do you know` · `tell me more` · `help` | looks inside its memory |

3. **Brain screen** (🧠 icon in the top bar):
   - **Personality:** name, tagline, greeting, character description, traits, tone
     (`calm friendly playful serious sarcastic mentor hype`), answer length, speaking style,
     catchphrases + flair %, "don't know" lines, goodbye line, emoji, custom LLM prompt.
   - **Teach:** forms for facts, trained replies, rules, or pasting a whole document.
   - **What it knows:** search it and forget any fact, reply, rule or profile entry.
   - **Upload / import / export:** install `.brain` files, or teach it from `.txt .md
     .csv .html .zip` documents. Export a `.brain` backup at any time.
   - **Brains on this device:** keep as many as you want (work, study, a character) and switch between them.
   - **On-device LLM (optional):** add a model file for open-ended conversation (below).
   - **Everywhere:** *offline fallback* means that when Claude, OpenAI or Ollama can't be
     reached, the brain answers instead of showing an error. *Personality everywhere*
     means online models speak as your brain and use its knowledge.

### Getting a brain onto the app
- Open a `.brain` file from any file manager, download or chat app. Omerta AI registers
  as a handler, so it installs the brain and makes it active.
- Share text or files *to* Omerta AI. The brain learns them.
- Use **Brain → IMPORT / UPLOAD**.
- From a PC over USB: `python3 brain/omerta_brain.py push my.brain` drops it in the app's
  inbox (`Android/data/<pkg>/files/inbox/`), and the app installs it on the next open.
  Debug builds use `--package ai.omerta.assistant.debug`.

### Optional: an on-device LLM
The brain is complete without a model. It answers what it has been taught, instantly.
If you want it to handle open-ended questions too, add a **MediaPipe LLM Inference**
model file:

| Model | File | Size | Notes |
|---|---|---|---|
| Gemma 3 1B IT (int4) | `gemma3-1b-it-int4.task` | ~550 MB | best default; 4 GB+ RAM phones |
| Gemma 2 2B IT | `gemma2-2b-it-gpu-int8.bin` | ~2.6 GB | stronger, needs a flagship |
| Qwen 2.5 1.5B / Phi-2 | `.task` | 1–2 GB | set prompt format to `chatml` / `phi` |

Get them from Kaggle (Gemma) or `huggingface.co/litert-community`, copy the file onto the
phone, then go to **Brain → ADD MODEL FILE**. Modes:
- **ASSIST** (default): the brain answers what it knows and the model covers the rest.
- **ALWAYS:** the model voices every reply, grounded in the brain's persona and retrieved knowledge.
- **OFF:** brain only.

Teaching, trained replies and corrections are always handled by the brain engine itself,
so what you teach is never lost to model randomness.

## On a PC: Brain Studio (`omerta_brain.py`)
It uses only the Python 3.8+ standard library and needs no network.

```bash
python3 brain/omerta_brain.py new "Luna" --tone playful -o luna.brain
python3 brain/omerta_brain.py persona luna.brain --tagline "your night owl" \
        --trait curious --catchphrase "Stay shiny!" --emoji on
python3 brain/omerta_brain.py teach luna.brain "the wifi password is hunter2"
python3 brain/omerta_brain.py reply luna.brain "good morning" "Rise and shine, {name}!"
python3 brain/omerta_brain.py rule  luna.brain "Always ask a follow-up question"
python3 brain/omerta_brain.py add-docs luna.brain notes/*.md manual.txt
python3 brain/omerta_brain.py chat luna.brain         # test it offline in the terminal
python3 brain/omerta_brain.py info luna.brain
python3 brain/omerta_brain.py merge a.brain b.brain -o both.brain
python3 brain/omerta_brain.py push luna.brain         # adb → phone
```

### Build a brain from a folder
```
sources/mybrain/
  persona.json   {"id","name","author","description","persona":{…}}
  facts.txt      one fact per line, or "topic :: fact"
  replies.txt    trigger => reply
  qa.txt         Q: question | A: answer
  rules.txt      one rule per line
  profile.txt    key: value            (what the brain knows about you)
  docs/**        .txt .md .html .csv   (chunked + searchable)
```
```bash
python3 brain/omerta_brain.py build brain/sources/mybrain -o mybrain.brain
```
Ready-made brains in `brain/brains/`:
- **omerta**, the default brain bundled in the app
- **luna**, a playful character
- **sensei**, a study mentor you load your notes into

## The `.brain` format (`omerta-brain/1`)
It's plain, human-editable JSON:
```json
{
  "format": "omerta-brain/1", "id": "luna", "name": "Luna", "version": 1,
  "persona":  { "name": "Luna", "tone": "playful", "traits": ["curious"], "greeting": "…",
                "catchphrases": ["Stay shiny!"], "verbosity": "medium", "emoji": true, "flair": 0.45 },
  "knowledge":[ { "id": "k…", "topic": "moon", "text": "The Moon is …", "tags": [], "source": "taught", "weight": 1.0 } ],
  "reflexes": [ { "id": "r…", "patterns": ["good morning"], "replies": ["Rise and shine, {name}!"] } ],
  "lessons":  [ { "id": "l…", "text": "Always ask a follow-up question" } ],
  "profile":  { "name": "Sam", "love": "sushi" },
  "stats":    { "messages": 0, "taught": 0, "corrections": 0 }
}
```
Knowledge with `source: "taught"` is written from your point of view ("my dog is Rex")
and the brain flips it when it answers ("your dog is Rex").

## Tests
```bash
python3 -m unittest brain/test_omerta_brain.py                 # Brain Studio
cd android && ./gradlew :app:testDebugUnitTest                 # BrainEngine + Robolectric runtime tests
```

## Teaching, memory control, autonomy & device access (v1.2)

### Upload files to teach — from chat
Tap the **paperclip** in the message bar and pick one or more files (`.txt .md .csv
.html`, extracted `.pdf` text, `.zip`, or a `.brain`). The brain learns them on the spot
and tells you how many knowledge chunks it added. (Opening/sharing a file to the app and
Brain → IMPORT / UPLOAD still work too.)

### Delete specific memory
- In chat: `forget <topic>` removes matching facts, trained replies and rules.
- On the Brain screen: search **WHAT IT KNOWS** and tap **forget** on any single fact,
  trained reply, rule or profile entry. Nothing is deleted without you doing it.

### It develops a personality as it learns yours
Turn on **Brain → Learn my style**. As you chat, the brain quietly tracks your tone,
message length and emoji use and gradually mirrors them (e.g. short + excited + emoji →
it becomes playful, briefer, emoji-on). It never overrides a personality you set by hand,
and the internal counters stay hidden from what it tells you.

### Autonomous, but you stay in control
In **Agent mode** the brain can act on your **own device** with tools: list/read/write/
delete/move files, run shell commands, make HTTP requests, read device info, list apps.

- **Autonomy** (Settings → Agent): *Ask every time*, or *Auto low-risk* (read-only
  steps run on their own; everything else asks). **There is no fully-unattended mode** —
  anything that changes the device always stops for your approval, and **high-risk actions
  explain why** in the approval dialog (with a LOW/MEDIUM/HIGH tag and a reason).
- **It does what you say, but suggests better options.** With *Suggest better options* on,
  if there's a safer or smarter route to your goal it recommends it first, then follows
  your decision.

### Phone / computer & internet access — and the honest bit about "root"
- **Files & internet:** granted through the file tools and `http_request` (any method),
  plus "all-files access" for the whole device.
- **Shell / root:** `run_shell` runs commands on your device. On a **rooted** device it can
  use a `su` shell for full-device reach; with **Termux** installed it can run in the Termux
  userland. Both are gated by the risk-based approval above.
- **"Root without rooting":** Android's security model does **not** let any app grant
  itself root on an un-rooted phone — that's a hard OS boundary, not an app limitation.
  The legitimate way to get root-level (ADB shell, uid=shell) power *without* rooting is a
  helper like **Shizuku** that **you** start yourself over wireless debugging; the app can
  then use that elevated shell. Installing/among a computer works the same way over ADB.
