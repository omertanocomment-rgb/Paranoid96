#!/data/data/com.termux/files/usr/bin/bash
# OMERTA AGENT — Termux (Android) installer
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[*] OMERTA AGENT — Termux install"

pkg update -y
pkg install -y python git clang cmake make wget curl openssh termux-api \
  libffi openssl rust binutils

echo "[*] Python deps..."
pip install --upgrade pip wheel
pip install -r requirements.txt

mkdir -p data models

echo "[*] Building llama.cpp for on-device offline inference..."
if [ ! -d "$HOME/llama.cpp" ]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp "$HOME/llama.cpp"
fi
( cd "$HOME/llama.cpp"
  cmake -B build -DGGML_NATIVE=ON -DLLAMA_CURL=OFF
  cmake --build build --config Release -j"$(nproc)" ) || \
  echo "[!] llama.cpp build failed — you can still use the API brains."

cat > omerta <<'LAUNCH'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
exec python cli.py "$@"
LAUNCH
chmod +x omerta

cat > omerta-web <<'LAUNCH'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
termux-wake-lock 2>/dev/null || true
echo "OMERTA AGENT -> http://$(ip route get 1 2>/dev/null | awk '{print $7;exit}'):8787"
exec python server.py
LAUNCH
chmod +x omerta-web

echo
echo "[*] Offline brain — download a coding model once, works forever offline:"
echo "    7B (needs ~6GB RAM):"
echo "    curl -L -o models/coder.gguf \\"
echo "      https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
echo "    1.5B (low-RAM devices):"
echo "    curl -L -o models/coder.gguf \\"
echo "      https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"
echo
echo "    Then serve it:"
echo "    ~/llama.cpp/build/bin/llama-server -m models/coder.gguf -c 8192 --port 8080 &"
echo
echo "[*] Online brain (optional):"
echo "    echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc && source ~/.bashrc"
echo
echo "[*] Done."
echo "    CLI : ./omerta"
echo "    Web : ./omerta-web   (reach it from any device on your wifi)"
echo "    Check setup: python -m scripts.doctor"
