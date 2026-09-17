#!/usr/bin/env python3
"""
Generate the OMERTA AGENT feature & usage guide as a PDF.

    python scripts/gen_pdf.py [output.pdf]

Pure reportlab (no system converters). Reproducible; the content mirrors the
README / INSTALL / AUDIT docs so the PDF stays a faithful single-file rundown.
"""
import sys
from pathlib import Path

import re as _re
from pathlib import Path as _Path

# The guide states a version on its cover; a guide that claims a version the
# build does not have is worse than one that claims none. Read the one source.
def _version():
    try:
        txt = (_Path(__file__).resolve().parent.parent / "pyproject.toml").read_text()
        m = _re.search(r'^version\s*=\s*"([^"]+)"', txt, _re.M)
        if m:
            return m.group(1)
    except OSError:
        pass
    return "unknown"

VERSION = _version()

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, Image,
                                HRFlowable, ListFlowable, ListItem)

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "OMERTA_AGENT_Guide.pdf"

AMBER = colors.HexColor("#c8860b")     # print-legible amber
AMBER_BR = colors.HexColor("#ffb020")
INK = colors.HexColor("#141210")
BG = colors.HexColor("#0b0a08")
PANEL = colors.HexColor("#f4efe6")
BORDER = colors.HexColor("#d8cfbd")
MUTED = colors.HexColor("#6b6455")
OKG = colors.HexColor("#2e7d32")

styles = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica",
                      fontSize=9.5, leading=14, textColor=INK, spaceAfter=6)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=21,
                    textColor=INK, spaceBefore=6, spaceAfter=8)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, leading=16,
                    textColor=AMBER, spaceBefore=12, spaceAfter=4)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.3, leading=11.5,
                       textColor=MUTED)
CODE = ParagraphStyle("code", fontName="Courier", fontSize=8.4, leading=12,
                      textColor=colors.HexColor("#0d0d0d"),
                      backColor=colors.HexColor("#efeadf"), borderPadding=6,
                      spaceBefore=3, spaceAfter=8)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.6, leading=11.5, spaceAfter=0)
CELLH = ParagraphStyle("cellh", parent=CELL, fontName="Helvetica-Bold",
                       textColor=colors.white)
LEDE = ParagraphStyle("lede", parent=BODY, fontSize=11, leading=16,
                      textColor=INK, spaceAfter=10)


def P(t, s=BODY): return Paragraph(t, s)


def bullets(items):
    return ListFlowable([ListItem(P(x), leftIndent=8, value="•") for x in items],
                        bulletType="bullet", start="•", leftIndent=10)


def table(rows, widths, header=True):
    data = []
    for i, r in enumerate(rows):
        st = CELLH if (header and i == 0) else CELL
        data.append([P(str(c), st) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
             ("TOPPADDING", (0, 0), (-1, -1), 5),
             ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
             ("LEFTPADDING", (0, 0), (-1, -1), 7),
             ("RIGHTPADDING", (0, 0), (-1, -1), 7)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), INK),
                  ("LINEBELOW", (0, 0), (-1, 0), 0.8, AMBER)]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), PANEL))
    t.setStyle(TableStyle(style))
    return t


# ── page furniture ──────────────────────────────────────────────────────────
def cover(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(BG)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(AMBER_BR)
    canvas.rect(0, h - 3.2 * inch, w, 0.10 * inch, fill=1, stroke=0)
    icon = ROOT / "assets" / "icon_256.png"
    if icon.exists():
        try:
            canvas.drawImage(str(icon), w / 2 - 0.7 * inch, h - 2.9 * inch,
                             1.4 * inch, 1.4 * inch, mask="auto")
        except Exception:
            pass
    canvas.setFillColor(AMBER_BR)
    canvas.setFont("Helvetica-Bold", 34)
    canvas.drawCentredString(w / 2, h - 3.9 * inch, "OMERTA AGENT")
    canvas.setFillColor(colors.HexColor("#e8ddc8"))
    canvas.setFont("Helvetica", 13)
    canvas.drawCentredString(w / 2, h - 4.35 * inch,
                             "Features & Full Usage Guide")
    canvas.setFillColor(colors.HexColor("#8a8272"))
    canvas.setFont("Helvetica", 10.5)
    for i, line in enumerate([
            "An offline-capable coding & firmware agent that asks before it acts.",
            "Runs on Android (no Termux), Linux, Kali, macOS, Windows, and any browser on your LAN.",
            "Swappable brains: local models offline, frontier models online."]):
        canvas.drawCentredString(w / 2, h - (4.95 + i * 0.24) * inch, line)
    canvas.setFillColor(AMBER_BR)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawCentredString(w / 2, 1.5 * inch, f"Version {VERSION}")
    canvas.setFillColor(colors.HexColor("#6b6455"))
    canvas.setFont("Courier", 9)
    canvas.drawCentredString(w / 2, 1.2 * inch,
                             "always-ask · offline+online · unlimited chats · self-contained APK")
    canvas.restoreState()


def chrome(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(INK)
    canvas.rect(0, h - 0.62 * inch, w, 0.62 * inch, fill=1, stroke=0)
    canvas.setFillColor(AMBER_BR)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(0.75 * inch, h - 0.42 * inch, "OMERTA AGENT")
    canvas.setFillColor(colors.HexColor("#8a8272"))
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w - 0.75 * inch, h - 0.42 * inch,
                           f"Features & Usage Guide · v{VERSION}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.75 * inch, 0.6 * inch, w - 0.75 * inch, 0.6 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w - 0.75 * inch, 0.42 * inch, "Page %d" % doc.page)
    canvas.drawString(0.75 * inch, 0.42 * inch, "Generated by OMERTA build tooling")
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(str(OUT), pagesize=LETTER,
                          leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                          topMargin=0.9 * inch, bottomMargin=0.8 * inch,
                          title="OMERTA AGENT — Features & Usage Guide",
                          author="OMERTA")
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="main")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover),
        PageTemplate(id="content", frames=[frame], onPage=chrome)])

    S = []
    from reportlab.platypus import NextPageTemplate
    S.append(NextPageTemplate("content"))
    S.append(PageBreak())     # page 1 stays the drawn cover

    # 1. What it is
    S.append(P("What OMERTA is", H1))
    S.append(P("A complete agent framework that drives real backends. It is not a "
               "clone of Codex or Claude — model weights can't be copied out of the "
               "labs that made them — but it <b>calls</b> them (and any local model), "
               "with one hard rule: it proposes every action and runs nothing until "
               "you approve it. That rule is enforced in control flow, not in a prompt, "
               "and is covered by tests.", LEDE))
    S.append(P("The Android app is fully self-contained: it embeds Python and runs the "
               "agent in-process, so there is no Termux and nothing external to set up. "
               "The backend is a normal HTTP service — no websocket, no dependency to "
               "install — and the same code runs on every platform.", BODY))

    # 2. Feature matrix
    S.append(P("Feature matrix", H2))
    S.append(table([
        ["Capability", "What you get"],
        ["Offline + online", "Local GGUF models (Ollama / llama.cpp / LM Studio) and 6 cloud providers, auto-switching, with an explicit Offline / Online / Auto mode."],
        ["Unlimited chats", "No message cap. Long conversations are compacted into a bounded context window so they never hit a wall. Truly unlimited offline."],
        ["Always ask first", "Every command, file write, plugin side effect and connector call is proposed and waits for your yes. Enforced in code."],
        ["Learns your choices", "Every approve / deny / edit is recorded and fed back; denials become standing preferences."],
        ["Sandbox", "Tiered execution, a hard-deny list that can't be approved, and automatic backups before edits."],
        ["Network safety", "Per-install token auth, loopback-exempt, spoof-proof against forwarded-header tricks."],
        ["Self-contained mobile", "Android APK embeds CPython (Chaquopy); the agent runs on-device with no Termux."],
        ["Connectors / plugins / skills", "MCP client, Python plugin loader, keyword-loaded skill playbooks."],
        ["Shared memory", "Peer (LAN) and shared-folder sync; denials and deletions propagate across devices."],
    ], [1.6 * inch, 5.4 * inch]))

    # 3. Architecture
    S.append(PageBreak())
    S.append(P("Architecture", H1))
    S.append(P("One agent, many front-ends", H2))
    S.append(P("All request logic lives in <font face='Courier'>core/api.py</font>, so "
               "there is exactly one approval gate and one wire protocol no matter how "
               "you reach the agent:", BODY))
    S.append(bullets([
        "<b>CLI</b> — <font face='Courier'>omerta</font> in a terminal.",
        "<b>FastAPI server</b> (<font face='Courier'>server.py</font>) — for desktop / LAN, reachable from any browser.",
        "<b>Stdlib server</b> (<font face='Courier'>core/httpd.py</font>) — zero third-party deps; what the Android app runs, and a drop-in fallback anywhere FastAPI isn't installed.",
        "<b>Electron</b> desktop shell and the responsive <b>web UI</b>.",
    ]))
    S.append(P("Embedded Android backend", H2))
    S.append(P("Chaquopy bundles CPython 3.11 plus pure-Python deps (requests, pyyaml) "
               "into the APK. A foreground service starts the stdlib server on "
               "127.0.0.1; the WebView loads the same UI. The agent's Python is the "
               "repo's <font face='Courier'>core/</font> and <font face='Courier'>tools/</font>, "
               "staged into the APK at build time and extracted on first launch — so the "
               "approval gate and deny-list can't drift from desktop.", BODY))
    S.append(Table([[P(
        "MainActivity → BackendService → Chaquopy Python → omerta_boot → "
        "omerta_android → core.httpd (127.0.0.1)  ◀── WebView (loopback, no token)",
        CODE)]], colWidths=[7 * inch]))

    # 4. Install & run
    S.append(P("Install & run", H1))
    S.append(P("Android (no Termux)", H2))
    S.append(P("Install the APK, open it, and pick a brain in <b>☰ → MODE / MODEL "
               "ACCESS</b> — paste a cloud API key (online) or point it at a local "
               "model (offline). Nothing else to install.", BODY))
    S.append(P("pip — Linux / macOS / Windows / Termux", H2))
    S.append(P("pip install omerta_agent-1.0.0-py3-none-any.whl[all]<br/>"
               "omerta            # interactive CLI<br/>"
               "omerta serve      # web UI on :8787<br/>"
               "omerta doctor     # what works, what's missing<br/>"
               "omerta sync       # share memory across devices", CODE))
    S.append(P("Give it a brain", H2))
    S.append(P("export ANTHROPIC_API_KEY=sk-ant-...            # online<br/>"
               "ollama serve &amp;&amp; ollama pull qwen2.5-coder:7b   # offline, unlimited",
               CODE))

    # 5. Approval workflow
    S.append(PageBreak())
    S.append(P("The always-ask guarantee", H1))
    S.append(P("Every side-effecting action is proposed, never executed, until you "
               "answer. What you approve is character-for-character what runs.", BODY))
    S.append(table([
        ["Answer", "What happens"],
        ["RUN", "Executes, is logged, and is remembered as approved."],
        ["EDIT", "Your rewrite runs instead — a strong signal; it learns your form."],
        ["REFUSE", "Never retried; the agent proposes a different approach."],
    ], [1.1 * inch, 5.9 * inch]))
    S.append(P("Risk tiers & the hard-deny list", H2))
    S.append(bullets([
        "<b>DENY</b> — patterns like <font face='Courier'>rm -rf /</font>, "
        "<font face='Courier'>fastboot flashall -w</font>, <font face='Courier'>mkfs</font> "
        "on a raw disk: refused outright, not runnable even if you try to approve.",
        "<b>HIGH_RISK</b> — flashing, <font face='Courier'>dd</font>, <font face='Courier'>git push --force</font>, "
        "<font face='Courier'>rm -rf</font>: shown with a loud destructive warning.",
        "<b>NORMAL / LOW_RISK</b> — everything else; read-only commands run freely so "
        "the agent can actually think.",
    ]))
    S.append(P("It generalizes: denying <font face='Courier'>fastboot erase userdata</font> "
               "teaches it about <font face='Courier'>fastboot erase</font> broadly. "
               "<font face='Courier'>/prefs</font> shows what it thinks it knows.", SMALL))

    # 6. Modes + unlimited
    S.append(P("Offline / Online / Auto & unlimited chats", H1))
    S.append(table([
        ["Mode", "Behavior"],
        ["Auto", "Online if reachable, otherwise a local model — switches on its own if you lose signal mid-task."],
        ["Offline", "Local models only. Never touches the network. True unlimited — your hardware, your rules."],
        ["Online", "Cloud providers only."],
    ], [1.1 * inch, 5.9 * inch]))
    S.append(P("Chats have no message cap. To keep an endless conversation from "
               "overflowing the model's context window, only the most recent turns are "
               "replayed; older turns are already distilled into long-term memory, so "
               "nothing durable is lost.", BODY))

    # 7. Providers
    S.append(P("Model providers", H2))
    S.append(table([
        ["Provider", "Kind", "Net", "Default model"],
        ["claude / claude-opus", "Anthropic", "online", "claude-sonnet-4-6 / opus-4-1"],
        ["openai", "OpenAI", "online", "gpt-4o"],
        ["openrouter", "OpenAI-compat", "online", "anthropic/claude-sonnet-4"],
        ["groq", "OpenAI-compat", "online", "llama-3.3-70b-versatile"],
        ["gemini", "OpenAI-compat", "online", "gemini-2.0-flash"],
        ["ollama", "Ollama", "offline", "qwen2.5-coder:7b"],
        ["llamacpp", "llama.cpp", "offline", "local GGUF"],
        ["lmstudio", "OpenAI-compat", "offline", "local model"],
    ], [1.9 * inch, 1.7 * inch, 0.8 * inch, 2.6 * inch]))
    S.append(P("The Anthropic provider works without the SDK (pure requests), so Termux "
               "needs no Rust toolchain for pydantic-core.", SMALL))

    # 8. Extending
    S.append(PageBreak())
    S.append(P("Extending it", H1))
    S.append(P("Skills", H2))
    S.append(P("Playbooks in <font face='Courier'>skills/&lt;name&gt;/SKILL.md</font>, "
               "auto-loaded by keyword. Ships with eight: android-build, firmware-flash, "
               "cross-compile, apk-analysis, termux-env, git-hygiene, debug-build-failure, "
               "release-packaging.", BODY))
    S.append(P("Plugins", H2))
    S.append(P("Drop a Python file in <font face='Courier'>plugins/</font> exposing a "
               "<font face='Courier'>register()</font> that returns tools; ~20 lines. Any "
               "tool marked <font face='Courier'>side_effects=True</font> is routed through "
               "the same approval gate — plugins cannot bypass always-ask.", BODY))
    S.append(P("Connectors (MCP)", H2))
    S.append(P("Any MCP server, stdio or HTTP, configured in "
               "<font face='Courier'>connectors.yaml</font> (GitHub, filesystem, git, "
               "sqlite, Sentry, Cloudflare presets). Tools appear as "
               "<font face='Courier'>mcp.&lt;server&gt;.&lt;tool&gt;</font> and every call "
               "needs approval.", BODY))
    S.append(P("Importing what you already have", H2))
    S.append(P("/import ~/Downloads/conversations.json   # claude.ai or ChatGPT export<br/>"
               "/import ~/notes                          # a markdown directory<br/>"
               "/import ~/src/omerta-beats               # a repo — learns its structure",
               CODE))

    # 9. Sync
    S.append(P("One brain across every device", H1))
    S.append(P("What your phone learns, your Kali box knows — with no cloud account in "
               "the middle. Denials travel too: refusing a command on one device stops "
               "it being proposed on the others.", BODY))
    S.append(P("export OMERTA_SYNC_DIR=~/Syncthing/omerta   # shared folder (works offline)<br/>"
               "/sync                     # sync via the shared folder<br/>"
               "/sync 192.168.1.42:8787   # straight to another device on the LAN<br/>"
               "/sync status              # peers, folders, last sync", CODE))
    S.append(P("Rows carry a uid so re-syncing is idempotent; facts merge last-write-wins; "
               "tombstoned deletions propagate and are never resurrected; a DENIED choice "
               "is never dropped in a conflict — safety signals only accumulate.", SMALL))

    # 10. Security
    S.append(PageBreak())
    S.append(P("Security & audit", H1))
    S.append(bullets([
        "<b>Model can't act alone</b> — every side effect suspends for approval; verified by tests.",
        "<b>Hard-deny list</b> — destructive patterns can't be approved at all.",
        "<b>Token auth</b> on the network server; loopback exempt unless the request carries "
        "forwarding headers (spoof-proof). uvicorn runs with proxy headers off.",
        "<b>On-device secrets</b> — API keys stored 0600 in app-private storage, never leave "
        "the device; the write path is loopback-only and off by default on LAN servers.",
        "<b>Auto-backups</b> before any file edit; checkpoints are restorable.",
        "<b>Per-project locking</b> in the threaded server; 16 MiB request cap.",
    ]))
    S.append(P("Full threat model, findings and accepted design choices: "
               "<font face='Courier'>docs/AUDIT.md</font>. Re-run the checks with "
               "<font face='Courier'>bash tests/run_all.sh</font> "
               "(approval, deny-list, auth spoofing on both servers, tool-parse, mode "
               "routing, unlimited-chat trim, multi-device sync).", SMALL))

    # 11. Reference
    S.append(PageBreak())
    S.append(P("Beyond chat — the engineering toolkit", H1))
    S.append(P("OMERTA is a workflow system, not just a chat box. These verbs "
               "work from the CLI and, where they change the world, still pass "
               "through the approval gate.", BODY))
    S.append(P("Codebase intelligence", H2))
    S.append(P("<font face='Courier'>omerta index</font> builds a real index — "
               "Python parsed with <font face='Courier'>ast</font> (classes, "
               "functions, methods + imports + a call graph), other languages via "
               "conservative regex. Then <font face='Courier'>search</font> / "
               "<font face='Courier'>symbol</font> / <font face='Courier'>deps</font> "
               "/ <font face='Courier'>calls</font> answer “where is this "
               "defined / imported / called” instantly. The same power is "
               "available to the agent as the <b>code_index</b> plugin tools.", BODY))
    S.append(P("Engineering roles", H2))
    S.append(P("Ten focus profiles steer the one agent under the same gate: "
               "<font face='Courier'>omerta plan</font> (Architect), "
               "<font face='Courier'>review</font> (Reviewer, read-only), "
               "<font face='Courier'>build</font> / <font face='Courier'>test</font> "
               "/ <font face='Courier'>debug</font>, and Firmware / Security / Docs "
               "/ Researcher / Developer. <font face='Courier'>omerta role &lt;name&gt;</font> "
               "sets a default. <font face='Courier'>omerta workflow</font> chains roles "
               "(plan→review) or runs a <b>team concurrently</b> "
               "(<font face='Courier'>workflow team</font>) — thread-isolated, "
               "read-only, aggregating independent findings.", BODY))
    S.append(P("Sandbox &amp; recovery", H2))
    S.append(P("<font face='Courier'>omerta sandbox snapshot</font> copies a "
               "workspace before a risky change and <font face='Courier'>rollback</font> "
               "restores it (edited and deleted files). Opt-in isolation "
               "(<font face='Courier'>OMERTA_ISOLATE=1</font>) wraps commands with "
               "resource limits and, when bubblewrap/firejail is installed, denies "
               "the network and shadows key stores (~/.ssh, ~/.aws, ~/.gnupg).", BODY))
    S.append(P("Learning", H2))
    S.append(P("<font face='Courier'>omerta teach \"rule\"</font> stores a durable "
               "project rule; <font face='Courier'>memory show</font> / "
               "<font face='Courier'>rules</font> / <font face='Courier'>forget</font> "
               "manage it. Approvals/denials are already learned automatically.", BODY))
    S.append(P("Packaging", H2))
    S.append(P("Ship it as a wheel, an <b>OCI/Docker image</b> "
               "(<font face='Courier'>docker/Dockerfile</font>), a validated "
               "<b>.deb</b> (<font face='Courier'>packaging/build-deb.sh</font>), a "
               "thin AppImage, the self-contained APK, or Electron installers. "
               "<font face='Courier'>scripts/build_all.sh</font> builds whatever "
               "the host can.", BODY))

    S.append(P("HTTP API reference", H1))
    S.append(table([
        ["Method & path", "Purpose"],
        ["POST /api/chat", "One chat turn: {project, kind, text|cmd|note} → full result."],
        ["GET /api/status", "Providers, active model, mode, memory, skills, plugins, connectors."],
        ["POST /api/model", "Set the active provider (or 'auto')."],
        ["POST /api/mode", "Set network mode: auto | offline | online."],
        ["GET/POST /api/secret", "Read which keys are set (booleans only) / set one (loopback-only)."],
        ["GET /api/memory", "Search long-term memory + learned preferences."],
        ["GET /api/history", "Recent command log."],
        ["GET /api/sync/pull, POST /api/sync/push", "Peer memory exchange."],
        ["POST /api/sync/run", "Trigger a sync ({peer} or {dir})."],
        ["POST /api/plugins/reload, /api/connectors/reconnect", "Hot-reload."],
    ], [2.7 * inch, 4.3 * inch]))
    S.append(P("CLI / one-shot", H2))
    S.append(P("omerta                       # interactive<br/>"
               "omerta -c \"audit this repo\"   # one-shot<br/>"
               "omerta --project omerta-beats<br/>"
               "omerta serve | doctor | sync | version<br/>"
               "omerta teach \"rule\" | memory show | rules | role &lt;name&gt;<br/>"
               "omerta index | search \"q\" | symbol Name | deps | calls Name<br/>"
               "omerta git status|diff|log|review | evidence add &lt;conf&gt; \"claim\"<br/>"
               "omerta plan/review/build/test/debug \"...\" | sandbox snapshot|rollback<br/>"
               "omerta workflow &lt;pipeline&gt; \"task\"<br/>"
               "omerta firmware inspect &lt;img&gt; | analyze &lt;dtb|dtbo|boot.img&gt; | extract &lt;img&gt; | report &lt;dir&gt;", CODE))

    # Firmware / device bring-up
    S.append(P("Firmware &amp; device bring-up", H1))
    S.append(P("OMERTA treats firmware the way a careful engineer does: evidence "
               "first, no invented hardware values. Every field is tagged "
               "<b>CONFIRMED &gt; LIKELY &gt; INFERRED &gt; UNKNOWN</b>; UNKNOWN is a "
               "valid answer, so it says “UNKNOWN — evidence required” "
               "rather than guess a GPIO, regulator or panel timing.", BODY))
    S.append(table([
        ["Read-only tool (Level 0)", "What it does"],
        ["inspect_image(path)", "Identify a boot / vendor_boot / dtbo image or raw .dtb; report header version (v0–v4), sizes, cmdline, os_version, and dt-table entries."],
        ["analyze_dtb(path)", "Decode a device tree with a pure-Python FDT parser (no dtc) — a raw .dtb, a dtbo/dt_table entry, or the DTB embedded in a boot.img — into model/SoC/CPU/display/touch/regulators, each with a confidence."],
        ["board_report(dir)", "Fuse an adb evidence dir (getprop/cpuinfo/meminfo/partitions/dmesg + optional .dtb) into a BOARD REPORT with per-field confidence."],
        ["collect_evidence_plan()", "The ordered, read-only adb commands to gather evidence."],
    ], [1.9 * inch, 5.1 * inch]))
    S.append(P("Safety levels map onto the approval gate: L0 read runs freely; "
               "L1 build / L2 modify / L3 device I/O are proposed and approved; "
               "L4 destructive (flash/erase/format) needs explicit approval and the "
               "hard-deny list blocks the unrecoverable ones outright. "
               "<font face='Courier'>firmware/t509k/</font> is a discovery-only TCL "
               "T509K (MT6765) starter tree, and the <b>firmware-bringup</b> skill "
               "drives the STOCK → EXTRACT → ANALYZE → RECONSTRUCT → "
               "BUILD → BOOT-TEST loop, one subsystem at a time.", SMALL))

    # 12. Build
    S.append(P("Build & release", H2))
    S.append(P("bash scripts/build_all.sh    # wheel, standalone binary, Electron, APK<br/>"
               "cd android-native &amp;&amp; gradle assembleDebug   # self-contained APK", CODE))
    S.append(P("Cross-platform limits are real: PyInstaller can't cross-compile, macOS "
               "signing is mac-only, and the APK needs the Android SDK + a host Python "
               "3.8–3.13 (Chaquopy runs pip on the host). See INSTALL.md and "
               "android-native/README.md.", SMALL))

    S.append(Spacer(1, 14))
    S.append(HRFlowable(color=BORDER, thickness=0.6))
    S.append(P(f"OMERTA AGENT v{VERSION} — offline-capable coding &amp; firmware agent that "
               "asks before it acts. This guide is generated from the repository docs.",
               SMALL))

    doc.build(S)
    print("wrote", OUT, f"({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
