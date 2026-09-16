# Skills

A skill is a markdown playbook the agent pulls in when relevant. It keeps the
system prompt small (important for 7B local models) while still giving the
agent deep procedure knowledge when a task needs it.

## Format

`skills/<name>/SKILL.md`:

```markdown
---
name: my-skill
description: One line — shown in the always-visible catalog.
triggers: [keyword, another-keyword, error-string]
---

# Body

Procedures, command recipes, gotchas. Only injected when a trigger matches.
```

## How matching works

Every skill's *name + description* is always in context (cheap). The **body**
loads only when a trigger word appears in your message, max 2 skills per turn.
Force one with `load_skill` or read it yourself with `/skill <name>`.

## Bundled

| skill | covers |
|---|---|
| `android-build` | Gradle, Capacitor, signing, AGP/JDK mismatches, Termux build limits |
| `firmware-flash` | fastboot, partition backup, A/B slots, soft-brick recovery |
| `cross-compile` | armv7l/aarch64/NDK triples, autotools, verifying output arch |
| `apk-analysis` | aapt/apktool/jadx, manifest red flags, IPA entitlements |
| `termux-env` | prefix paths, no systemd, wake-lock, pip packages that fail |
| `git-hygiene` | safe destructive ops, reflog recovery |
| `debug-build-failure` | read the FIRST error, bisect, record the fix |
| `release-packaging` | semver, reproducible archives, electron-builder |

## Writing good ones

Put in what you had to learn the hard way — the failure modes, not the
documentation. `firmware-flash` earns its place because it encodes
"back up the partition *before* flashing" and "never batch flash commands into
one approval", which is exactly the knowledge that prevents a brick.
