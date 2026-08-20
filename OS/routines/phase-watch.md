# Routine — Phase watch

**Cadence:** weekdays, 08:00 America/New_York
**Cron (UTC):** `0 12 * * 1-5`
**Status:** not scheduled

## Why this exists

Blueberry runs as a gauntlet loop: builder, then a separate adversary, iterating until the
bar is met. Phase 1 is at adversary iteration 4 of 5. The state that matters each morning
lives in three places — `STATUS.md`, the branch, and the validator output — and checking
them by hand is exactly the kind of repeated work a routine should absorb.

## What goes in

- `blueberry_game/STATUS.md`
- `git log` on branch `phase-1` since yesterday
- The most recent validator run, if one exists

## Steps

1. Read `STATUS.md`. Note the current phase, mode, and adversary iteration.
2. `git -C blueberry_game log --since=yesterday --oneline` — what actually moved.
3. Report the Phase 1 numbers as they now stand against their floors:
   mutation score vs 80%, distinct named causes vs 12, check count.
4. If any floor is **not** met, say which and stop there — do not propose a fix that
   involves changing the floor. See the non-negotiable in `OS/memory/decisions.md`.
5. Name the single next action, not a list.

## What comes out

Six lines or fewer. Phase, iteration, what moved, numbers vs floors, one next action.
If nothing moved, say "nothing moved" — do not pad.

## Where it lands

Back into the conversation. Do not write a file; a daily file nobody reads is landfill.

## Honest assessment

This one is only worth turning on **while a gauntlet loop is actively running**. Once
Phase 1 merges, turn it off until Phase 2 starts. A routine reporting on a loop that is not
running is noise that teaches you to skip the channel.
