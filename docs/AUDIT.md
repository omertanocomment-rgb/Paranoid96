# OMERTA AGENT — security & correctness audit

Scope: the entire agent (core, tools, servers, sync, MCP, the two front-ends)
plus the newly-embedded Android backend. This documents the threat model, what
was checked, what was fixed in this pass, and what is an accepted, documented
design choice.

_Last reviewed: 2026-09 — two passes. Pass 1: embedded backend, offline/online,
unlimited chat (F1–F4). Pass 2: the full build, focused on untrusted input —
firmware images and sync bundles (F5–F9), including one confirmed
arbitrary-file-write._

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

## Findings from the post-build audit (firmware + untrusted input pass)

This pass traced every path where **attacker-controlled bytes reach a filename,
an allocation, or the database**. Three of the five were confirmed by exploit,
not by reading.

| # | Severity | Finding | Evidence | Fix |
|---|----------|---------|----------|-----|
| **F5** | **High** | **Path traversal → arbitrary file write** in `super_extract`. A logical-partition name is read out of the super image's LP metadata (`name = data[base:base+36]…`) and was used directly as a filename: `os.path.join(out, p["name"] + ".img")`. Analysing an untrusted `super.img` — exactly what this tool is for — could write anywhere the process can. | Exploited: a crafted image with the partition named `../../ESCAPED` produced `/tmp/…/sub/out/../../ESCAPED.img` containing `PWNED-CONTENT`, outside the chosen output directory. | `_safe_name()` reduces a metadata-supplied name to a bare, charset-restricted filename; `_safe_join()` then re-checks the resolved path is inside the output dir and raises otherwise. Applied to `extract_image` too. Regression: `test_super_extract_rejects_path_traversal`. |
| **F6** | Medium | **Unbounded allocation from a crafted image.** `unsparse` trusted the sparse header's chunk count and per-chunk block count, so a 40-byte file could declare gigabytes of `DONT_CARE` output; a `total_sz` of 0 looped forever; a RAW chunk body past EOF was silently truncated. `parse_super` likewise trusted the LP table entry counts and offsets. | A 40-byte sparse header declaring 64 GiB allocated until the process died. | `MAX_OUTPUT_BYTES` (8 GiB) / `MAX_TABLE_ENTRIES` (4096), both env-overridable; bounds checks on every chunk header, body, table offset and extent reference; non-advancing chunks and implausible entry sizes rejected. Regression: `test_untrusted_images_are_bounded`. |
| **F7** | Medium | **A peer sync bundle could crash the sync endpoint.** `merge_bundle` bound bundle fields straight into SQLite. A non-scalar value (`content: {…}`) raised `sqlite3.ProgrammingError`; `facts` not being a list raised `AttributeError`; a string `created_at` was stored verbatim and then raised `TypeError` on the *next* merge's comparison. Unbounded row counts and field lengths could also bloat the DB. | Reproduced all three: `RAISED ProgrammingError`, `RAISED AttributeError`, `RAISED TypeError: '>' not supported between 'float' and 'str'`. | `_text`/`_num`/`_flag` coerce and bound every field (`MAX_TEXT_LEN` 200 000); `MAX_BUNDLE_ROWS` (100 000) refuses an oversize bundle before merging; `facts`/`choices` type-checked; rows that aren't dicts are skipped, not fatal; the DB loop is wrapped so a `sqlite3.Error` rolls back and returns a clean error. Stored timestamps are re-coerced on read, so a DB already polluted by a pre-fix sync recovers. Regression: three new checks in `tests/test_sync.py`. |
| F8 | Low | Web UI `esc()` escaped `& < >` but not quotes, and a handful of interpolations (provider keys, secret-key names, memory counters) went into `innerHTML` — two of them into an **attribute** — unescaped. All those values are server-side constants today, so this was reachable only via a malicious plugin/provider name, but it is one rename away from being real. | Reviewed, not exploited (no untrusted source reaches them at present). | `esc()` now also escapes `"` and `'` and handles non-string input; every remaining interpolation routed through it. The security-critical path (the approval command text) was already escaped. |
| F9 | Low | The FastAPI/LAN server had **no request-body cap**, while the embedded stdlib server capped at 16 MiB — an asymmetry, and the LAN server is the exposed one. | Reviewed. | `server.MAX_BODY` (16 MiB) enforced in the auth middleware; oversize → `413`, malformed `Content-Length` → `400`. Both servers now agree. |

Checked and found clean in the same pass:

- **Static asset serving** on the embedded server (`/assets/…`) — probed with
  `../`, URL-encoded `..%2F`, doubled `....//` and an absolute path; all 404,
  no leak. `Path.resolve()` + a `parents` containment check also defeats a
  symlink planted inside the assets dir.
- **SQL** — every statement in `memory.py`/`sync.py` is parameterised; no
  string-built SQL anywhere in the tree.
- **No `eval`, `exec`, `pickle`, `yaml.load`, or `os.system`** in the codebase.
  A single `shell=True` exists, in `core/sandbox.py`, behind the approval gate.
- **No hardcoded secrets**; `compileall` clean on the whole tree.
- **The approval gate** still mediates every side-effecting firmware tool —
  `extract_image`, `repack_image`, `super_extract`, `super_repack` are all
  `side_effects: True`; the read-only analysers are not.

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
- The FDT/boot parsers only *read* attacker-supplied images; a malformed image
  yields a handled error, never code execution. The first version of this
  addendum stopped there and was too generous: pass 2 found that *extraction*
  of such an image could still write outside its output directory (F5) and
  allocate without bound (F6). Both are fixed and regression-tested. Reading is
  not the only thing a parser does — the bytes it hands onward count too.

## How to re-run the checks

```bash
bash tests/run_all.sh        # approval, deny-list, auth spoofing (both servers),
                             # tool-parse, mode routing, unlimited-chat trim, sync
python scripts/doctor.py     # environment / provider / safety report
```

## Release-build audit (every artifact actually built and run)

Every distributable was produced on a real host and executed, not just
described. What that exercise found:

| Artifact | Verified by | Result |
|---|---|---|
| Android APK (44 MB) | `aapt dump permissions`; unzip + sha256 of the payload | **No Termux permission** (`RUN_COMMAND` gone); `libpython3.11.so` present for arm64-v8a, armeabi-v7a and x86_64; `core/agent.py`, `core/sandbox.py`, `core/httpd.py`, `core/api.py` and `core/config.py` inside the APK are **byte-identical** to the repo, so the approval gate cannot drift between platforms |
| Fat AppImage (91 MB) | ran it | reports python **3.12.11** on a host whose system python is 3.11.15; `doctor` resolves `requests`/`yaml` from inside the bundle; ran `firmware inspect`/`extract` on a real boot.img |
| Standalone binary (26 MB) | ran it | `--version`, `rules`, `firmware inspect` all correct |
| Wheel + sdist | built a venv, installed the wheel, ran the console script | caught a real bug (below) |
| `.deb` | `dpkg -i`, ran `omerta`, `dpkg -r` | caught a real bug (below) |
| Electron AppImage / deb / tar.gz | built | required adding `homepage`/`repository` metadata; desktop `package.json` was also still pinned at 1.0.0 while the project is 1.1.0 |

Two defects were found only because the artifacts were run:

- **`omerta --version` was dead on every front-end.** The entry point treated
  only a *non-flag* first argument as a subcommand, so `--version` fell past its
  own handler into argparse and exited with "unrecognized arguments". The same
  bug was duplicated in the packaging template (`scripts/_stage_package.sh`),
  so the pip-installed console script had it too. Both fixed.
- **The `.deb` reported `omerta-agent unknown`.** It installs to
  `/opt/omerta-agent` with no `pyproject.toml` and is not pip-installed, so
  neither version source existed. It now ships a `VERSION` file, and `_version()`
  reads it before falling back to `pyproject.toml`.

Payload hygiene was checked on the staged bundles: no key-shaped strings, no
`secrets.json`, no memory database and no auth token are staged into any
artifact — the only matches for `sk-ant-` are the literal `sk-ant-...`
placeholder in the docs.

Not built here, and not claimed: the **Docker/OCI image** (no Docker daemon in
this environment — `docker build -f docker/Dockerfile .` is a one-liner where
one exists) and the **macOS/Windows Electron installers** (Apple's signing
tools are macOS-only; Windows needs a Windows host or wine). These are platform
limits, stated rather than papered over.
