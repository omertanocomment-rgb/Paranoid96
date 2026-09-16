---
name: git-hygiene
description: Safe git operations, recovering from mistakes, keeping history clean
triggers: [git, commit, branch, merge, rebase, push, conflict, revert, stash, reflog]
---

# Git hygiene

## Before any destructive op

`git status && git stash list && git log --oneline -5` — know what you're
about to lose. `git reset --hard`, `git clean -fd` and `git push --force` are
all irreversible for uncommitted/unpushed work.

## Safer equivalents

- `reset --hard` → `git stash` (recoverable)
- `push --force` → `git push --force-with-lease` (refuses if someone else pushed)
- `clean -fd` → `git clean -nd` first to preview

## Recovery

Almost nothing committed is truly lost: `git reflog` keeps every HEAD position
for ~90 days. `git reset --hard HEAD@{3}` rewinds to a reflog entry.

## Commit messages

Imperative mood, subject under 60 chars, body explains *why* not *what* — the
diff already shows what changed.
