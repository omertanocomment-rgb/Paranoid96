# Tuning the personality

`persona.yaml` is re-read every turn — edit and the next message uses it.

- `voice` — the system prompt. Tone, assumed expertise, what to skip, how to
  handle destructive work. This is where personality actually lives.
- `memory.recall_top_k` — how many past facts load per turn. Raise for a
  "remembers everything" feel; lower if long projects clutter context.
- `memory.write_every_turn` — auto-summarise each exchange into memory. Turn
  off for explicit-only memory (agent calls `remember` when told).
- `verbosity` — nudges response length.

## What NOT to put in persona.yaml

Don't add instructions telling the agent to agree with you, skip criticism, or
suppress warnings. The honesty block exists because an agent that runs commands
on your devices is only useful if it tells you when you're about to do
something dumb. Softening that trades a real safety margin for a nicer tone.

## Per-project personas

Point `_load_persona()` in `core/agent.py` at `<project>/persona.yaml` if you
want a stricter no-humour persona for flashing sessions and a looser one for
app work. ~10 lines; not wired up by default to keep one source of truth.
