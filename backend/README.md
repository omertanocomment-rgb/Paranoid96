# Omerta AI Backend

Node/Express gateway that fronts the Anthropic **Messages API** for the Omerta AI app.
It keeps the API key server-side, adds optional shared-secret auth, and streams model
output to the app over Server-Sent Events.

## Run
```bash
cp .env.example .env      # set ANTHROPIC_API_KEY
npm install
npm start                 # http://localhost:8080
```

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | liveness + configured model |
| GET  | `/api/config` | version, default model, model list |
| POST | `/api/chat` | non-streaming completion |
| POST | `/api/chat/stream` | SSE stream (`delta`/`thinking`/`done`/`error`) |

Request body: `{ "messages": [{"role":"user","content":"…"}], "model?": "...", "system?": "...", "effort?": "high" }`

## Env
| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — | **required** |
| `OMERTA_APP_TOKEN` | _(unset)_ | when set, clients must send `x-omerta-key` |
| `OMERTA_MODEL` | `claude-opus-5` | default model |
| `OMERTA_EFFORT` | `high` | default effort |
| `PORT` | `8080` | |
| `CORS_ORIGINS` | `*` | comma-separated allowlist |

## Deploy
- **Docker:** `docker build -t omerta-ai-backend . && docker run -p 8080:8080 --env-file .env omerta-ai-backend`
- **Render:** `render.yaml` is included (set `ANTHROPIC_API_KEY` as a secret env var).

## Notes
- Default model `claude-opus-5` with adaptive thinking; effort via `output_config.effort`.
- Model IDs are used verbatim — no date suffixes.
