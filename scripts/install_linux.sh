#!/usr/bin/env bash
# OMERTA AGENT — Linux / Kali installer
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[*] OMERTA AGENT — Linux install"

if command -v apt >/dev/null; then
  sudo apt update
  sudo apt install -y python3 python3-pip python3-venv git curl build-essential
elif command -v dnf >/dev/null; then
  sudo dnf install -y python3 python3-pip git curl gcc gcc-c++ make
elif command -v pacman >/dev/null; then
  sudo pacman -Sy --noconfirm python python-pip git curl base-devel
fi

python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "[*] Installing Ollama for offline inference (optional but recommended)..."
if ! command -v ollama >/dev/null; then
  read -rp "    Install Ollama now? [y/N] " a
  [[ "$a" == "y" ]] && curl -fsSL https://ollama.com/install.sh | sh
fi
if command -v ollama >/dev/null; then
  echo "[*] Pulling offline coding model (this is a few GB, one time)..."
  ollama pull qwen2.5-coder:7b || echo "    (skipped — run 'ollama pull qwen2.5-coder:7b' later)"
fi

# desktop launcher
DESKTOP="$HOME/.local/share/applications/omerta-agent.desktop"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=OMERTA AGENT
Comment=Offline-capable coding & firmware agent
Exec=$(pwd)/.venv/bin/python $(pwd)/server.py
Icon=$(pwd)/assets/icon_512.png
Terminal=false
Categories=Development;
DESK
echo "[*] Desktop entry: $DESKTOP"
echo
echo "[*] Done."
echo "    CLI : .venv/bin/python cli.py"
echo "    Web : .venv/bin/python server.py   -> http://localhost:8787"
echo "    Key : export ANTHROPIC_API_KEY=sk-ant-...   (optional, for the online brain)"
