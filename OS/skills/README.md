# Skills

**There are no skill files in this folder, and that is deliberate.**

The ARMS guide is tool-agnostic, so it proposes an `OS/skills/` folder of instruction files
you invoke by name — *"run the follow-up skill on today's call"*. That works on any
assistant. It is also strictly worse than what is already available here.

Real skills live in `~/.claude/skills/` (or a project's `.claude/skills/`) and in the
Claude account, and they differ in one way that matters: **they fire from their description
without being named.** A skill file in a folder only runs when you remember it exists,
which is the same failure mode as a memory index nobody reads.

So this folder holds the *policy*, and the skills themselves live where they can trigger.

## Currently installed

| Skill | Fires on |
|---|---|
| `generate` | Any request for an image, background, loop, loader, thumbnail, or video |
| `gauntlet-loop` | "gauntlet this", "loop until it beats X" — the loop Blueberry phases run on |
| `arms` | Operating this OS: capturing decisions, promoting repeats, weekly upkeep |

Account skills sync to every session including Cowork. Skills installed only in the CLI
under `~/.claude/skills/` stay on this machine.

## The promotion rule

**Asked three times → it is a skill.** Not a habit, not a snippet you paste, not something
you re-explain. Three is the threshold because twice is a coincidence and four times means
you have already wasted a session's worth of re-explaining.

When you write one:

1. Name it, and say **when to use it** in the description — that string is the entire
   triggering mechanism, so write it with the phrasings you actually type.
2. The steps.
3. **One example of great output.** This does more than the steps do.
4. When a result misses, **fix the file, not the chat.** A correction made in conversation
   dies with the conversation. That is the whole point of the part.

## What is not a skill

- Something you have done once. Wait for the third time.
- Something with no standard of "good" — if you cannot say what separates a great result
  from an average one, writing the steps down will not help.
- Anything a plain script does better. A skill that only ever shells out to one command
  should be that command, in a routine.
