# Where this project is

Written for a Claude Code session that did not see the conversation this work
came out of. A transcript does not travel between sessions; this does. Read it
after `CLAUDE.md`, which holds the standing rules and outranks anything here.

Last updated at 1.16.0.

## What this is

An agent that runs on hardware the owner owns: reads and writes code, drives a
real shell, inspects and builds firmware, and asks before it acts. Three
shipped forms, built from one tree — an Android APK, a Debian package and a
Windows installer.

The owner's own device is a **32-bit ARM phone** (`armv7l`, `armeabi-v7a`,
model P602). That single fact explains most of the constraints here:

- The APK must carry `armeabi-v7a` as well as `arm64-v8a`. Shipping one ABI
  made eight releases that would not install.
- On-device model weights do not fit. Not RAM — address space. The weights
  screen says so per row rather than letting a 2 GB download fail at the end.
- The Claude Code CLI v2.x cannot run there at all: it ships a native binary
  and there is no 32-bit Android build. v1.0.128 is the last pure-JavaScript
  release and does run. If a terminal session is on that phone, that is why.

## The shape of the code

| Path | What it is |
|------|-----------|
| `core/dispatch.py` | The one request layer. Every transport routes through it. |
| `core/api.py` | All application logic; transports stay thin. |
| `core/agent.py` | The turn loop and the approval gate. |
| `core/sandbox.py` | Command classification, tiers, the audit log. |
| `android-native/` | The app. Jetpack Compose — no WebView, no HTML, no HTTP. |
| `webui/` | Only for reaching a backend from a LAN browser. Not in the APK. |
| `scripts/audit.py` | The gate. Full suite plus structural checks. |
| `scripts/release.sh` | Gate, build all three, verify the artifacts, one zip. |

Eight tabs in the app: CHAT, CHATS, CODE, GIT, LEARN, TOOLS, TERM, SETTINGS.

## Decisions that look like gaps but are not

Each of these was chosen, and changing it needs a reason rather than a tidy-up:

- **`core/gitx.py` is read-only by whitelist.** The GIT tab cannot commit or
  push; those buttons hand the request to the agent so the exact command lands
  on an approval card. Two ways to move a branch, one ungated, is how a safety
  property stops being one.
- **A scheduled turn uses the same approval policy as a typed one.** It stops
  at the gate and the approval waits. An agent that acts more freely when
  nobody is watching is the thing this project exists not to build.
- **The audit chain is tamper EVIDENCE, not tamper proofing**, and says so: the
  key is on the same device as the log. The value is the head digest written
  down somewhere else.
- **The panic wipe is not behind the gate.** A panic action that stops to ask
  does not work. It reports what it could not remove rather than claiming
  success.
- **Pairing is the only route that answers without a token**, and only while an
  offer is open: expiring, single use, five attempts, private addresses only,
  never written to disk. It does not prove which device claimed.
- **Per-project API keys are thread-local**, not environment variables:
  projects run concurrently, so an env var would be visible to all of them.

## What has never been verified

Stated because the constitution requires it, not as a disclaimer:

- **Nothing has been tested on a real handset.** Every APK has shipped on
  inspection of the built artifact alone.
- **Pairing has never been run against a second device.** The logic is tested;
  the two-device path is not.
- The desktop `.exe` is built but has not been run on Windows.

## Working here

```
python3 scripts/audit.py --phase "<what you just did>"   # must pass clean
bash scripts/release.sh                                  # all three, one zip
```

The gate refuses to package on a finding, and it has caught its own author
four times — most recently a fixed-width window in its own local-only check
that reported a disagreement between two files that agreed.

Building the APK needs the Android SDK and the `jniLibs` payloads. A sparse
clone that skips them is fine for reading and editing; it cannot build.
