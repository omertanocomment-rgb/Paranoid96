#!/data/data/com.termux/files/usr/bin/bash
# OMERTA - Start web server (works on Termux and Linux)
cd "$(dirname "$0")/.."
PORT=${OMERTA_PORT:-3000}

# Build renderer if not already built
if [ ! -f "out/renderer/index.html" ]; then
  echo "  [..] Building renderer (first run)..."
  npm run build 2>&1 | tail -5
fi

# Patch renderer to inject web bridge
echo "  [..] Patching renderer for web mode..."
node termux/patch-renderer.js

echo ""
echo "  =================================="
echo "   OMERTA - Web Server"
echo "  =================================="
echo "  Open in browser:"
echo "    http://localhost:$PORT"
echo ""
echo "  On Android (same device):"
echo "    http://127.0.0.1:$PORT"
echo ""
echo "  On another device (same WiFi):"
echo "    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '<your-ip>'):$PORT"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

OMERTA_PORT=$PORT OMERTA_TERMUX=1 node termux/server.js
