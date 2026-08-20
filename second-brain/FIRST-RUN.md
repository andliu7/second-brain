# First run

```
cd second-brain
python install.py --dry-run     # see what it would touch
python install.py               # write brain.json, patch CLAUDE.md, install /brain skill, index
python q.py "what did i decide about X"
```

Run this in **PowerShell on your own machine**, not over a network share. Indexing walks every
file once; a slow filesystem is the only thing that makes it slow. `python3` on some setups.

## Read this before you trust the numbers

`RESULTS.md` is the honest scorecard, including the part where the first benchmark was rigged in
this system's own favour and had to be rebuilt. The real figure against a fresh agentic session is
about **4x fewer tokens at 26/27 correct**, not the 20x the first harness reported.

## What to do about your workspace specifically

Your folders are almost entirely source code — `CampusDisciples`, `IdeaProjects/untitled`, the
css/js portfolio, the eclipse school projects, and ~848 files in Downloads. There is essentially
no notes layer, and the notes layer is where a second brain earns most of its keep: the highest
value rows in the index are the ones you wrote on purpose.

Two things worth doing in the first week:

1. **Write decisions down as you make them.** `python remember.py "chose X over Y because Z"
   --kind decision`. Ten of these and the index starts paying for itself. Prefer feedback that
   survives a refactor ("never mock the DB in integration tests") over facts that rot ("uses
   Postgres 16").
2. **Put a `NOTES.md` at the root of each project** with the three or four things you would have
   to re-derive in six months — why this library, what breaks the build, what the deploy actually
   is. Headings are weighted 3x, so write headings in the words you would ask the question in.

Until then, expect the brain to beat a default session mostly on code-structure questions
("what methods does X have") and to be roughly a wash on everything else. That is not a defect;
it is what an index over a corpus with nothing hand-written in it can do.

## Tuning

`brain.json` is yours to edit. The `weight` per folder is a plain multiplier — `eclipse-workspace`
ships at 0.7 on the assumption that old coursework is rarely the answer, and `Downloads` at 0.45.
If a real answer keeps losing to a note that merely mentions the topic, that is the knob.

The synonym map lives at the top of `brainlib.py`. It is hand-written, query-time only, and
editing it does **not** require a reindex. Add the words you actually ask with.
