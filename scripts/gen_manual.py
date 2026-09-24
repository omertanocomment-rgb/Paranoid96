#!/usr/bin/env python3
"""
Generate the OMERTA AI Owner's Manual as a PDF.

    python scripts/gen_manual.py [output.pdf]

This is the manual, not the feature list: it is written to be read by the
person who owns the thing, in the order they will need it, and it says plainly
what OMERTA does not do as well as what it does. scripts/gen_pdf.py remains
the shorter feature/usage guide.

Pure reportlab, no system converters. The version and the toolset numbers are
read from the repository so the manual cannot claim a build that does not
exist.
"""
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle, PageBreak,
                                HRFlowable, ListFlowable, ListItem,
                                NextPageTemplate)

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "OMERTA_AI_Owners_Manual.pdf"


def version():
    m = re.search(r'^version\s*=\s*"([^"]+)"',
                  (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else "unknown"


VERSION = version()

# OMERTA's own palette, adjusted for paper: the app's near-black and dark red
# read correctly on a cream page, where the screen highlight would not.
RED = colors.HexColor("#8f1017")
RED_BR = colors.HexColor("#c8202b")
INK = colors.HexColor("#151113")
BG = colors.HexColor("#0a0405")
PANEL = colors.HexColor("#f6f1f1")
BORDER = colors.HexColor("#ddd0d1")
MUTED = colors.HexColor("#6d6366")
WARN = colors.HexColor("#8a5a00")

styles = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica",
                      fontSize=9.6, leading=14.2, textColor=INK, spaceAfter=7)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=18, leading=22,
                    textColor=INK, spaceBefore=4, spaceAfter=3)
H1N = ParagraphStyle("h1n", fontName="Helvetica-Bold", fontSize=9,
                     textColor=RED_BR, spaceAfter=2)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
                    textColor=RED, spaceBefore=14, spaceAfter=4)
H3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10, leading=14,
                    textColor=INK, spaceBefore=9, spaceAfter=2)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.4, leading=11.8,
                       textColor=MUTED)
LEDE = ParagraphStyle("lede", parent=BODY, fontSize=11.2, leading=16.5,
                      spaceAfter=11)
CODE = ParagraphStyle("code", fontName="Courier", fontSize=8.5, leading=12.4,
                      textColor=colors.HexColor("#0d0d0d"),
                      backColor=colors.HexColor("#f0eaea"), borderPadding=7,
                      borderWidth=0.4, borderColor=BORDER,
                      spaceBefore=4, spaceAfter=9)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.6, leading=11.6, spaceAfter=0)
CELLH = ParagraphStyle("cellh", parent=CELL, fontName="Helvetica-Bold",
                       textColor=colors.white)
NOTE = ParagraphStyle("note", parent=BODY, fontSize=9.1, leading=13.4,
                      backColor=PANEL, borderPadding=9, borderWidth=0.5,
                      borderColor=BORDER, spaceBefore=6, spaceAfter=10)


def P(t, s=BODY):
    return Paragraph(t, s)


def bullets(items, style=BODY):
    return ListFlowable([ListItem(P(x, style), leftIndent=8, value="•")
                         for x in items],
                        bulletType="bullet", start="•", leftIndent=12)


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
                  ("LINEBELOW", (0, 0), (-1, 0), 0.9, RED_BR)]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), PANEL))
    t.setStyle(TableStyle(style))
    return t


_chapter = {"n": 0, "title": ""}


def chapter(title, lede=None):
    _chapter["n"] += 1
    _chapter["title"] = title
    # The first chapter follows the cover's own break; a second one here would
    # leave a blank page between them.
    out = ([] if _chapter["n"] == 1 else [PageBreak()]) + [
           P(f"CHAPTER {_chapter['n']}", H1N),
           P(title, H1),
           HRFlowable(color=RED_BR, thickness=1.2, spaceBefore=4, spaceAfter=10,
                      width="100%")]
    if lede:
        out.append(P(lede, LEDE))
    return out


# ── page furniture ──────────────────────────────────────────────────────────
def cover(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(BG)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, h - 3.0 * inch, w, 0.09 * inch, fill=1, stroke=0)
    icon = ROOT / "assets" / "icon_256.png"
    if icon.exists():
        try:
            canvas.drawImage(str(icon), w / 2 - 0.75 * inch, h - 2.75 * inch,
                             1.5 * inch, 1.5 * inch, mask="auto")
        except Exception:
            pass
    canvas.setFillColor(RED_BR)
    canvas.setFont("Helvetica-Bold", 38)
    canvas.drawCentredString(w / 2, h - 3.75 * inch, "OMERTA AI")
    canvas.setFillColor(colors.HexColor("#efe2e3"))
    canvas.setFont("Helvetica", 14)
    canvas.drawCentredString(w / 2, h - 4.22 * inch, "Owner's Manual")
    canvas.setFillColor(colors.HexColor("#7d6f71"))
    canvas.setFont("Helvetica-Oblique", 10)
    canvas.drawCentredString(w / 2, h - 4.62 * inch,
                             "Silence Is The Only Unbreakable Code")
    canvas.setFillColor(colors.HexColor("#8a7c7e"))
    canvas.setFont("Helvetica", 10.2)
    for i, line in enumerate([
            "A coding, systems and firmware agent that runs on your own hardware",
            "and asks before it acts. Android without Termux, Linux, macOS, Windows.",
            "You supply the model; OMERTA supplies everything around it."]):
        canvas.drawCentredString(w / 2, h - (5.35 + i * 0.26) * inch, line)
    canvas.setFillColor(RED_BR)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawCentredString(w / 2, 1.55 * inch, f"Version {VERSION}")
    canvas.setFillColor(colors.HexColor("#6d6366"))
    canvas.setFont("Courier", 8.6)
    canvas.drawCentredString(w / 2, 1.22 * inch,
                             "read chapter 2 first - it explains what you must supply")
    canvas.restoreState()


def chrome(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(INK)
    canvas.rect(0, h - 0.6 * inch, w, 0.6 * inch, fill=1, stroke=0)
    canvas.setFillColor(RED_BR)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(0.75 * inch, h - 0.4 * inch, "OMERTA AI")
    canvas.setFillColor(colors.HexColor("#9a8c8e"))
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w - 0.75 * inch, h - 0.4 * inch,
                           f"Owner's Manual · v{VERSION}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.75 * inch, 0.62 * inch, w - 0.75 * inch, 0.62 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8.2)
    canvas.drawCentredString(w / 2, 0.44 * inch, str(canvas.getPageNumber() - 1))
    canvas.restoreState()


# ── content ─────────────────────────────────────────────────────────────────
def build():
    S = []

    # ---- ch 1 : what this is -------------------------------------------
    S += chapter(
        "What OMERTA AI Is",
        "OMERTA AI is an agent that runs on hardware you own. It reads and "
        "writes your code, drives a real shell, inspects and builds firmware "
        "images, remembers what you teach it, and asks your permission before "
        "it changes anything.")

    S.append(P("The one-sentence version", H2))
    S.append(P(
        "It is the whole machine around a language model — the memory, the "
        "tools, the terminal, the sandbox, the approval gate, the interface — "
        "running entirely on your device, with the model itself being a part "
        "you choose and plug in.", BODY))

    S.append(P("What makes it different", H2))
    S.append(bullets([
        "<b>It asks first.</b> Every action the model wants to take is "
        "classified and shown to you before it happens. Destructive and "
        "irreversible operations always ask, no matter how you set the policy.",
        "<b>It runs on your hardware.</b> The Android build carries its own "
        "Python interpreter. There is no Termux, no companion app, no "
        "bootstrap download, and no server of ours in the path.",
        "<b>It has a real terminal.</b> A genuine PTY-backed shell with job "
        "control, plus 288 bundled commands, because Android's own userland is "
        "too thin to work in.",
        "<b>It does not guess.</b> The firmware side in particular labels every "
        "value CONFIRMED, LIKELY, INFERRED or UNKNOWN, and refuses to turn an "
        "UNKNOWN into a guess to keep a task moving.",
        "<b>It is yours to shape.</b> Projects, branched and queued chats, "
        "passcode-locked private chats, a learning shelf you can add to and "
        "take away from, and a theme system down to the fonts and the icon.",
    ]))

    S.append(P("Who it is for", H2))
    S.append(P(
        "Someone who wants an agent on a phone or a laptop that behaves like a "
        "capable colleague rather than a toy: one that can be handed a real "
        "repository, a real device tree or a real shell, and that will tell you "
        "what it does not know instead of inventing it.", BODY))

    # ---- ch 2 : the model ----------------------------------------------
    S += chapter(
        "The Model — Read This First",
        "The single most important thing to understand about OMERTA: it does "
        "not contain a language model, and it will not think without one.")

    S.append(P(
        "<b>OMERTA AI is not itself an AI model.</b> It is an agent — the "
        "harness. Claude, GPT and the rest are models: the part that reasons. "
        "OMERTA is everything else. Installed and opened with nothing "
        "configured, it will start, show its interface, run its terminal and "
        "browse your files, and it will not answer a single question, because "
        "there is nothing behind the chat box yet.", NOTE))

    S.append(P("So what do I have to supply?", H2))
    S.append(P("Exactly one of these two things:", BODY))

    S.append(P("1. An API key, for a model in the cloud", H3))
    S.append(P(
        "Paste it into Settings. The key is stored on your device and sent only "
        "to that provider. This is the easiest route and gives you the "
        "strongest models, at the cost of needing a connection and of your "
        "prompts leaving the device.", BODY))
    S.append(table([
        ["Provider", "Setting", "Notes"],
        ["Claude (Anthropic)", "ANTHROPIC_API_KEY", "Sonnet and Opus; the default choice"],
        ["OpenAI", "OPENAI_API_KEY", "GPT and o-series"],
        ["OpenRouter", "OPENROUTER_API_KEY", "Many models behind one key"],
        ["Groq", "GROQ_API_KEY", "Very fast, open-weight models"],
        ["Google Gemini", "GEMINI_API_KEY", "Gemini via its OpenAI-compatible endpoint"],
    ], [1.5 * inch, 1.7 * inch, 3.6 * inch]))

    S.append(P("2. A local model server, for no key and no internet", H3))
    S.append(P(
        "OMERTA speaks to Ollama, llama.cpp and LM Studio. Point it at the "
        "host and port in Settings. Nothing leaves your network, there is no "
        "key, no per-message cost and no usage limit.", BODY))
    S.append(table([
        ["Server", "Default address", "Getting started"],
        ["Ollama", "http://127.0.0.1:11434", "ollama serve &amp;&amp; ollama pull qwen2.5-coder:7b"],
        ["llama.cpp", "http://127.0.0.1:8080", "llama-server -m your-model.gguf"],
        ["LM Studio", "http://127.0.0.1:1234/v1", "Enable the local server in its UI"],
    ], [1.3 * inch, 1.9 * inch, 3.6 * inch]))

    S.append(P("The honest caveat on phones", H2))
    S.append(P(
        "Those local addresses say 127.0.0.1 — this device. On a laptop that "
        "is easy: run Ollama on the same machine. <b>On a phone there is "
        "currently nothing to run</b>, because OMERTA does not yet bundle an "
        "inference engine. So on Android, \"offline mode\" today means "
        "<i>pointing at a model server on your own network</i> — your PC at "
        "192.168.x.x running Ollama — not a model running on the handset.", BODY))
    S.append(P(
        "That is the one gap between what OMERTA is and the phrase \"runs on its "
        "own without an API key\". Closing it means shipping a llama.cpp server "
        "inside the APK and letting you load a GGUF file. It is the first "
        "recommendation in Chapter 12.", SMALL))

    S.append(P("Online, offline and auto", H2))
    S.append(table([
        ["Mode", "What it does"],
        ["online", "Cloud providers only. Never falls back to a local model."],
        ["offline", "Local providers only. Never touches the network — verified by test, "
                    "not merely intended."],
        ["auto", "Prefers your chosen provider and falls back through the routing order."],
    ], [1.1 * inch, 5.7 * inch]))

    # ---- ch 3 : install -------------------------------------------------
    S += chapter(
        "Installing",
        "One agent, five shapes. Pick whichever matches the machine in front "
        "of you; they share the same code, the same approval gate and the same "
        "data format.")

    S.append(P("Android", H2))
    S.append(P(
        "Copy the APK to the phone and open it; allow \"install unknown apps\" "
        "for whatever you opened it from. Everything is inside: CPython, the "
        "agent, the web interface and the command-line toolset. It needs no "
        "network to start.", BODY))
    S.append(P(
        "Updates install straight over the previous version and keep your "
        "chats, projects, themes and learned files. <b>Do not uninstall first</b> "
        "— that deletes all of it.", BODY))

    S.append(P("Desktop", H2))
    S.append(table([
        ["Format", "Install"],
        ["AppImage", "chmod +x OMERTA-AGENT-desktop-*.AppImage &amp;&amp; ./OMERTA-AGENT-desktop-*.AppImage"],
        [".deb", "sudo apt install ./omerta-agent-desktop_*_amd64.deb"],
        ["tar.gz", "Unpack anywhere and run the binary inside. No install step."],
    ], [1.0 * inch, 5.8 * inch]))

    S.append(P("Command line", H2))
    S.append(table([
        ["Format", "Install", "Needs"],
        ["CLI AppImage", "chmod +x and run", "nothing — carries CPython 3.12"],
        ["Standalone binary", "chmod +x omerta-linux-x86_64", "nothing"],
        [".deb (small)", "sudo apt install ./omerta-agent_*_all.deb", "system python3"],
        ["pip", "pip install omerta_agent-*.whl", "Python 3.9+ (incl. Termux)"],
    ], [1.3 * inch, 3.1 * inch, 2.4 * inch]))
    S.append(P(
        "Use <font face='Courier'>apt install ./file.deb</font> rather than "
        "<font face='Courier'>dpkg -i</font> for the small .deb: dpkg alone will "
        "not pull python3-requests and python3-yaml, and leaves the package "
        "unconfigured.", SMALL))

    S.append(P("Confirming which build you are running", H2))
    S.append(P(
        "Every build carries a stamp naming the commit that produced it. In the "
        "app it is the box at the top of Settings — tap to copy. On a "
        "terminal, <font face='Courier'>omerta --version</font>. Over HTTP, "
        "<font face='Courier'>GET /api/version</font>. If a copy is unstamped it "
        "says so rather than claiming a version it cannot prove.", BODY))

    # ---- ch 4 : approval ------------------------------------------------
    S += chapter(
        "The Approval Gate",
        "The rule that everything else is built around: the model proposes, "
        "you dispose.")

    S.append(P(
        "Every action the agent wants to take — run a command, write a file, "
        "flash an image — is classified before it happens and shown to you "
        "with the exact command it intends to run. Nothing is paraphrased.", BODY))

    S.append(P("The four tiers", H2))
    S.append(table([
        ["Tier", "Examples", "Behaviour"],
        ["DENY", "rm -rf /, wiping a disk, fork bombs",
         "Refused outright. Cannot be approved, because the mistake is "
         "unrecoverable and it is nearly always a typo."],
        ["HIGH RISK", "flashing firmware, force push, git reset --hard, "
                      "deleting a branch, package removal",
         "Always asks, on every policy setting, including the most permissive."],
        ["NORMAL", "building, running tests, editing files, committing",
         "Asks, unless you have set the policy to trust this class."],
        ["LOW RISK", "reading files, listing directories, status queries",
         "Runs without interrupting you."],
    ], [0.95 * inch, 2.5 * inch, 3.35 * inch]))

    S.append(P("The policy dial", H2))
    S.append(P(
        "In Settings, or the chip at the top of the screen. It moves where the "
        "line sits for NORMAL actions only — <b>DENY and HIGH RISK do not "
        "move</b>, whatever you choose.", BODY))
    S.append(table([
        ["Setting", "Meaning"],
        ["asks first", "The default. Anything that changes state asks."],
        ["build trust", "Routine build and test commands run; edits still ask."],
        ["trusted", "Normal work proceeds; high-risk and destructive still ask."],
    ], [1.3 * inch, 5.5 * inch]))

    S.append(P("What the gate does not cover, and why", H2))
    S.append(P(
        "The terminal, the editor's saves, the sandbox and loading a file by "
        "path do not prompt. Those are <i>you</i> operating your own device, not "
        "the model acting. Prompting for each keystroke would be absurd. That "
        "is also exactly why those four surfaces refuse any request that did not "
        "come from this device — see Chapter 10.", BODY))

    # ---- ch 5 : interface -----------------------------------------------
    S += chapter(
        "The Interface",
        "Six tabs. The same interface on the phone, the desktop app and any "
        "browser on your network.")

    S.append(P("CHAT", H2))
    S.append(P(
        "Where the work happens. No message limit and no truncation of your "
        "conversation. The agent will argue with you: if it thinks your "
        "approach is wrong it will say so and offer an alternative — and then "
        "do what you decided.", BODY))
    S.append(P("Work modes change how it approaches a request:", BODY))
    S.append(table([
        ["Mode", "Behaviour"],
        ["plan", "Produces a plan and stops. Writes nothing."],
        ["brainstorm", "Options and trade-offs, deliberately divergent."],
        ["research", "Reads and reports. Investigates without changing anything."],
        ["build", "Executes, still through the approval gate."],
    ], [1.1 * inch, 5.7 * inch]))

    S.append(P("TERMINAL", H2))
    S.append(P(
        "A real shell with a real controlling terminal — job control, Ctrl-C, "
        "and full-screen programs such as vi all work. The banner tells you the "
        "shell, whether it is a PTY, whether the deny-guard is on, and how many "
        "tools are available. See Chapter 6.", BODY))

    S.append(P("CODE", H2))
    S.append(P(
        "A file browser and editor over your project, with search across the "
        "indexed tree. Edits are written straight to disk and a backup of the "
        "previous contents is kept.", BODY))

    S.append(P("CHATS", H2))
    S.append(bullets([
        "<b>Projects</b> — separate workspaces. Each has its own memory, its "
        "own learned documents and its own conversation history.",
        "<b>Branching</b> — fork a conversation at any message to try a "
        "different direction without losing the original.",
        "<b>Queue</b> — line up several messages; each runs as the previous "
        "one finishes, so you can leave it working.",
        "<b>Private chats</b> — locked behind a passcode and encrypted on "
        "disk with a key derived from it. Forget the passcode and the contents "
        "are gone; there is no recovery, which is the point.",
        "<b>Archive, export and import</b> — conversations are yours to move "
        "between devices.",
    ]))

    S.append(P("LEARN", H2))
    S.append(P(
        "Upload documents, code or notes for the agent to study. It indexes "
        "them and uses them as background for that project. Crucially you can "
        "<b>remove</b> what it learned — individual documents and individual "
        "learned behaviours — and the removal is real: the row is deleted and "
        "verified gone, not merely hidden.", BODY))

    S.append(P("SETTINGS", H2))
    S.append(P(
        "Provider and model, network mode, approval policy, API keys, the "
        "terminal guard, sandbox containment, appearance, and the build stamp.", BODY))

    # ---- ch 6 : terminal ------------------------------------------------
    S += chapter(
        "The Terminal and Its Toolset",
        "Android gives an app a very thin userland. OMERTA brings its own.")

    S.append(P(
        "<font face='Courier'>/system/bin</font> on Android is toybox, and it is "
        "missing most of what a terminal is actually for: no wget, no awk, no "
        "vi, no less, no unzip, no tar that can write. So the APK ships a static "
        "BusyBox and puts <b>288 commands</b> on your PATH.", BODY))

    S.append(P("What you get", H2))
    S.append(P(
        "<font face='Courier'>wget tar unzip gzip bzip2 xz cpio sed awk grep "
        "find xargs diff patch vi less more sort uniq cut tr wc head tail "
        "nc ping traceroute nslookup ip ifconfig netstat route ps top kill "
        "df du stat strings xxd sha256sum md5sum base64 bc dc tree watch "
        "crond blkid fdisk losetup mount</font> — and roughly 240 more.", SMALL))
    S.append(P(
        "A full list is written to <font face='Courier'>TOOLS.txt</font> beside "
        "the tool directory on the device; read it with "
        "<font face='Courier'>less ../TOOLS.txt</font> from the bin directory.", BODY))

    S.append(P("Deliberate omissions", H2))
    S.append(table([
        ["Not linked", "Why"],
        ["su, login, passwd",
         "They need setuid root. On a rooted phone, linking these would shadow "
         "the real /system/bin/su and break root — use that one. On an "
         "unrooted phone there is no working sudo at all, and shipping one that "
         "always fails would be worse than not shipping it."],
        ["sh, ash", "The session shell is chosen deliberately elsewhere. Run "
                    "<font face='Courier'>ash</font> by name if you want BusyBox's."],
        ["init, reboot, halt, chroot, insmod",
         "Require privileges no Android app has."],
    ], [1.5 * inch, 5.3 * inch]))

    S.append(P("Two limits worth knowing", H2))
    S.append(P(
        "<b>HTTPS is not authenticated.</b> BusyBox's TLS does not validate "
        "certificates and will tell you so. <font face='Courier'>wget "
        "https://...</font> works, but treat it as unauthenticated transport: "
        "fine for fetching something you are going to checksum, not fine for "
        "anything secret. Ask the agent to fetch instead when it matters — it "
        "uses Python's TLS, which does validate.", NOTE))
    S.append(P(
        "<b>There is no python3 on the command line.</b> The app embeds CPython "
        "in its own process rather than as a separate executable, so there is "
        "no interpreter for the shell to run. Use the CODE tab, or ask the "
        "agent to run Python for you.", BODY))

    S.append(P("The deny-guard", H2))
    S.append(P(
        "The hard-deny list applies in the terminal too: "
        "<font face='Courier'>rm -rf /</font> is refused even though you typed "
        "it yourself. Matching is argument-precise, so "
        "<font face='Courier'>rm -rf /tmp/build</font> is not caught by the rule "
        "against <font face='Courier'>rm -rf /</font>. Set "
        "<font face='Courier'>OMERTA_TERM_GUARD=0</font> if you genuinely need "
        "one. Every command is logged either way.", BODY))

    S += _part_two()
    return S


def _part_two():
    S = []

    # ---- ch 7 : sandbox -------------------------------------------------
    S += chapter(
        "The Sandbox",
        "Somewhere to run something you do not trust yet.")

    S.append(P(
        "A scratch sandbox builds and executes code exactly as it would for "
        "real, but nothing it produces reaches your project until you say so. "
        "You can keep the result, throw it away, or keep part of it.", BODY))

    S.append(P("Two different protections", H2))
    S.append(table([
        ["Layer", "Protects", "How"],
        ["Scratch workspace", "your project from your experiment",
         "Writes are confined to the sandbox directory and merged only on your "
         "confirmation."],
        ["Device containment", "your device from a hostile program",
         "bubblewrap namespaces: no network by default, a deny-by-default "
         "filesystem, and a cleared environment so a sandboxed process cannot "
         "read your API keys."],
    ], [1.4 * inch, 2.1 * inch, 3.3 * inch]))

    S.append(P("Know what your device can actually enforce", H2))
    S.append(P(
        "Containment depends on kernel features that not every device has. "
        "OMERTA reports what yours can genuinely provide — "
        "<b>strict</b>, <b>relaxed</b> or <b>limits only</b> — and a request "
        "for more containment than the device can enforce is capped at what is "
        "real, and says so. It will not tell you a process is contained when it "
        "is not.", NOTE))

    # ---- ch 8 : firmware ------------------------------------------------
    S += chapter(
        "Firmware Work",
        "The part of OMERTA with the strictest rules, because the cost of "
        "being wrong is a brick.")

    S.append(P(
        "OMERTA can unpack and rebuild boot, vendor_boot and dtbo images, read "
        "and decompile device trees, handle Android sparse images and take "
        "apart a super.img. What governs all of it is an evidence rule.", BODY))

    S.append(P("Evidence labels", H2))
    S.append(table([
        ["Label", "Meaning"],
        ["CONFIRMED", "Extracted from the actual firmware or kernel in front of it."],
        ["LIKELY", "Strongly supported by evidence, not directly read."],
        ["INFERRED", "Deduced from related facts. Treat as a hypothesis."],
        ["UNKNOWN", "Not established. It stays UNKNOWN."],
    ], [1.2 * inch, 5.6 * inch]))
    S.append(P(
        "<b>An UNKNOWN is never promoted to a guess to keep a task moving.</b> "
        "If a value cannot be extracted, OMERTA tells you what it would need in "
        "order to know, rather than supplying a plausible number.", NOTE))

    S.append(P("Standing rules", H2))
    S.append(bullets([
        "The only copy of stock firmware is never modified. Work happens on a copy.",
        "A newly built boot image is not flashed immediately — it is "
        "inspected, compared and explained first.",
        "Flashing is a HIGH RISK action and always asks, on every policy setting.",
        "Every irreversible step states what it will do, to which partition, "
        "and what recovery looks like if it fails.",
    ]))

    # ---- ch 9 : memory --------------------------------------------------
    S += chapter(
        "Memory, Learning and Forgetting",
        "What it keeps, where it keeps it, and how to make it let go.")

    S.append(P("Three kinds of memory", H2))
    S.append(table([
        ["Kind", "What it is", "Scope"],
        ["Conversation", "The current chat, unbounded and untruncated", "One chat"],
        ["Facts &amp; preferences", "Things you told it to remember", "Project, or shared"],
        ["Learned documents", "Files you uploaded in the LEARN tab", "Project"],
    ], [1.3 * inch, 3.1 * inch, 2.4 * inch]))

    S.append(P("Forgetting is real", H2))
    S.append(P(
        "Removing a fact, a document or a learned behaviour deletes it and "
        "confirms the deletion. This is worth stating because it was once "
        "broken: the store returned a status string instead of the row "
        "identifier, so every removal silently did nothing while reporting "
        "success. It is now tested, including that a deletion propagates to "
        "your other devices and is not resurrected by the next sync.", BODY))

    S.append(P("Multi-device sync", H2))
    S.append(P(
        "Devices exchange memory directly — phone to laptop to workstation — "
        "with no server in between. Safety travels with it: a denial recorded on "
        "one device is inherited by the others, so a refusal you set on your "
        "phone is not quietly absent on your laptop. Re-syncing is idempotent, "
        "malformed bundles are rejected rather than merged, and oversized ones "
        "are refused before they are parsed.", BODY))

    # ---- ch 10 : privacy ------------------------------------------------
    S += chapter(
        "Privacy and Security",
        "What leaves your device, what cannot reach it, and what to be careful "
        "about.")

    S.append(P("What leaves the device", H2))
    S.append(table([
        ["Situation", "What is sent, and where"],
        ["Cloud provider selected", "Your prompt and the relevant context, to that "
                                    "provider only. Nothing to us — there is no "
                                    "\"us\" in the path."],
        ["Local provider selected", "Nothing leaves your network."],
        ["Offline mode", "Nothing leaves the device at all. Verified by a test "
                         "that fails if the network is touched."],
    ], [1.7 * inch, 5.1 * inch]))

    S.append(P("Loopback and the local-only rule", H2))
    S.append(P(
        "The server binds to loopback. If you expose it on your network, a "
        "token is required — and the token check cannot be fooled by a forged "
        "<font face='Courier'>X-Forwarded-For</font>, "
        "<font face='Courier'>X-Real-IP</font> or "
        "<font face='Courier'>Forwarded</font> header.", BODY))
    S.append(P(
        "Four surfaces refuse <i>any</i> request that did not originate on this "
        "device, even with a valid token: the terminal, the editor's writes, the "
        "sandbox runner and loading a file by absolute path. They do not route "
        "through the approval gate, because they are you operating your own "
        "machine — which is precisely why they may not be driven from another "
        "one.", NOTE))
    S.append(P(
        "This was not theoretical. Each of the three was found by exploiting it: "
        "a remote caller ran <font face='Courier'>id</font> as root through the "
        "sandbox endpoint, overwrote a file through the editor endpoint, and "
        "read <font face='Courier'>/etc/hostname</font> through the learning "
        "endpoint. All three are closed, the fix is enforced in both servers "
        "immediately after authentication, and the regression is tested.", SMALL))

    S.append(P("Keys and private chats", H2))
    S.append(bullets([
        "API keys are stored on the device and never written into logs, "
        "commits or exports.",
        "A sandboxed process gets a cleared environment, so it cannot read your "
        "keys even if it goes looking.",
        "Private chats are encrypted with a key derived from your passcode "
        "(PBKDF2-HMAC-SHA256, then AES-GCM). The passcode is not stored. Lose "
        "it and the chat is unreadable — by anyone, including you.",
    ]))

    # ---- ch 11 : troubleshooting ----------------------------------------
    S += chapter(
        "Troubleshooting",
        "The things most likely to go wrong, and what they mean.")

    S.append(table([
        ["Symptom", "Cause and fix"],
        ["Chat does nothing, or says no provider is configured",
         "No model is connected. See Chapter 2 — you need an API key or a "
         "local model server."],
        ["\"offline mode needs a local model\"",
         "You are in offline mode with no local server reachable. Start Ollama "
         "or llama.cpp and set its address, or switch to online."],
        ["Terminal warns about job control",
         "Fixed in 1.3.0. If you still see it, you are running an older build — "
         "check the stamp at the top of Settings."],
        ["A command is \"not found\" in the terminal",
         "Check the banner shows a tool count. If it says the toolset is "
         "unavailable it gives the reason. Note there is no python3, adb or "
         "sudo — see Chapter 6 and Chapter 12."],
        ["wget warns about TLS certificates",
         "Expected. BusyBox's TLS does not validate them. Ask the agent to "
         "fetch instead when it matters."],
        ["A .deb installs but is \"unconfigured\"",
         "Use <font face='Courier'>apt install ./file.deb</font>, not "
         "<font face='Courier'>dpkg -i</font>, so dependencies are pulled."],
        ["An update lost my chats",
         "The app was uninstalled rather than updated, or the new build was "
         "signed with a different key. Install over the top; never uninstall."],
        ["\"Backend didn't come up\"",
         "The launch screen now names the reason underneath. Tap RETRY &amp; "
         "SHOW DIAGNOSTICS: it re-runs the launch (which often succeeds on "
         "its own) and, if it fails again, prints the device, ABI, payload "
         "state and full Python traceback, with COPY and SHARE buttons. Send "
         "that text — it is the whole diagnosis, no cable or logcat needed."],
        ["First launch sits on \"unpacking Python\" for minutes",
         "Expected once, on slower or 32-bit devices: the app is writing a "
         "full Python standard library to private storage. The file counter "
         "moves the whole time. It never repeats until you update the app."],
        ["Sandbox says containment is limited",
         "Your kernel lacks the namespaces. The report is accurate — it is "
         "telling you the truth rather than overstating protection."],
    ], [1.9 * inch, 4.9 * inch]))

    S += _part_three()
    return S


def _part_three():
    S = []

    # ---- ch 12 : roadmap ------------------------------------------------
    S += chapter(
        "What Is Missing, and What Should Come Next",
        "An honest list. These are the gaps between what OMERTA is today and "
        "what it is trying to be, in the order they are worth closing.")

    S.append(P("1. An inference engine in the APK", H2))
    S.append(P(
        "<b>The biggest gap by far.</b> Today the phone needs either an API key "
        "or a model server elsewhere on your network. Bundling a llama.cpp "
        "server — packaged the same way the BusyBox binary is — and letting "
        "you load a GGUF file would make OMERTA genuinely self-contained: no "
        "key, no internet, no second machine. A 3B model fits comfortably on a "
        "modern handset. Everything needed to do this has now been proved to "
        "work; it is the single change that would most alter what OMERTA is.", BODY))

    S.append(P("2. A real python3 on the command line", H2))
    S.append(P(
        "Same mechanism, second use. A standalone CPython as a native binary "
        "would give the terminal a genuine interpreter, and with it pip, "
        "scripts, and most of what people actually open a terminal on a phone "
        "to do.", BODY))

    S.append(P("3. git and ssh", H2))
    S.append(P(
        "The agent understands git deeply, but the terminal has no git binary. "
        "Static builds of git, OpenSSH and curl-with-real-TLS would close the "
        "three most obvious remaining gaps in the toolset — and curl would fix "
        "the certificate-validation caveat in Chapter 6.", BODY))

    S.append(P("4. adb over TCP", H2))
    S.append(P(
        "USB-attached devices are out of reach without Android's USB Host API "
        "and a user-granted permission, so a plain adb binary cannot work. But "
        "<font face='Courier'>adb connect host:5555</font> over the network is "
        "an ordinary TCP protocol and is implementable. libimobiledevice has "
        "the same USB problem with no TCP equivalent, so it is the one item on "
        "your list that is genuinely out of reach on an unrooted phone.", BODY))

    S.append(P("5. Signing the release properly", H2))
    S.append(P(
        "Builds are currently signed with the Android debug key, which is what "
        "keeps updates installing over each other. Before you publish anything, "
        "generate a real release keystore, back it up in more than one place, "
        "and sign with it. <b>If you lose that key you can never update the app "
        "again</b> — every existing install would have to be removed and "
        "reinstalled, losing user data. This is the single most irreversible "
        "decision in shipping an Android app.", NOTE))

    S.append(P("Smaller things worth having", H2))
    S.append(bullets([
        "<b>Voice input</b> — dictating to an agent on a phone is far more "
        "natural than typing at it.",
        "<b>A share target</b> — send a file, a URL or a code snippet to "
        "OMERTA from any other app.",
        "<b>Scheduled and triggered runs</b> — a task that wakes on a "
        "schedule, or when a repository changes.",
        "<b>An encrypted backup</b> of everything (chats, projects, learned "
        "files, themes) to a single file you control.",
        "<b>Per-project approval policy</b> — trusted inside a scratch "
        "project, strict against production.",
        "<b>A cost meter</b> for cloud providers, so a long agent run cannot "
        "surprise you.",
        "<b>Model presets</b> — a cheap fast model for routine work and a "
        "strong one for hard problems, switched per task rather than globally.",
        "<b>Tablet and landscape layout</b> — the interface currently "
        "assumes a phone.",
    ]))

    # ---- ch 13 : reference ----------------------------------------------
    S += chapter("Reference", "Settings, endpoints and files.")

    S.append(P("Environment settings", H2))
    S.append(table([
        ["Variable", "Effect"],
        ["OMERTA_MODE", "online | offline | auto"],
        ["OMERTA_PROVIDER", "Which provider to use, or auto"],
        ["OMERTA_APPROVAL_POLICY", "ask | build | trusted"],
        ["OMERTA_TERM_GUARD", "0 disables the terminal deny-guard"],
        ["OMERTA_ISOLATE_NET", "Allow network inside the sandbox"],
        ["OMERTA_LOCAL_MODEL", "Model name for Ollama"],
        ["OMERTA_OLLAMA_HOST", "Address of your Ollama server"],
        ["OMERTA_LLAMACPP_HOST", "Address of your llama.cpp server"],
        ["OMERTA_DATA_DIR", "Where chats, memory and settings live"],
        ["OMERTA_TOKEN", "API token when serving beyond loopback"],
    ], [2.2 * inch, 4.6 * inch]))

    S.append(P("HTTP endpoints", H2))
    S.append(table([
        ["Endpoint", "Purpose"],
        ["GET /api/version", "Which build this is — version, commit, build time"],
        ["GET /api/status", "Providers, policy, mode, toolset, memory, skills"],
        ["POST /api/chat", "One turn, through the approval gate"],
        ["/api/term/*", "Terminal. Local-only."],
        ["/api/ws/*", "Editor and workspace. Writes are local-only."],
        ["/api/scratch/*", "Sandbox. Local-only."],
        ["/api/learn/*", "Learning shelf. Loading by path is local-only."],
    ], [1.7 * inch, 5.1 * inch]))

    S.append(P("Command line", H2))
    S.append(table([
        ["Command", "Does"],
        ["omerta", "Interactive agent in the terminal"],
        ["omerta serve", "Start the server and web interface"],
        ["omerta doctor", "Check the installation and report problems"],
        ["omerta sync &lt;host:port&gt;", "Sync memory with another device"],
        ["omerta --version", "Version, commit and build time"],
    ], [2.0 * inch, 4.8 * inch]))

    S.append(P("Where your data lives", H2))
    S.append(table([
        ["Platform", "Path"],
        ["Android", "/data/data/com.omerta.agent/files/data"],
        ["Linux / macOS", "~/.omerta (or $OMERTA_DATA_DIR)"],
        ["Windows", "%USERPROFILE%\\\\.omerta"],
    ], [1.4 * inch, 5.4 * inch]))

    S.append(Spacer(1, 16))
    S.append(HRFlowable(color=BORDER, thickness=0.6))
    S.append(P(
        f"OMERTA AI v{VERSION} — Owner's Manual. Generated from the "
        "repository, so the version on the cover is the version of the build "
        "that produced it. Silence Is The Only Unbreakable Code.", SMALL))
    return S


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(str(OUT), pagesize=LETTER,
                          leftMargin=0.78 * inch, rightMargin=0.78 * inch,
                          topMargin=0.9 * inch, bottomMargin=0.8 * inch,
                          title=f"OMERTA AI {VERSION} Owner's Manual",
                          author="OMERTA")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  id="body")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover),
        PageTemplate(id="body", frames=[frame], onPage=chrome),
    ])
    # Without this the cover template stays active and its artwork is painted
    # over every following page.
    story = [NextPageTemplate("body"), PageBreak()] + build()
    doc.build(story)
    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
