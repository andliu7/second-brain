# Routine — Weekly OS upkeep

**Cadence:** Friday, 16:00 America/New_York
**Cron (UTC):** `0 20 * * 5`
**Status:** not scheduled

## Why this exists

This is the fifteen minutes the ARMS guide calls "keep it alive", and it is the only
routine whose absence compounds. Memory that is never pruned does not go quiet — it goes
**wrong**, and a wrong memory is worse than no memory because it gets acted on with
confidence.

## Steps

1. **Prune memory.** Read `OS/MEMORY.md` and each note. For every `fact`-kind claim, ask:
   is this still true? `projects.md` rots fastest — branches move, projects go quiet.
   Delete what is stale rather than annotating it.
2. **Promote what repeated.** Anything asked for three or more times this week is a skill,
   not a habit. Write it as a real skill file rather than re-explaining it a fourth time.
3. **Reindex the brain.** `python idx.py` in `second-brain/`, natively in PowerShell.
   New files this week are invisible to `q.py` until this runs.
4. **Write down what you would have to re-derive.** Any project touched this week that
   still has no `NOTES.md` at its root: three or four lines on why this library, what
   breaks the build, what the deploy is. Headings weighted 3× — write them in the words
   you would ask the question in.
5. **Rebuild the home page.** `python OS/build_home.py`.
6. **Check the routines actually landed.** If a scheduled routine produced nothing all
   week, it is broken or unnecessary. Either fix it or delete it.

## What comes out

A short list of what was pruned, what was promoted, and anything that looks like it is
drifting. If nothing needed pruning, say so — that is a real signal too.

## Honest assessment

Fifteen minutes, and it is the difference between a system that compounds and a folder of
stale notes you stop trusting. Turn this one on first.
