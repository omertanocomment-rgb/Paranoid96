#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
pip install -e ".[dev]"
echo "Installed. Run: source engine/.venv/bin/activate && omerta doctor"
