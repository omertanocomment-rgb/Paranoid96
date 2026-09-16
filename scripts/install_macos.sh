#!/usr/bin/env bash
# OMERTA AGENT — macOS installer
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[*] OMERTA AGENT — macOS install"

if ! command -v brew >/dev/null; then
  echo "[!] Homebrew not found. Install it from https://brew.sh then re-run."
  exit 1
fi
brew install python git || true

python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if ! command -v ollama >/dev/null; then
  read -rp "    Install Ollama for offline inference? [y/N] " a
  [[ "$a" == "y" ]] && brew install --cask ollama
fi
command -v ollama >/dev/null && ollama pull qwen2.5-coder:7b || true

echo
echo "[*] Done."
echo "    CLI : .venv/bin/python cli.py"
echo "    Web : .venv/bin/python server.py   -> http://localhost:8787"
echo "    App : cd desktop && npm install && npm run dist:mac"
