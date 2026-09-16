# The safety model

## Enforced in code, not in the prompt

Prompt instructions are suggestions to a model. This is a control-flow gate.

`core/agent.py::_run_tool` checks every tool against `SIDE_EFFECT_TOOLS`,
plugin `side_effects` flags, and the `mcp.` prefix. Anything matching returns
`awaiting_approval` and **the loop returns to the UI**. The execution function
`_execute_approved` is only ever reachable from `approve()` or
`edit_and_approve()` — both of which require a human action.

A jailbroken or confused model cannot bypass this, because it never holds the
execution path.

Verified by `/tmp/test_approval.py`-style tests: a model instructed to create a
file does not create it until approved.

## Layers

1. **Hard deny** — `config.DENY_PATTERNS`. Refused even if you try to approve.
   `rm -rf /`, `fastboot flashall -w` (wipes userdata), `mkfs` on raw disks,
   fork bombs, `chmod -R 777 /`.
2. **Danger flagging** — `HIGH_RISK_PREFIXES` render the approval card red.
   Flashing, partition ops, `reset --hard`, force-push, recursive chmod.
3. **Always-ask** — everything else still asks. Default ON.
4. **Backups** — every `write_file` / `apply_patch` / `delete_file` snapshots
   the original to `data/backups/` first. `/backups` lists them.
5. **Audit log** — `data/command_log.jsonl` records every proposal, approval,
   denial and result. `/history` reads it.

## Turning it off

`/ask off` exists. Don't use it on a machine wired to a device you care about.
The one-command difference between `fastboot flash boot boot.img` and the same
command with the wrong image is a brick, and the agent cannot tell them apart
from the filename alone — you can.

## Scope

This toolkit is for devices you own or are explicitly authorised to test. The
`apk-analysis` skill says the same thing. That's not legal boilerplate; a
toolkit this capable pointed at someone else's hardware is a different activity
with different consequences.

## Network access control

The approval gate governs the *model*. It says nothing about a second person
on your WiFi opening the web UI and tapping RUN. On a machine wired to a
bootloader rig that's a real risk, so the server (`server.py`) is
token-protected — see `core/auth.py`.

- A token is generated on first run, stored `0600` in `data/auth.json`, and
  printed at startup. `/token` shows it, `/token rotate` replaces it.
- Remote devices pass `?token=...` once; a cookie carries it after that.
- **Loopback is exempt** so the CLI and Electron app just work — but *only*
  for genuine loopback. A request carrying `X-Forwarded-For` / `X-Real-IP` /
  `Forwarded` never gets the exemption, and uvicorn is launched with
  `proxy_headers=False`, closing the header-spoofing bypass where a LAN
  attacker sends `X-Forwarded-For: 127.0.0.1` to look local. Both layers are
  covered by `tests/test_auth.py`.
- `OMERTA_NO_AUTH=1` disables it. The startup banner shouts when it's off.

The one thing to remember: the backend has a real shell and (with your
approval) can flash your devices. Treat its token like an SSH key.
