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

## Sandbox containment pass — protecting the device, not only the project

The scratch sandbox originally protected your project tree from an experiment
and said so plainly: it did not protect the *device* from what ran inside. This
pass closed that, as far as each platform allows, and made the remaining gap
visible rather than implied.

**What was wrong.** `isolate.wrap()` built a bubblewrap invocation with
`--ro-bind / /` — the whole filesystem, read-only. A command inside could read
your home directory, your source, anything the process could reach; only a
handful of key stores were shadowed. It also never cleared the environment, so
a "sandboxed" process still held every API key in `os.environ`. Containment
that leaves your credentials in reach is not containment against the threat it
exists for.

**What it does now.** `isolate.jail()` is deny-by-default: the system paths are
bound read-only and *nothing else is present at all*, the work directory is the
only writable thing, `/proc`, `/dev` and `/tmp` are fresh, the network is a
separate empty namespace, and `--clearenv` is followed by an allow-list of
variables a build legitimately needs. PID/IPC/UTS namespaces and
`--new-session` come along, so the sandbox cannot see or signal your processes
and cannot push characters back onto the controlling terminal.

Verified by running probes inside a real sandbox, not by reading the flags:

| Probe | Result |
|---|---|
| `cat ~/.omerta_test_secret` | not found — `$HOME` is the sandbox |
| `ls /` | `bin dev etc lib lib64 opt proc sbin tmp usr` — no `/home`, no `/root` |
| `env` | 11 variables, no `ANTHROPIC_API_KEY`, no `*_TOKEN`, no `*_SECRET` |
| connect to `1.1.1.1:53` | `OSError: Network is unreachable` |
| `ls /proc \| grep -c '^[0-9]*$'` | 4 pids, against 80 on the host |
| `echo x > /etc/EVIL` | succeeded **inside the sandbox's tmpfs**; the host `/etc/EVIL` does not exist |

**The honest part.** Containment is not uniform, so `capabilities()` reports
what this device can actually enforce and every run carries the level it got:

- **strict** — bubblewrap/firejail with unprivileged namespaces (the table above).
- **relaxed** — readable but read-only filesystem, key stores shadowed, network denied.
- **limits** — resource caps and a scrubbed environment only, *no namespaces*.

`limits` is what an unrooted Android app gets, because the kernel and SELinux
deny an app the ability to create namespaces. The Android app sandbox still
confines the process to the app's own UID and data directory — that is real,
but it is the OS's doing and not something this code can claim credit for. The
UI prints the level in the sandbox pane rather than leaving the word "sandbox"
to imply the best case, and `jail()` caps a requested level at what the device
can deliver instead of returning a command that merely looks contained.

A command in a sandbox still goes through the approval gate, and the gate still
classifies and displays the command *you* asked for — not the bubblewrap
incantation wrapped around it. An approval prompt full of mount flags is one
nobody reads, and checking the deny-list against the wrapper instead of the
command would be checking the wrong string.

Network is off by default and opened per command (`run +net`), so the case that
genuinely needs it — installing dependencies — is the only thing that gets it.

## Full-build audit — the new surfaces (editor, sandbox, themes, learning)

Everything added after the last pass introduced new HTTP endpoints, and three
of them broke the approval contract over the network. All three were proven by
exploit against a running server, not inferred from reading the routing table.

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| **F13** | **Critical** | **Remote code execution with a token.** `/api/scratch/run` calls `sandbox.run` directly. `sandbox.run`'s own docstring says "only call after the user approved this exact command" — the scratch sandbox called it without any approval step, and the endpoint was reachable by any client holding the token. | A caller presenting `X-Forwarded-For: 203.0.113.9` with a valid token ran `id` and got `uid=0 gid=0 groups=0` back in `stdout`. |
| **F14** | High | **Arbitrary file write.** `/api/ws/commit` writes a file anywhere inside the workspace roots. The UI politely calls `/api/ws/propose` first and shows a diff, but the API never required it, and the endpoint was token-only. | The same remote caller turned a file containing `ORIGINAL` into `PWNED BY REMOTE`. |
| F15 | Medium | **Arbitrary host read.** `/api/learn/path` ingests any absolute path into memory. Token-only, so a remote caller could read and exfiltrate host files through the learning shelf. | `POST /api/learn/path {"path": "/etc/hostname"}` returned `ok` for the remote caller. |

**The fix, and why this shape.** These endpoints are *direct operation of your
own device* — an editor save, a command in your sandbox, a file you point at.
They deliberately do not go through the approval gate, because you are the one
driving them; the gate exists to stop the *model* acting unsupervised. That
reasoning is exactly why they must not be drivable from another machine, and it
is the rule the terminal already followed. The list is now one constant applied
in one place per server:

```
LOCAL_ONLY = ("/api/term", "/api/ws/", "/api/scratch", "/api/learn/path")
```

On the FastAPI server it lives in the auth middleware, so a route added later
cannot forget it. `/api/chat` is deliberately absent: it routes through the
approval gate, so a token is sufficient for it, and that is the whole
distinction.

Re-verified after the fix: all ten probed endpoints return 403 to a forwarded
caller holding a valid token, the targeted file still reads `ORIGINAL`, and the
app itself on loopback is unaffected (the browser test drives browse → edit →
propose → approve → save, search, and sandbox creation with no console errors).
Regression test: `local_only_cases` in `tests/test_httpd.py`.

### Also fixed in this pass

- `core/scratch.py` reached into `fileops._backup` via `__import__("pathlib")`.
  Accepting a sandbox's changes replaces real files and should be as undoable as
  any other edit, so `fileops.backup()` is now public and the hack is gone.
- The `cryptography` probe in `core/chats.py` catches `BaseException` on
  purpose (a broken install raises pyo3's `PanicException`, which is not an
  `Exception`), but it also swallowed `KeyboardInterrupt`. It now re-raises
  `KeyboardInterrupt` and `SystemExit` before the catch-all.

### Checked clean

- `compileall` over the whole tree; no `eval`/`exec`/`pickle`/`yaml.load`/
  `os.system`; one `shell=True`, the gated one in `core/sandbox.py`; no
  key-shaped strings anywhere.
- 21 hostile-input probes across chats, learning, themes, scratch and the
  workspace (missing ids, traversal paths, wrong types, oversize versions,
  a directory where a file was expected): **zero unhandled exceptions**, every
  one returned a structured error.
- `scratch.accept` cannot be talked into writing outside the project: the
  accept list is filtered against the computed change set, whose paths come
  from `os.path.relpath` inside the work tree with symlinks skipped, so a
  caller-supplied `../../escape` is simply not in it.
