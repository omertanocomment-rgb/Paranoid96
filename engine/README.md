# OMERTA AI — Engine

Evidence-backed engineering / coding / firmware agent. Implements the Phases 1–15
specification (see `../docs/OMERTA_AI_SPEC.md` and `OMERTA.md`). Standard-library
core — no third-party runtime dependencies — so it packages small and clean.

## Install (from source)
```bash
cd engine
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
omerta doctor
```

## CLI
```
omerta doctor                     # detect dependencies + provider readiness
omerta chat ["prompt"]            # chat (streams); no prompt = REPL
omerta agent "task" [--role ...]  # architect→developer→reviewer, or a single role
omerta index | search <t> | symbol <n> | inspect
omerta memory list|search|forget  # persistent SQLite memory
omerta teach <key> <value> [--scope --type]
omerta constitution init|show
omerta sandbox                    # sandbox backend + isolation status
omerta git                        # git status
omerta build -- <cmd>             # run a build with evidence capture
omerta test -- [cmd]              # defaults to pytest
omerta debug "<error>" | review
omerta firmware tools|inspect <image>
omerta web [--host --port]        # web UI + API (mobile console backend)
omerta config
```

## Providers
Set `ANTHROPIC_API_KEY` (default provider, model `claude-opus-5`, adaptive thinking,
effort via `output_config.effort`). `OPENAI_API_KEY` and local backends are stubbed in
the router and report unavailable until configured — the engine degrades honestly.

## Packaging
- `.deb`  → `packaging/deb/build-deb.sh`
- AppImage → `packaging/appimage/build-appimage.sh`
- Windows `.exe` / Linux binary → PyInstaller (`packaging/pyinstaller/omerta.spec`), built
  in CI (`.github/workflows/engine-build.yml`).

## Phase status
See `../docs/OMERTA_AI_SPEC.md` §"Implementation status" — features are marked COMPLETE
only where implemented and tested.
