"""
OMERTA AGENT — central configuration.
Runtime-overridable via data/settings.json (written by the /set command
and the web UI settings panel), then environment variables, then defaults.
"""
import os
import sys
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _default_data_dir() -> Path:
    """Where memory, tokens and backups live.

    Running from a git checkout: ./data, so everything stays together and
    you can wipe it by deleting the folder.

    Installed via pip: a per-user directory instead — writing into
    site-packages would mean `pip install -U` silently destroys your
    memory, tokens and learned preferences.
    """
    env = os.environ.get("OMERTA_DATA_DIR")
    if env:
        return Path(env).expanduser()
    # A PyInstaller bundle unpacks to a temp dir that is DELETED on exit —
    # writing memory there loses everything every run. Always use a real
    # user directory when frozen.
    frozen = getattr(sys, "frozen", False) or os.environ.get("OMERTA_BUNDLED")
    installed = ("site-packages" in str(ROOT) or "dist-packages" in str(ROOT)
                 or "_MEI" in str(ROOT))
    if not frozen and not installed:
        return ROOT / "data"                      # running from source
    if os.name == "nt":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
        return Path(base) / "OmertaAgent"
    if os.sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "OmertaAgent"
    xdg = os.environ.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else Path.home() / ".local" / "share") / "omerta-agent"


DATA_DIR = _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
MEMORY_DB = DATA_DIR / "memory.sqlite3"
SETTINGS_FILE = DATA_DIR / "settings.json"
MODEL_DIR = ROOT / "models"
PERSONA_FILE = ROOT / "persona.yaml"
SKILLS_DIR = Path(os.environ.get("OMERTA_SKILLS_DIR", ROOT / "skills"))
PLUGINS_DIR = Path(os.environ.get("OMERTA_PLUGINS_DIR", ROOT / "plugins"))
# an installed copy keeps its bundled connectors.yaml read-only; the user's
# editable copy lives beside their data so upgrades never clobber it.
_user_conn = DATA_DIR / "connectors.yaml"
CONNECTORS_FILE = _user_conn if _user_conn.exists() else ROOT / "connectors.yaml"
USER_SKILLS_DIR = DATA_DIR / "skills"
USER_PLUGINS_DIR = DATA_DIR / "plugins"
ASSETS_DIR = ROOT / "assets"

_runtime = {}
if SETTINGS_FILE.exists():
    try:
        _runtime = json.loads(SETTINGS_FILE.read_text())
    except json.JSONDecodeError:
        _runtime = {}


def get(key, default=None):
    """settings.json  >  env  >  default"""
    if key in _runtime:
        return _runtime[key]
    return os.environ.get(key, default)


def set_setting(key, value):
    _runtime[key] = value
    SETTINGS_FILE.write_text(json.dumps(_runtime, indent=2))


def all_settings():
    return dict(_runtime)


# ── Safety ───────────────────────────────────────────────────────────────
# You asked for always-ask. This is the master switch and it defaults ON:
# EVERY command, file write, and plugin side effect is proposed to you and
# waits for an explicit yes. Nothing executes on its own.
ALWAYS_ASK = bool(get("OMERTA_ALWAYS_ASK", True)) and \
    str(get("OMERTA_ALWAYS_ASK", "true")).lower() not in ("0", "false", "no")

# Even with ALWAYS_ASK off, these never auto-run.
DENY_PATTERNS = [
    "rm -rf /", "rm -rf /*", "mkfs.ext4 /dev/sda", ":(){:|:&};:",
    "dd if=/dev/zero of=/dev/sd", "fastboot flashall -w",
    "> /dev/sda", "chmod -R 777 /",
]
# Commands considered destructive — flagged with a loud warning in the
# confirmation prompt even though everything is confirmed anyway.
HIGH_RISK_PREFIXES = [
    "fastboot flash", "fastboot erase", "fastboot format", "fastboot -w",
    "dd if=", "mkfs", "parted", "fdisk", "rm -rf", "rm -r",
    "git push --force", "git reset --hard", "git clean -fd",
    "adb sideload", "chmod -R", "chown -R", "systemctl", "shutdown", "reboot",
]
# Read-only commands: still confirmed under ALWAYS_ASK, but shown as low-risk
# and offered as "approve + remember this pattern" candidates.
LOW_RISK_PREFIXES = [
    "git status", "git log", "git diff", "git branch", "git show",
    "ls", "cat", "pwd", "find", "grep", "rg", "file", "du", "df", "which",
    "adb devices", "adb shell getprop", "readelf", "nm", "objdump",
    "python --version", "node --version", "uname",
]

COMMAND_TIMEOUT = int(get("OMERTA_CMD_TIMEOUT", 180))

# ── Model providers ──────────────────────────────────────────────────────
# Any of these can be the active brain. Switch at runtime: /model <id>
PROVIDERS = {
    "claude": {
        "kind": "anthropic",
        "label": "Claude (Anthropic API)",
        "model": get("OMERTA_CLAUDE_MODEL", "claude-sonnet-4-6"),
        "api_key_env": "ANTHROPIC_API_KEY",
        "needs_internet": True,
    },
    "claude-opus": {
        "kind": "anthropic",
        "label": "Claude Opus (Anthropic API)",
        "model": get("OMERTA_CLAUDE_OPUS_MODEL", "claude-opus-4-1"),
        "api_key_env": "ANTHROPIC_API_KEY",
        "needs_internet": True,
    },
    "openai": {
        "kind": "openai",
        "label": "OpenAI (GPT / o-series)",
        "model": get("OMERTA_OPENAI_MODEL", "gpt-4o"),
        "base_url": get("OMERTA_OPENAI_BASE", "https://api.openai.com/v1"),
        "api_key_env": "OPENAI_API_KEY",
        "needs_internet": True,
    },
    "openrouter": {
        "kind": "openai",
        "label": "OpenRouter (many models, one key)",
        "model": get("OMERTA_OPENROUTER_MODEL", "anthropic/claude-sonnet-4"),
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "needs_internet": True,
    },
    "groq": {
        "kind": "openai",
        "label": "Groq (fast inference)",
        "model": get("OMERTA_GROQ_MODEL", "llama-3.3-70b-versatile"),
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        "needs_internet": True,
    },
    "gemini": {
        "kind": "openai",
        "label": "Google Gemini",
        "model": get("OMERTA_GEMINI_MODEL", "gemini-2.0-flash"),
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "needs_internet": True,
    },
    "ollama": {
        "kind": "ollama",
        "label": "Ollama (local, offline, unlimited)",
        "model": get("OMERTA_LOCAL_MODEL", "qwen2.5-coder:7b"),
        "base_url": get("OMERTA_OLLAMA_HOST", "http://127.0.0.1:11434"),
        "needs_internet": False,
    },
    "llamacpp": {
        "kind": "llamacpp",
        "label": "llama.cpp server (local, offline, unlimited)",
        "model": "local-gguf",
        "base_url": get("OMERTA_LLAMACPP_HOST", "http://127.0.0.1:8080"),
        "needs_internet": False,
    },
    "lmstudio": {
        "kind": "openai",
        "label": "LM Studio (local, offline)",
        "model": get("OMERTA_LMSTUDIO_MODEL", "local-model"),
        "base_url": get("OMERTA_LMSTUDIO_HOST", "http://127.0.0.1:1234/v1"),
        "api_key_env": None,
        "needs_internet": False,
    },
}

# Preference order when in auto mode. First reachable one wins.
ROUTING_ORDER = get("OMERTA_ROUTING_ORDER",
                    ["claude", "openai", "openrouter", "groq",
                     "ollama", "llamacpp", "lmstudio"])
if isinstance(ROUTING_ORDER, str):
    ROUTING_ORDER = [s.strip() for s in ROUTING_ORDER.split(",")]

ACTIVE_PROVIDER = get("OMERTA_PROVIDER", "auto")   # "auto" or a provider id
OFFLINE_FALLBACK = get("OMERTA_OFFLINE_FALLBACK", "ollama")
CONNECTIVITY_TIMEOUT = 2.5
MAX_TOKENS = int(get("OMERTA_MAX_TOKENS", 4096))

# ── Task persistence ─────────────────────────────────────────────────────
# "Tries its hardest": how many times the executor re-plans after a failure
# before giving up and reporting honestly.
MAX_TOOL_ITERS = int(get("OMERTA_MAX_TOOL_ITERS", 12))
MAX_RETRY_STRATEGIES = int(get("OMERTA_MAX_RETRIES", 4))

# ── Small-model / low-RAM mode ────────────────────────────────────────────
# A 1.5B model on a 4GB phone cannot hold the full system prompt (persona +
# every tool + skill catalog + memory + preferences ~= 1200 tokens) AND a
# useful conversation inside a 2-4k context. COMPACT trims the prompt to the
# essentials: short persona, only the core tools, no skill catalog, fewer
# memories. The approval gate and hard-deny list are NEVER trimmed.
COMPACT = str(get("OMERTA_COMPACT", "0")).lower() in ("1", "true", "yes")
COMPACT_RECALL = int(get("OMERTA_COMPACT_RECALL", 3))

# ── Sync ─────────────────────────────────────────────────────────────────
# Shared folder for file-based sync (Syncthing / Dropbox / Drive / SD card).
SYNC_DIR = get("OMERTA_SYNC_DIR", "")
# Peers to sync with on startup, comma-separated host:port list.
SYNC_PEERS = get("OMERTA_SYNC_PEERS", "")
SYNC_ON_START = str(get("OMERTA_SYNC_ON_START", "0")).lower() in ("1", "true", "yes")

# ── Server ───────────────────────────────────────────────────────────────
SERVER_HOST = get("OMERTA_HOST", "0.0.0.0")
SERVER_PORT = int(get("OMERTA_PORT", 8787))
