# Prebuilt Omerta AI artifacts

| File | Platform | Notes |
|------|----------|-------|
| `OmertaPersonalAI-1.15.0.apk` | Android | **Omerta Personal AI** v1.15.0 + **offline brain**. Install → tap "go fully OFFLINE" (no key needed), or add an API key for Claude. |
| `brains/*.brain` | Android app | Ready-made brains (omerta · luna · sensei). Open on the phone, or Brain → IMPORT / UPLOAD. |
| `omerta-ai_1.0.0_amd64.deb` | Debian/Ubuntu/Mint | Engine. `sudo dpkg -i omerta-ai_1.0.0_amd64.deb` → `omerta doctor`. |
| `omerta-ai-desktop_1.1.0_all.deb` | **Linux Mint / Ubuntu / Debian** | **Native desktop app — the offline brain.** `sudo apt install ./omerta-ai-desktop_1.1.0_all.deb` then launch **Omerta AI** from the menu (or run `omerta-ai`). No server, no web, no key. |
| `OmertaAI-1.0.0-x86_64.AppImage` | Linux (portable) | Engine. `chmod +x *.AppImage && ./OmertaAI-1.0.0-x86_64.AppImage doctor`. |

Windows `.exe` and iOS `.ipa` are produced by CI (Actions → *Build OMERTA AI Engine* /
*Build Omerta AI IPA*) — see the repo README.

Engine usage: set `ANTHROPIC_API_KEY`, then `omerta chat`, `omerta agent "task"`,
`omerta web`. Full command list in `engine/README.md`.
