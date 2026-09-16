# Prebuilt Omerta AI artifacts

| File | Platform | Notes |
|------|----------|-------|
| `OmertaAI-release.apk` | Android | Signed console. Install, add API key in Settings. |
| `omerta-ai_1.0.0_amd64.deb` | Debian/Ubuntu/Mint | Engine. `sudo dpkg -i omerta-ai_1.0.0_amd64.deb` → `omerta doctor`. |
| `OmertaAI-1.0.0-x86_64.AppImage` | Linux (portable) | Engine. `chmod +x *.AppImage && ./OmertaAI-1.0.0-x86_64.AppImage doctor`. |

Windows `.exe` and iOS `.ipa` are produced by CI (Actions → *Build OMERTA AI Engine* /
*Build Omerta AI IPA*) — see the repo README.

Engine usage: set `ANTHROPIC_API_KEY`, then `omerta chat`, `omerta agent "task"`,
`omerta web`. Full command list in `engine/README.md`.
