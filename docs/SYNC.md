# One brain across every device

Memory, learned preferences and denials sync across Termux, Linux/Kali,
macOS, Windows and the phone app — with no cloud account in the middle.

## Two transports

### Peer (LAN, device-to-device)

Both devices run the agent. One syncs to the other:

```
/sync 192.168.1.42:8787            # uses your local token
/sync 192.168.1.42:8787 <token>    # if the peer has a different token
```

Two-way in one call — it pulls what the peer learned, then pushes what you
learned. Uses the same token auth as the web UI, so nothing leaves your
network.

Get the peer's token on that device with `/token`.

### File (shared folder — works offline)

For devices that are never awake at the same time, or when you'd rather not
open a port. Point every device at one folder that Syncthing, Dropbox,
Drive, or a literal SD card replicates:

```bash
export OMERTA_SYNC_DIR=~/Dropbox/omerta-sync
```
```
/sync                      # uses OMERTA_SYNC_DIR
/sync dir /sdcard/omerta   # or an explicit path
```

Each device writes `omerta-sync-<device-id>.json` and reads everyone else's,
so any number of devices can share one folder without clobbering each other.

### Automatic

```bash
export OMERTA_SYNC_ON_START=1
export OMERTA_SYNC_DIR=~/Dropbox/omerta-sync
export OMERTA_SYNC_PEERS=192.168.1.42:8787,192.168.1.50:8787
```
Runs on server startup. `/sync status` shows peers, folders and last-sync times.

## What syncs

| | syncs | notes |
|---|---|---|
| facts, decisions, fixes | yes | last-write-wins on `updated_at` |
| learned approvals/denials | yes | append-only; never overwrite |
| deletions (`/forget`) | yes | tombstoned so they don't resurrect |
| session summaries | yes | |
| conversation history | no | per-device and ephemeral by design |
| tokens, API keys | **no** | never in a bundle |
| command logs, backups | no | local forensics stay local |

## Merge rules

These are deliberate, not incidental:

- **Idempotent.** Every row has a uid. Sync the same bundle a hundred times
  and nothing duplicates.
- **Deletions win over staleness.** Forgetting something on your phone
  tombstones it; the next device to sync removes it too rather than pushing
  the old copy back.
- **Safety signals only accumulate.** A denial recorded on one device is
  never dropped in a conflict. Refusing `fastboot erase` on your phone means
  your Kali box won't propose it either — verified in `tests/test_sync.py`.
- **Version-guarded.** A bundle from a newer install is rejected with a clear
  message instead of being half-applied.

## Setup for the usual arrangement

Phone (Termux) + Kali box + laptop, all on the same WiFi:

```bash
# on each device, once
export OMERTA_SYNC_DIR=~/Syncthing/omerta
export OMERTA_SYNC_ON_START=1
```

Then just use them. Whichever device you're on knows what the others learned
the last time they were both online.

## Troubleshooting

- `peer rejected the token` — the peer has its own token. Run `/token` there
  and pass it: `/sync host:port <token>`.
- Nothing merges from a folder — check every device points at the *same*
  directory and that your sync client has actually replicated the `.json`
  files. `/sync status` shows last-sync times.
- Want a clean re-pull of everything: the `full=True` flag ignores the
  last-sync watermark (`/api/sync/run` with `{"full": true}`).
