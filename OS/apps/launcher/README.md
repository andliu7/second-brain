# Skill launcher

Buttons that run skills headlessly. No chat window, no pickers, no text fields —
click, and `claude -p` runs the skill to completion in the background.

```
launcher/
├── index.html          the buttons. Served by launcher.py, not opened directly
├── launcher.py         the whole server. Stdlib only, ~250 lines
├── generate-queue.md   what the Generate button makes next. Add lines, press the button
├── start-launcher.ps1  convenience wrapper
├── runs.log            one line per start, one per finish. Append-only
└── runs/               full terminal output, one file per run
```

## Start it

```
cd C:\Users\zeusa\Downloads\Projects\second-brain\OS\apps\launcher
python launcher.py
```

It opens `http://127.0.0.1:8787/` for you. Ctrl+C stops it.

**Open the URL, not the file.** `index.html` on its own is a dead page — the buttons
talk to the server, and `file://` has nothing to talk to.

## What the buttons run

| Button | What it runs |
|---|---|
| Rebuild home | `python OS\build_home.py --open`. No model, free. Rewrites HOME.html and SKILLS.html |
| Clean up | `/clean-up` on `fable`, effort `xhigh` |
| Doctor plus | `/doctor-plus`, report only: nobody is there to approve its fixes |
| Weekly upkeep | A plain prompt: run `OS/routines/weekly-upkeep.md` step by step |
| Generate visuals | `/generate` on every unchecked line of `generate-queue.md`. Images only |
| Gauntlet Blueberry | `/gauntlet-loop` on the newest work in `grignard-app-source/documentation/STATUS.md` |

The page shows the exact command line under each button. Every run uses
`Downloads\Projects` as its working directory, so `Projects/CLAUDE.md` loads exactly
as it would in a normal session.

### What changed on 2026-09-13, and why

The first version's buttons mostly did nothing while reporting `done`:

- **Morning brief** called `/morning` and **Weekly upkeep** called `/arms`. Neither skill
  is installed on this machine, and `claude -p` answers an unknown command by printing
  `Unknown command` and exiting 0. Morning brief is replaced by Rebuild home, since
  HOME.html is the morning page. Weekly upkeep now names the routine file directly.
- **Generate** and **Gauntlet** pointed at `blueberry_game`, frozen since 2026-09-08.
  Generate looked for a queue that never existed; it now has `generate-queue.md`.
- The server now checks that a button's slash command is installed before running it.
  A button whose skill is missing is greyed out and says which skill, instead of
  going green.

## Changing a button

`SKILLS` at the top of `launcher.py` is the only thing to edit. One dict per button:

```python
{
    "id": "clean-up",              # url-safe, must be unique
    "label": "Clean up",           # what the button says
    "prompt": "/clean-up",         # goes inside claude -p "..."; no double quotes in it
    "model": "fable",              # or None to use your default
    "effort": "xhigh",             # or None to omit --effort
    "blurb": "one line under the button",
}
```

For a button that needs no model, give it `"cmd": "<command line>"` instead of
`prompt`, `model` and `effort`. Rebuild home is the example.

Restart the server after editing. Adding a button is adding a dict — the page builds
itself from `/skills`.

## The two things worth knowing before you trust it

**`--permission-mode bypassPermissions`.** A headless run cannot answer a permission
prompt; without this it hangs until you kill it. With it, these skills write files
without asking. That is the trade fire-and-forget makes, and it is the reason the
server binds `127.0.0.1` and not `0.0.0.0` — nothing on your network can press
these buttons.

**Buttons only prove the process exited.** `done` means exit code 0. Whether the
skill did the right thing is in `runs/<timestamp>-<skill>.log`, which holds the full
terminal output. **view output** on the status line opens it.

## The log

`runs.log` is two lines per run, fixed-width, greppable:

```
2026-08-21T09:14:03-0400  morning        started   claude -p "/morning" --model claude-opus-5 ...
2026-08-21T09:14:41-0400  morning        done      exit=0  38s  2026-08-21_091403-morning.log
```

## When a button fails

1. Click **view output**. The real error is at the bottom.
2. A greyed-out button naming a skill means that skill is not in
   `~/.claude/skills`. Install it, or change the button's prompt.
3. `failed to start` in the log means `claude` is not on PATH for the account
   running the server. Check with `claude --version` in the same PowerShell window.
