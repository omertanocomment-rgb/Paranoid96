<img src="assets/icon.svg" width="88" align="right" alt="OMERTA">

# OMERTA AGENT

An offline-capable coding & firmware engineering agent that **asks before it
does anything**. Runs on Android/Termux, Linux, Kali, macOS, Windows, and any
browser on your network. Swappable brains — local models with no limits when
offline, frontier models when you have signal.

---

## Straight answer on scope

This is not a copy of Codex or Claude — model weights can't be cloned from
outside the labs that made them. What this **is**: a complete agent framework
that drives real backends.

| You asked for | What you got | Honest caveat |
|---|---|---|
| Offline + online | Local GGUF models (Ollama/llama.cpp/LM Studio) and 6 cloud providers, auto-switching | none |
| No message limits | True offline — your hardware, your rules | Cloud APIs still bill/rate-limit server-side; can't change that |
| Based on Codex + Claude | Claude, GPT, Gemini, Groq, OpenRouter, and any local model, hot-swappable | It *calls* them; it isn't them |
| Always ask first | Enforced in code, not prompt. Verified by tests | — |
| Learns your choices | Every approve/deny/edit recorded and fed back | — |
| Sandbox | Tiered execution, hard-deny list, auto-backups before edits | — |
| Network safety | Token auth on the server, loopback-exempt, spoof-proof | — |
| Mobile/desktop/web | Termux CLI, Electron app (win/mac/linux), Capacitor Android app, responsive web UI | — |
| Connectors/plugins/skills | MCP client, Python plugin loader, skill system | — |
| Shared memory across devices | Peer (LAN) + shared-folder sync; denials and deletions propagate | — |

## Install

Prebuilt artifacts are in `artifacts/`. Full detail in `INSTALL.md`.

```bash
pip install omerta_agent-1.0.0-py3-none-any.whl[all]   # any OS, incl. Termux
omerta doctor
```

Or from source:

```bash
# Android / Termux
bash scripts/install_termux.sh

# Linux / Kali
bash scripts/install_linux.sh

# macOS
bash scripts/install_macos.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\install_windows.ps1

# Check everything
python scripts/doctor.py
```

## Run

```bash
python cli.py                      # terminal
python cli.py --project omerta-beats
python cli.py -c "audit this repo" # one-shot
python server.py                   # web UI -> http://<ip>:8787

cd desktop && npm install && npm start        # desktop app
cd desktop && npm run dist:all                # build installers
```

Give it a brain (either is enough):

```bash
export ANTHROPIC_API_KEY=sk-ant-...           # online
ollama serve && ollama pull qwen2.5-coder:7b  # offline, unlimited
```

## The always-ask guarantee

Every command, file write, plugin side effect and connector call is
**proposed, never executed**, until you approve it. This is enforced in
`core/agent.py` — the model physically cannot run something by "deciding to".
Read-only actions (reading files, searching memory, listing dirs) run freely
so it can actually think.

```
⚠ DESTRUCTIVE — APPROVE?
fastboot flash boot out/boot.img
note: you've denied this 2x / approved 0x
[ RUN ]  [ EDIT ]  [ REFUSE ]
```

Three answers, all of which teach it:
- **RUN** — executes, logged, remembered as approved
- **EDIT** — your rewrite runs instead; it learns your preferred form
- **REFUSE** — never retried; it proposes a different approach

Plus a hard-deny list (`rm -rf /`, `fastboot flashall -w`, `mkfs` on a raw
disk…) that can't be approved at all.

## How it learns

| Signal | What it does |
|---|---|
| You approve X 3+ times | Stops second-guessing that pattern |
| You deny X | Stored as a standing preference; won't re-propose |
| You edit a command | Learns your form over its own |
| A command fails | Records the error so it isn't re-debugged next month |
| Every session | Compressed summary written to SQLite |

Commands are generalized, so denying `fastboot erase userdata` teaches it
about `fastboot erase` broadly. `/prefs` shows what it thinks it knows.

## Extending it

- **Skills** (`skills/<name>/SKILL.md`) — playbooks auto-loaded by keyword.
  Ships with 8: android-build, firmware-flash, cross-compile, apk-analysis,
  termux-env, git-hygiene, debug-build-failure, release-packaging.
- **Plugins** (`plugins/*.py`) — add tools in ~20 lines. See `docs/PLUGINS.md`.
- **Connectors** (`connectors.yaml`) — any MCP server, stdio or HTTP.
  GitHub, filesystem, git, sqlite, Sentry, Cloudflare presets included.

## Importing what you already have

```
/import ~/Downloads/conversations.json   # claude.ai or ChatGPT export
/import ~/notes                          # markdown directory
/import ~/src/omerta-beats               # repo — learns its structure
```

## Layout

```
core/       agent loop, router, memory, sandbox, skills, plugins, mcp, auth, sync, toolparse
core/providers/  anthropic, openai-compatible, ollama, llama.cpp
tools/      fileops, devtools, firmware, importers
skills/     8 playbooks
plugins/    5 example plugins (incl. package-style wireless_adb)
desktop/    Electron shell (win/mac/linux)
android/    Capacitor shell (native app icon)
assets/     blackletter O icon, every platform size
scripts/    installers + doctor
tests/      safety, integration, flash-gating, auth, multi-device sync
docs/       deeper guides
```

## One brain everywhere

```bash
export OMERTA_SYNC_DIR=~/Syncthing/omerta   # or Dropbox/Drive/SD card
export OMERTA_SYNC_ON_START=1
```
```
/sync                     # shared folder (works offline)
/sync 192.168.1.42:8787   # straight to another device on the LAN
/sync status              # peers, folders, last sync
```

What your phone learns, your Kali box knows. Denials travel too — refusing
`fastboot erase` on one device stops it being proposed on the others. See
`docs/SYNC.md`.

Full docs: `docs/SAFETY.md`, `docs/PLUGINS.md`, `docs/CONNECTORS.md`,
`docs/SKILLS.md`, `docs/MODELS.md`, `docs/SYNC.md`, `docs/FIRMWARE_ROM.md`, `docs/PERSONA.md`.
