# Andrew's agentic OS

Four standing parts, built on what this setup already has rather than beside it.
Open `HOME.html` first each morning.

```
OS/
├── HOME.html            the front page. Regenerated, never hand-edited
├── build_home.py        reads git + STATUS.md + these notes, rewrites HOME.html
├── MEMORY.md            the index: one line per note
├── memory/              six notes -- profile, environment, projects, decisions, budgets, envs
├── routines/            three routines, written and reviewable. None scheduled yet
├── skills/              policy only. Real skills live where they can auto-trigger
└── apps/                additional tools, as they earn a page
```

Plus, one level up: **`Projects/CLAUDE.md`** — the always-loaded cross-project layer. It is
picked up automatically for every repo under `Downloads/Projects`, so memory loads with no
paste step and no "remember to read the index" ritual.

## Why this is not the folder layout in the guide

The ARMS guide targets any assistant that can read files, so it reinvents four things this
setup already has. Built literally, it would have produced a second memory store, a second
skill store, and a home page that goes stale.

| Part | Guide's version | Built as |
|---|---|---|
| **A**pplications | `OS/apps/` of hand-written pages | One page regenerated from disk, so it cannot drift |
| **R**outines | "whatever your tool offers" | Real scheduled tasks — written now, scheduled on request |
| **M**emory | `OS/memory/` + an index you must remember to read | Same notes, but surfaced through `CLAUDE.md`, which loads itself |
| **S**kills | `OS/skills/` invoked by name | Real skills that trigger from their description |

## The two memory stores, and why both

- **`OS/memory/`** — hand-written, cross-project, **always loaded**. Small on purpose:
  everything here costs context on every session.
- **`second-brain/`** — lexical index over every file on disk, **loaded on request**.
  Free until asked. Its own setup notes say the thing it most lacks is a hand-written notes
  layer — which is exactly what `OS/memory/` and per-project `NOTES.md` files are.

They are complementary. *Want it in context before being asked* → `OS/memory/`.
*Want to look it up* → `python remember.py`.

## Setup still outstanding

1. **Install the brain**, natively in PowerShell (not over a network mount):
   ```
   cd second-brain
   python install.py --dry-run
   python install.py
   ```
2. **Rebuild the home page** once: `python OS/build_home.py --open`
3. **Schedule one routine.** `weekly-upkeep` first — it is the only one whose absence compounds.

## The four tests

From the guide's checklist. Ticked live on `HOME.html`.

| | Test |
|---|---|
| **A** | One home page open every morning; every weekly tool one click away |
| **R** | At least one piece of work shows up on time without being asked |
| **M** | A brand-new conversation answers "what am I working on?" correctly |
| **S** | One line gets a full deliverable, the same way every time |

## Keeping it alive

Fifteen minutes on Friday: `routines/weekly-upkeep.md`. Prune the `fact` notes, promote
anything asked three times into a skill, reindex the brain, rebuild this page.

Stale memory is worse than no memory, because it gets acted on with confidence.
