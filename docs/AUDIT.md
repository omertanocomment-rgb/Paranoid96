# OMERTA AGENT — security & correctness audit

Scope: the entire agent (core, tools, servers, sync, MCP, the two front-ends)
plus the newly-embedded Android backend. This documents the threat model, what
was checked, what was fixed in this pass, and what is an accepted, documented
design choice.

_Last reviewed: 2026-09 (embedded-backend + offline/online + unlimited-chat work)._

## Threat model

OMERTA runs on the user's own devices and drives real, destructive tooling
(`fastboot`, `dd`, build systems). The interesting adversaries are:

1. **The model itself acting without consent.** A local 7B or a frontier model
   should never be able to run a command, write a file, flash a partition, or
   call a connector on its own.
2. **A second person on the same network** reaching a LAN-exposed server and
   approving/running commands, or reading memory.
3. **A malicious/compromised MCP connector or plugin** trying to act without
   going through the gate.
4. **Untrusted content** (a scanned repo, a synced bundle, a model reply)
   trying to smuggle an action through.

It explicitly does **not** try to sandbox the user from their own machine: once
*you* approve `rm -rf build`, it runs. The guarantee is consent, logging and
learning — not confinement of an authorized operator.

## The core guarantee (verified)

Every side-effecting tool returns a **pending-approval** record instead of
executing; the loop suspends and hands the exact command up to the UI. This is
enforced in `core/agent.py` (`SIDE_EFFECT_TOOLS`, `_needs_approval`,
`_run_tool`), not in the prompt, and re-verified by `tests/test_approval.py`
and `tests/test_integration.py`. A hard-deny list (`config.DENY_PATTERNS`) is
refused even if the user tries to approve it (`sandbox.classify` /
`sandbox.run` both re-check), verified by `tests/test_flash.py`.

Shell-backed tools (`run_shell`, `git`, `gradle`, `adb`, `fastboot`,
`cross_compile`, …) all funnel through the single `sandbox.run` gate, so there
is exactly one execution path and one audit log (`data/command_log.jsonl`).
Plugin and MCP tools with side effects route through the same gate
(`name.startswith("mcp.")` and `side_effects=True` both force approval).

## Network / auth (verified)

- Token generated on first run, stored `0600` (`core/auth.py`), required from
  every non-loopback client.
- Loopback is exempt **unless** the request carries forwarding headers
  (`X-Forwarded-For` / `X-Real-IP` / `Forwarded`), which could spoof a loopback
  source address. `uvicorn` is run with `proxy_headers=False,
  forwarded_allow_ips=[]` so it can't be tricked into rewriting the client IP.
- This spoofing matrix is regression-tested against **both** servers:
  `tests/test_auth.py` (FastAPI) and `tests/test_httpd.py` (stdlib/Android).

## Findings fixed in this pass

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| F1 | High (portability) | `tools/importers.py` used a PEP 701 nested-quote f-string (`f'{e or 'noext'}...'`) that raises `SyntaxError` on Python 3.9–3.11 — the declared supported range and two of three CI matrix versions. `/import <repo>` would crash on import. | Rewritten with pre-computed parts; imports on 3.9+. |
| F2 | Medium | Embedded server is multi-threaded; two overlapping requests for one project could interleave `Agent.history` / `pending` mutations. | `core/api.chat` serializes per project with a lock; different projects still run concurrently. |
| F3 | Low | Stdlib server read the full POST body by `Content-Length` with no cap → memory-exhaustion vector. | `httpd.Handler.MAX_BODY` caps bodies at 16 MiB. |
| F4 | Low | Secret-writing API could otherwise be exposed on a LAN server. | `POST /api/secret` gated by `ALLOW_SECRET_API` (off by default) **and** an `is_loopback` check in both transports; `GET /api/secret` returns booleans only, never values (tested). |

## Accepted / documented design choices

- **`fileops.read_file` is unconfined.** An authenticated agent can read any
  file the process can. This is intentional — it is a coding agent that must
  read your source — and reads are side-effect-free (no gate). Writes,
  deletes and patches *are* gated and take automatic backups
  (`data/backups/`, `core/checkpoint.py`). Do not run the server as a more
  privileged user than the operator.
- **`sandbox.run` uses `shell=True`.** Inherent to a shell tool; every command
  is shown verbatim and approved before running. What you approve is
  character-for-character what executes (`Agent._describe`).
- **Default `SERVER_HOST=0.0.0.0`.** The desktop/LAN server binds all
  interfaces on purpose (that's the "reach it from your phone" feature); the
  token is what protects it. The Android app overrides this to `127.0.0.1` so
  the in-APK backend is never reachable off-device.
- **`?token=` appears in a URL** on first handshake, then a `HttpOnly` cookie
  takes over. On the Android app loopback is exempt so no token is used at all.
- **MCP `connectors.yaml` can spawn local processes.** That's user
  configuration (like a shell rc file); individual tool *calls* still require
  approval.

## Embedded Android backend (new) — notes

- No Termux, no `RUN_COMMAND` intent, no external process. Chaquopy hosts
  CPython in-process; `core/httpd.py` (stdlib only — no FastAPI/pydantic)
  serves the UI/API on `127.0.0.1`.
- The agent code is byte-for-byte the same as every other platform (the app
  ships the repo's `core/`/`tools/` as an extracted payload and imports them),
  so the approval gate and deny-list are not re-implemented and cannot drift.
- On a stock, non-rooted phone the shell tools (`git`, `adb`, `fastboot`) are
  simply absent; the agent reports that honestly rather than pretending. The
  value on-device is the model + memory + approval workflow; rooted/dev devices
  that have the tools get the full agent.
- API keys entered in the app are stored `0600` under the app-private files
  dir and never leave the device; the write path is loopback-only.

## Addendum — capabilities added after the first audit

- **Codebase index (`core/index.py`), roles (`core/roles.py`), memory/teach
  verbs (`core/commands.py`)** are read-only or write only to the agent's own
  data dir. `omerta agent/plan/review/…` shell out to the same CLI and agent,
  so every side effect still passes the approval gate; roles only change the
  system-prompt focus, never the gate.
- **Firmware tools (`plugins/firmware_bringup.py`)**: `analyze_dtb`,
  `inspect_image`, `board_report`, `collect_evidence_plan` are read-only
  (`side_effects: False`). `extract_image` writes extracted parts to a local
  directory and is marked `side_effects: True`, so the agent routes it through
  approval; it never writes to a device. All device/destructive actions
  (adb/fastboot/flash) remain shell-backed and gated, with flashing High-Risk
  and the hard-deny list intact.
- **Sandbox isolation (`core/isolate.py`)** only ever *narrows* what a command
  can do (resource limits, network denial, shadowing key stores) and is opt-in
  (`OMERTA_ISOLATE=1`); it cannot widen access. Snapshots/rollback write only
  under the agent data dir and the explicit restore target.
- **Packaging**: the Docker image and `.deb`/AppImage recipes hard-code no
  secrets; the server inside still enforces token auth (loopback-exempt). The
  Docker image binds `0.0.0.0` by design (container networking) — front it with
  the token like any LAN server.
- The `code_index` FDT/boot parsers only *read* attacker-supplied images; a
  malformed image yields a handled error, never code execution.

## How to re-run the checks

```bash
bash tests/run_all.sh        # approval, deny-list, auth spoofing (both servers),
                             # tool-parse, mode routing, unlimited-chat trim, sync
python scripts/doctor.py     # environment / provider / safety report
```
