# Brains

## Switching

```
/model auto        # best available, auto-falls back when signal drops
/model ollama      # pin local
/model claude      # pin Claude
/models            # what's configured and reachable
```
Or the dropdown in the web UI. Persisted to `data/settings.json`.

## Configured providers

| id | kind | offline | notes |
|---|---|---|---|
| `claude` / `claude-opus` | Anthropic | no | strongest on obscure toolchain errors |
| `openai` | OpenAI | no | |
| `openrouter` | OpenAI-compat | no | many models, one key |
| `groq` | OpenAI-compat | no | very fast |
| `gemini` | OpenAI-compat | no | |
| `ollama` | Ollama | **yes** | easiest local setup |
| `llamacpp` | llama.cpp server | **yes** | most control, best on low RAM |
| `lmstudio` | OpenAI-compat | **yes** | GUI model manager |

Keys come from env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `GEMINI_API_KEY`.

## Auto routing

In `auto`, it walks `ROUTING_ORDER`, skipping anything needing internet when
you're offline, and falls through on *any* failure — timeout, rate limit, dead
key. Losing signal mid-task doesn't stop the agent; it finishes locally.

## Offline model picks

| RAM | model | why |
|---|---|---|
| 4GB phone | `qwen2.5-coder:1.5b` | fits, usable for edits/explanations |
| 8GB phone | `qwen2.5-coder:7b` | best balance — the default |
| 16GB+ desktop | `qwen2.5-coder:14b` or `deepseek-coder-v2:16b` | near-cloud on routine code |

```bash
ollama pull qwen2.5-coder:7b
export OMERTA_LOCAL_MODEL=qwen2.5-coder:7b
```

Small local models are weaker at multi-step tool use. If one loops or emits
malformed tool blocks, lower `OMERTA_MAX_TOOL_ITERS` and give it smaller tasks —
or switch to a cloud brain for the hard part and back to local for the grind.

## Adding a provider

Any OpenAI-compatible endpoint needs no code — add a block to
`config.PROVIDERS` with `kind: "openai"` and its `base_url`.
