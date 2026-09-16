---
name: termux-env
description: Termux/Android environment quirks — paths, packages, storage, ports, background services
triggers: [termux, pkg install, proot, storage permission, on-device, wake-lock, android shell]
---

# Termux environment

## Assumptions that break here

- Prefix is `/data/data/com.termux/files/usr`, not `/usr`. Shebangs must be
  `#!/data/data/com.termux/files/usr/bin/bash`, never `#!/bin/bash`.
- No systemd. Use `termux-services` (`sv-enable`) or `nohup ... &`.
- Storage access needs `termux-setup-storage` once, then `~/storage/`.
- Ports below 1024 are blocked without root. Bind 8787+ as this project does.
- `pkg` is the package manager; it handles mirrors better than raw `apt`.
- Anything wanting `gcc` should use `clang` here.
- Long builds get killed by Android doze/OOM. `termux-wake-lock` before,
  `termux-wake-unlock` after.

## Running the agent in the background

```
termux-wake-lock
nohup python server.py > ~/omerta-agent.log 2>&1 &
```
Reach it from any device on the LAN at `http://<phone-ip>:8787`
(`ip addr show wlan0` to find the IP).

## pip packages that commonly fail

Anything needing a C build wants `pkg install clang make libffi openssl
python-dev` first. `cryptography` and `numpy` are the usual offenders —
prefer `pkg install python-numpy` over pip where a native package exists.
