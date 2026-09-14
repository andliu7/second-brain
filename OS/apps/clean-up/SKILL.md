---
name: clean-up
description: Sweep this Windows machine of stray automation processes and old temp files, then report what changed in a few lines. Kills webdriver binaries, headless browsers, orphaned bun, and parentless test workers; never touches the always-on node stack. Use when the user types /clean-up, or says clean up my machine, kill stray processes, my machine feels slow, something is still holding the port, chrome is eating my RAM, are there leftover test processes, free up disk, or what is running right now. Also used by the daily 7am scheduled run and the Clean up button in OS/apps/launcher.
---

# clean-up

A sweep, then a short report. The script does the mechanical part; you do the
part that needs judgment — deciding whether what came back is normal.

## Run it

```powershell
powershell -ExecutionPolicy Bypass -File "<skill-dir>\clean-up.ps1"
```

`&&` is a parse error in PowerShell 5.1. Use separate commands or `;`.

It prints one JSON object and appends one line to `clean-up.log`. Add `-DryRun`
if the user asked what *would* be cleaned. Add `-TempOlderThanDays N` to widen or
narrow the temp sweep from its default of 7.

If the JSON does not parse, the script threw — show the raw output and stop.
Do not clean anything by hand instead.

## Then report

Six bullets, in this order, from the JSON. Nothing else:

| Bullet | Field | Notes |
|---|---|---|
| Killed | `killed` | Name each one and why. `nothing` when the list is empty. On a dry run `killed` is always empty — report `targets` as "would kill" instead |
| Freed | `tempFreedMb`, `tempNowMb` | "Freed X MB of old temp files (temp folder now Y MB)" |
| Disk | `diskFreeGb`, `diskLetter` | |
| Processes | `processCounts` | Top few as `chrome x24, node x68` |
| Top RAM | `topRam` | `name NNN MB` |
| Top CPU | `topCpuSeconds` | Label it **total seconds**, not load |

Then **one short paragraph of interpretation**, and a next step. This is the
part that makes it a skill instead of a script.

## What the numbers actually mean

Read these before calling anything alarming:

- **CPU seconds are lifetime totals**, accumulated since that process started.
  A Chrome tab open for three days showing 2942 is not busy, it is old. Never
  report a high CPU number as high load.
- **A large node count is expected, not a leak.** PM2, the dashboard, the brain
  and the OS all live in node. The script leaves every node process with a live
  parent alone by design. Sixty-plus is the normal resting state on this machine.
- **`suspicious` is not a to-do list.** Those are test runners still attached to
  a parent. Mention them only if there are several, and never suggest killing
  them without asking.
- **`tempNowMb` in the hundreds is fine.** Windows keeps a working temp folder.
  Only flag it if it is growing run over run in the log.

## Say something only when there is something to say

Most runs are quiet. A quiet run gets a quiet report — do not manufacture a
finding. Escalate only on:

- `diskFreeGb` under 20
- `killFailures` non-empty (something refused to die; usually a permissions issue)
- the same driver getting killed on several consecutive runs, which means a test
  suite is not tearing down and the fix belongs in that suite, not here

## Example of a great run

> Clean-up ran. Nothing needed killing — no headless browsers, webdrivers, test
> leftovers, or orphaned bun processes.
>
> Today's log entry (2026-08-20 11:39):
>
> - Killed: nothing
> - Freed: 1.1 MB of old temp files (temp folder now 172 MB)
> - Disk C: 397.3 GB free
> - Processes: chrome x24, node x68
> - Top RAM: Memory Compression 1803 MB, claude 833 MB, claude 781 MB, Code 625 MB, MsMpEng 532 MB
> - Top CPU (total seconds): chrome 2942, chrome 1347, chrome 475, ArmouryCrate 247, Code 243
>
> Nothing unusual. The chrome CPU numbers are lifetime totals since those tabs
> opened, not current load, and the 68 node processes are your always-on stack
> (PM2, dashboard, brain, OS) — the script leaves those alone by design.
>
> Next step: nothing needed — the 7am daily schedule keeps this running on its own.

That is the whole shape: what happened, the numbers, one honest paragraph, one
line on what to do. It is good because it refuses to dress a quiet run up as a
finding, and because it pre-empts the two numbers that look scary and are not.

## The line not to cross

Never widen the kill rules to make a run feel productive. If nothing needed
killing, nothing needed killing. Adding `node` to the target list, dropping the
`--headless` requirement on browsers, or killing anything out of `suspicious`
would each turn a safe sweep into one that eventually takes down the dashboard
mid-session — and it would do it on a run nobody was watching.
