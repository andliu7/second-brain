# Routine — Quiet repos

**Cadence:** Monday, 09:00 America/New_York
**Cron (UTC):** `0 13 * * 1`
**Status:** not scheduled

## Why this exists

Six repos, one person. Work gets left uncommitted in the repo you were *not* thinking about,
and it surfaces weeks later as a merge you have to reconstruct from memory.

## Steps

For each of `blueberry_game`, `mechanism_trainer`, `Pibble`, `Portfolio`,
`grignard/grignard-app-source`:

1. `git status --porcelain` — uncommitted changes.
2. `git log -1 --format=%cs` — last commit date.
3. `git stash list` — stashes older than two weeks are usually forgotten, not parked.

## What comes out

One table. Repo, last commit, uncommitted file count, stash count. Flag only:

- uncommitted work older than 7 days
- a stash older than 14 days

Everything clean gets a single line saying so, not a row each.

## Where it lands

Back into the conversation.

## Honest assessment

Lowest value of the three, and the first to delete if the Monday message starts feeling
like noise. It earns its place only while more than three repos are genuinely active.
