# Contributing

## Before you touch `core/`

Run the suites. They are not decoration — they encode the safety contract.

```bash
bash tests/run_all.sh
```

Six suites: approval gate, tool parsing, integration, flash gating, auth
spoofing, multi-device sync. A change that breaks any of them is a bug in
the change, not in the test.

## Rules that are not negotiable

1. **The approval gate stays in control flow.** Never move it into the prompt.
   `_execute_approved` must remain unreachable except via a human action.
2. **New side-effecting tools declare it.** Any plugin tool that writes,
   flashes, spends money, or hits a mutating endpoint sets
   `side_effects: True`. Marking something destructive as read-only is the
   one way to punch a hole in the whole design.
3. **Never widen `DENY_PATTERNS` silently.** Those cannot be approved by
   design.
4. **No secrets in memory or sync bundles.** Keys come from the environment.

## Style

- Comments explain *why*, not *what*. If a line needs a "what" comment,
  rewrite the line.
- Errors must be actionable: say what failed and what to do about it.
- Copy-paste-ready commands in docs — full commands, not fragments.

## Adding a provider

Any OpenAI-compatible endpoint needs no code: add a block to
`config.PROVIDERS` with `kind: "openai"` and a `base_url`. Anything else
implements `chat()` and `reachable()` in `core/providers/`.

## Releasing

See `RELEASE.md`. Never commit a keystore or `keystore.properties`.
