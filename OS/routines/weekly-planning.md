# Routine — Sunday weekly planning

**Cadence:** Sunday, 17:00 America/New_York
**Cron (UTC):** `0 21 * * 0` (shifts to `0 22 * * 0` when clocks leave EDT in November)
**Status:** scheduled 2026-08-28, via Claude scheduled tasks (not the OS launcher — see note below)

## Why this exists

Andrew used to plan the week every Sunday and the habit lapsed over the summer. The
point of this routine isn't to do the planning for him — it's to remove the activation
cost of sitting down to do it, by having the inbox and the open threads already
gathered when he opens the board.

## What goes in

- The **Weekly Bench** artifact (capture/triage/week board):
  https://claude.ai/code/artifact/6b557579-b3b0-4281-a0d5-8a7b94ff0533
- `OS/memory/projects.md` — what's in flight across the six repos
- `blueberry_game/STATUS.md` if it exists and changed this week
- Anything left in Weekly Bench's Inbox or Anytime lane from the prior week

## Steps

1. Read the Weekly Bench artifact's current state (its `#server-state` JSON —
   Inbox items, what's already placed on days, the Anytime list).
2. Read `OS/memory/projects.md` and skim `blueberry_game/STATUS.md` for anything
   that reads like an open task and isn't already on the board.
3. Do **not** silently rewrite the board. Compose a short digest instead: what's
   sitting in the Inbox, what's unscheduled in Anytime, and anything from the repos
   that looks worth adding.
4. Send Andrew a push notification with that digest and the Weekly Bench link, so
   the actual sorting — which day, how urgent — stays a human call made in under
   five minutes, not something done for him.

## What comes out

A short push notification: counts (inbox / scheduled / anytime), the two or three
items most worth his attention, and the link. Six lines or fewer.

## Where it lands

The notification only. This routine does not write to Weekly Bench or to any file —
Andrew does the actual triage by tapping through from the notification.

## Note on why this isn't a launcher button

The skill launcher (`OS/apps/launcher`) only fires while Andrew is at that machine
with the server running — fine for on-demand runs, wrong for a habit that's supposed
to catch him even when he's not sitting there. This one runs as a real scheduled task
instead, which is also why it needs `requires_local_device` — reading STATUS.md and
projects.md means it needs this computer to be online when it fires. If the computer
is off, the run still fires but skips the local-file steps and sends a lighter digest
from just the Weekly Bench state.

## Honest assessment

Worth it only if the notification actually gets acted on. If a Sunday goes by where
the notification arrives and nothing on the board changes, that's the signal to stop
sending a digest and try something with more friction — like a routine that blocks
until he replies.
