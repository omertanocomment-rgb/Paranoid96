# Connectors (MCP)

The agent is a full MCP client — it can use any Model Context Protocol server
as a toolset. Configure in `connectors.yaml`, check with `/connectors`.

## Transports

**stdio** — a local process. Works fully offline.

```yaml
servers:
  filesystem:
    enabled: true
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
```

**http** — a remote streamable-HTTP/SSE endpoint. Needs internet.

```yaml
  sentry:
    enabled: true
    transport: http
    url: https://mcp.sentry.dev/mcp
    headers:
      Authorization: "Bearer $SENTRY_TOKEN"
```

Env vars in `env:` and `headers:` expand from your shell, so **no tokens are
ever written into the config file**.

## Presets included

`filesystem`, `git`, `github`, `sqlite` (query the agent's own memory),
`fetch`, `sentry`, `cloudflare` — all disabled by default. Flip `enabled: true`
on what you want.

## Naming and safety

MCP tools appear as `mcp.<server>.<tool>`. **Every connector call requires
approval** — a remote tool can write to your repos and cloud accounts, so
none of them are treated as read-only, even ones that look like reads.

## Adding a GitHub connector

```bash
export GITHUB_TOKEN=ghp_...
# set enabled: true on the `github` block in connectors.yaml
```
Then `/connectors` should show it green with its tool count.

## Troubleshooting

- `failed: ENOENT` → the `command` isn't installed (`npx` needs Node; `uvx`
  needs `pip install uv`).
- `did not respond to initialize` → the server crashed at startup; run its
  command manually in a terminal to see the error.
- Tools listed but calls fail → usually a missing token in `env:`.
