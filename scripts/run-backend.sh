#!/usr/bin/env bash
# Start the Omerta AI backend locally.
set -euo pipefail
cd "$(dirname "$0")/../backend"
[ -f .env ] || { echo "Create backend/.env from .env.example first"; exit 1; }
npm install
exec npm start
