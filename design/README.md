# OMERTA Design System

The single source of truth for how every Omerta app looks. **All themes derive from
[`omerta-design.json`](omerta-design.json)** — colors, logo, JetBrains Mono typography,
radii and spacing. This is a hard rule for every project in this repo: build to a
publishable, signed standard with a polished, well-laid-out UI, themed from this file.

## The look
Dark operator console. Near-black canvas, layered surfaces, a single **amber** accent
(`#FFB300`), and **JetBrains Mono** for *all* type. Calm, precise, discreet.

## Tokens
| Token | Hex | Use |
|---|---|---|
| `black` | `#0A0A0B` | app background |
| `surface` | `#141416` | cards, inputs, bars |
| `surfaceHigh` | `#1E1E22` | raised/hover surfaces |
| `border` | `#2A2A2E` | hairline borders |
| `amber` | `#FFB300` | **the** accent: primary actions, highlights, logo |
| `amberDim` | `#8A6100` | disabled/secondary amber |
| `green` | `#00E676` | online / success |
| `red` | `#FF5252` | error / high-risk |
| `textPrimary` | `#ECECEC` | body text |
| `textSecondary` | `#9A9AA0` | hints, captions |
| `userBubble` | `#1F2A1A` | the operator's chat bubble |
| `assistantBubble` | `#16161A` | the assistant's chat bubble |

Type: **JetBrains Mono** (400/500/600/700), fallback `monospace`.
Radius: sm 8 · md 10 · lg 14 · pill 999. Spacing: 4 / 8 / 12 / 16 / 24. Side gutter: 16.

## Generate / enforce
```bash
python3 design/gen_themes.py          # → design/generated/{omerta.css,palette.py,OmertaTokens.kt,omerta.env}
python3 design/gen_themes.py --check  # verify every target (Android Color.kt, desktop palette,
                                      # generated files) matches the tokens — fails CI on drift
```
Consume the generated files:
- **Web / landing pages** → `design/generated/omerta.css` (`var(--omerta-amber)` …).
- **Python tools / desktop** → `design/generated/palette.py`.
- **Kotlin** → `design/generated/OmertaTokens.kt` (reference; the live Android palette is
  `android/.../ui/theme/Color.kt`, kept in parity by `--check`).
- **Scripts / native builds** → `design/generated/omerta.env`.

Preview the palette: open [`preview.html`](preview.html).

## Every new app inherits this
1. Theme from these tokens (never hardcode a new palette — add tokens here instead).
2. JetBrains Mono throughout; amber as the only accent.
3. Polished layout: 16px gutters, consistent radii/spacing, works at phone width, dark by default.
4. Ship it built to a **publishable, signed** artifact (see [`../scripts/sign/`](../scripts/sign)) and
   the release checklist in [`../CLAUDE.md`](../CLAUDE.md).
