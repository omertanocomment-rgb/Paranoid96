# Security

## Threat model

OMERTA AGENT executes commands on the machine it runs on and, with approval,
can flash devices. Treat it like a shell, because it is one.

| Boundary | Control |
|---|---|
| Model acting on its own | Approval gate enforced in control flow (`core/agent.py`), not in the prompt. `_execute_approved` is unreachable except from a human action. |
| Catastrophic commands | `config.DENY_PATTERNS` — refused even if the user approves. |
| Another person on the LAN | Token auth (`core/auth.py`); loopback exemption refused to any request bearing forwarding headers; uvicorn started with `proxy_headers=False`. |
| Accidental data loss | Every file write/patch/delete snapshots to `data/backups/` first. |
| Audit | Every proposal, approval, denial and result appended to `data/command_log.jsonl`. |

## What is NOT protected

- The backend has your shell privileges. Anyone with the token has them too.
- `OMERTA_NO_AUTH=1` disables network auth entirely. The banner warns loudly.
- `/ask off` disables the approval gate. Do not use it on a machine wired to
  a device you care about.
- Sync bundles carry memory and learned preferences. They never carry API
  keys, tokens, or command logs — but treat the bundle as sensitive anyway.

## Secrets handling

- API keys are read from the environment only; never written to memory,
  never included in a sync bundle, never logged.
- The server token lives in `data/auth.json`, mode `0600`.
- Recommended: keep the key in a `0600` file and source it, rather than
  inlining it in shell config:
  `export ANTHROPIC_API_KEY=$(cat ~/.anthropic_key)`

## Reporting

This is a personal project with no disclosure program. If you find a flaw,
fix it in your fork — and consider whether the approval gate or the auth
layer needs the same fix.

## Verified by tests

`tests/run_all.sh` covers: approval gate cannot be bypassed, hard-deny holds,
denials are learned and not retried, destructive commands are flagged,
X-Forwarded-For loopback spoofing is refused, and sync never resurrects
deleted facts.
