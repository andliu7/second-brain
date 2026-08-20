# Routines

Work that runs on a schedule without being asked. **Nothing here is scheduled yet** — that
was deliberate. A badly scoped daily task is unpleasant to discover three weeks later, so
these are written to be read and edited first.

## How to turn one on

Say: *"schedule the phase-watch routine"* and it gets created as a real scheduled task.
Each file carries the cron line and the UTC conversion already worked out.

Times below are **America/New_York**. Cron is evaluated in **UTC**, so the conversions
assume EDT (UTC−4). They shift by an hour when the clocks change in November — that is a
real maintenance cost of scheduling anything, and the reason to only schedule what earns it.

## The rule the guide gets right

Turn on **one** routine. Read its output for a full week before adding a second. A routine
whose output you skim past is worse than no routine, because it trains you to ignore the
channel the useful ones will arrive on.

## What is here

| Routine | Cadence | Worth it when |
|---|---|---|
| `phase-watch.md` | Weekday mornings | You are mid-gauntlet-loop and want the overnight state without opening four terminals |
| `weekly-upkeep.md` | Friday afternoon | Always. This is the one that keeps the whole OS from rotting |
| `quiet-repos.md` | Monday morning | You have six repos and keep rediscovering uncommitted work in the wrong one |

Start with `weekly-upkeep`. It is the only one whose absence compounds.
