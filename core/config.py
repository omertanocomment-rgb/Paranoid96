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

# RES_DIR is where read-only resources live: persona, connectors, skills,
# plugins, assets and the web UI. Normally that is the package/checkout root.
# But when the code is imported from a virtual filesystem where __file__ has
# no real on-disk parent — most importantly the Android app, where Chaquopy
# serves .py modules from the APK's asset store — ROOT points nowhere useful.
# The host then extracts the payload to a real directory and points us at it
# with OMERTA_HOME. Resource paths hang off RES_DIR; writable state stays in
# DATA_DIR, which is always a real, per-user directory.
_home = os.environ.get("OMERTA_HOME")
RES_DIR = Path(_home).expanduser() if _home else ROOT

MEMORY_DB = DATA_DIR / "memory.sqlite3"
SETTINGS_FILE = DATA_DIR / "settings.json"
MODEL_DIR = RES_DIR / "models"
PERSONA_FILE = RES_DIR / "persona.yaml"
SKILLS_DIR = Path(os.environ.get("OMERTA_SKILLS_DIR", RES_DIR / "skills"))
PLUGINS_DIR = Path(os.environ.get("OMERTA_PLUGINS_DIR", RES_DIR / "plugins"))
# an installed copy keeps its bundled connectors.yaml read-only; the user's
# editable copy lives beside their data so upgrades never clobber it.
_user_conn = DATA_DIR / "connectors.yaml"
CONNECTORS_FILE = _user_conn if _user_conn.exists() else RES_DIR / "connectors.yaml"
USER_SKILLS_DIR = DATA_DIR / "skills"
USER_PLUGINS_DIR = DATA_DIR / "plugins"
ASSETS_DIR = RES_DIR / "assets"
WEBUI_DIR = Path(os.environ.get("OMERTA_WEBUI_DIR", RES_DIR / "webui"))

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


def truthy(value):
    """One reading of 'on'. This test was written out in seven places."""
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def flag(key, default="0"):
    return truthy(get(key, default))


# ── secrets (API keys / local-model hosts) ─────────────────────────────────
# Persisted separately from settings.json, 0600, and loaded into the process
# environment on start so the provider modules (which read os.environ directly)
# pick them up. This is what lets the Android app store an API key with no
# terminal, and it works the same on desktop.
SECRETS_FILE = DATA_DIR / "secrets.json"
# Only these may be written through the secret API — never arbitrary env vars.
ALLOWED_SECRET_KEYS = {
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
    "GROQ_API_KEY", "GEMINI_API_KEY",
    "OMERTA_OPENAI_BASE", "OMERTA_OLLAMA_HOST", "OMERTA_LLAMACPP_HOST",
    "OMERTA_LMSTUDIO_HOST",
}


def _load_secrets():
    if not SECRETS_FILE.exists():
        return
    try:
        data = json.loads(SECRETS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return
    for k, v in data.items():
        # environment set by the launcher wins; persisted secrets fill the gap
        if isinstance(v, str) and v and not os.environ.get(k):
            os.environ[k] = v


def put_secret(key, value):
    """Persist an allowed secret (0600) and apply it to the live process."""
    if key not in ALLOWED_SECRET_KEYS:
        raise ValueError(f"secret '{key}' is not writable")
    data = {}
    if SECRETS_FILE.exists():
        try:
            data = json.loads(SECRETS_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            data = {}
    if value:
        data[key] = value
        os.environ[key] = value
    else:
        data.pop(key, None)
        os.environ.pop(key, None)
    SECRETS_FILE.write_text(json.dumps(data, indent=2))
    try:
        import stat as _stat
        os.chmod(SECRETS_FILE, _stat.S_IRUSR | _stat.S_IWUSR)  # 0600
    except OSError:
        pass
    return True


_load_secrets()

# Whether the network API may set secrets. Off by default: a LAN-exposed
# server must never let a client write API keys. The Android app turns it on
# because it binds to loopback only, and the transport still requires the
# request to originate from loopback.
ALLOW_SECRET_API = str(get("OMERTA_ALLOW_SECRET_API", "0")).lower() in \
    ("1", "true", "yes")


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

# Explicit network mode, independent of which provider is chosen:
#   auto    — online if reachable, otherwise local; switches on its own
#   offline — local models only, never touches the network (true unlimited)
#   online  — cloud providers only
# This is what the UI's OFFLINE / ONLINE / AUTO switch sets.
def _norm_mode(v):
    v = str(v or "auto").lower()
    return v if v in ("auto", "offline", "online") else "auto"


MODE = _norm_mode(get("OMERTA_MODE", "auto"))

# ── Task persistence ─────────────────────────────────────────────────────
# "Tries its hardest": how many times the executor re-plans after a failure
# before giving up and reporting honestly.
MAX_TOOL_ITERS = int(get("OMERTA_MAX_TOOL_ITERS", 12))
MAX_RETRY_STRATEGIES = int(get("OMERTA_MAX_RETRIES", 4))

# Chats are unlimited — there is no cap on how many messages a conversation can
# hold. To keep an endless conversation from eventually overflowing the model's
# context window, only the most recent turns are kept "in context"; everything
# older has already been distilled into long-term memory (see Agent._learn), so
# nothing is lost. 0 disables trimming entirely.
HISTORY_LIMIT = int(get("OMERTA_HISTORY_LIMIT", 60))

# ── Small-model / low-RAM mode ────────────────────────────────────────────
# A 1.5B model on a 4GB phone cannot hold the full system prompt (persona +
# every tool + skill catalog + memory + preferences ~= 1200 tokens) AND a
# useful conversation inside a 2-4k context. COMPACT trims the prompt to the
# essentials: short persona, only the core tools, no skill catalog, fewer
# memories. The approval gate and hard-deny list are NEVER trimmed.
COMPACT = flag("OMERTA_COMPACT")
COMPACT_RECALL = int(get("OMERTA_COMPACT_RECALL", 3))

# ── Sync ─────────────────────────────────────────────────────────────────
# Shared folder for file-based sync (Syncthing / Dropbox / Drive / SD card).
SYNC_DIR = get("OMERTA_SYNC_DIR", "")
# Peers to sync with on startup, comma-separated host:port list.
SYNC_PEERS = get("OMERTA_SYNC_PEERS", "")
SYNC_ON_START = flag("OMERTA_SYNC_ON_START")

# ── Server ───────────────────────────────────────────────────────────────
SERVER_HOST = get("OMERTA_HOST", "0.0.0.0")
SERVER_PORT = int(get("OMERTA_PORT", 8787))
