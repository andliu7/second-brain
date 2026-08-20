"""install.py - set the brain up on THIS machine. Run once.

  python install.py                      detect roots under your home, write brain.json, index
  python install.py --dry-run            show what it would do
  python install.py --root "C:/x" --root "C:/y"    choose roots explicitly

Detects Windows vs POSIX, writes a brain.json with sane per-folder weights, drops the routing
note into your Claude Code CLAUDE.md, installs the /brain skill, and runs the first index.
Stdlib only. Nothing to install, no server, no daemon.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BRAIN_DIR = Path(__file__).resolve().parent

# folder name -> (context note, score weight). Longest path prefix wins at query time.
PROFILE = {
    "notes":               ("Personal notes: how I work, decisions, reading.", 1.35),
    "Documents":           ("Documents.", 1.15),
    "IdeaProjects":        ("IntelliJ Java projects.", 1.10),
    "AndroidStudioProjects": ("Android Studio projects, Kotlin.", 1.15),
    "portfolio":           ("Personal web portfolio.", 1.00),
    "eclipse-workspace":   ("Legacy university Java work. Rarely the answer.", 0.70),
    "Downloads":           ("Unsorted downloads. Low trust - prefer any other source.", 0.45),
}
LOW_TRUST = {"Downloads"}

ROUTING_NOTE = """<!-- second-brain:start -->
## Memory: check the index before you search

This workspace has a second brain at `{brain}`. Before using Glob/Grep/Read to answer a
question about my files, notes, decisions or preferences, run:

    python "{brain}/q.py" "<the question>"

It prints an evidence bundle in ~50-150ms: `BRAIN <path>#<section> [flags score/margin]`, an
optional `~ <context note>` line, then the evidence. Answer from that bundle alone and cite the
path and section. Flags: E/I/A = extracted/inferred/ambiguous, W = widened over near-tied
sections, S = code declaration skeleton (rerun with `--full` for method bodies).

If it prints `BRAIN: no section ... matches`, then and only then fall back to Grep/Read.
Add `--trace` when the answer looks wrong - it prints the runners-up and their scores.

To save something worth remembering:

    python "{brain}/remember.py" "<the fact>" --kind decision|pref|gotcha|fact --tags a,b

Prefer feedback over facts: "never mock the DB in integration tests" outlives "uses Postgres 16".
Never run a full reindex on my behalf - print the command (`python "{brain}/idx.py"`) and let me.
<!-- second-brain:end -->
"""


def detect_roots(home: Path) -> list[Path]:
    found = []
    for name in PROFILE:
        p = home / name
        if p.is_dir():
            found.append(p)
    for extra in ("notes", "Notes", "vault", "Obsidian"):
        p = home / "Documents" / extra
        if p.is_dir() and p not in found:
            found.append(p)
    return found


def build_config(roots: list[Path]) -> dict:
    ctx = {}
    low = []
    for r in roots:
        note, weight = PROFILE.get(r.name, (f"{r.name}.", 1.0))
        ctx[str(r).replace("\\", "/")] = {"note": note, "weight": weight}
        if r.name in LOW_TRUST:
            low.append(str(r).replace("\\", "/"))
    mem = BRAIN_DIR / "memories"
    ctx[str(mem).replace("\\", "/")] = {
        "note": "Memories I explicitly saved: decisions, preferences, gotchas.", "weight": 1.5}
    return {
        "roots": [str(r).replace("\\", "/") for r in roots] + [str(mem).replace("\\", "/")],
        "context": ctx,
        "low_trust_dirs": low,
    }


def patch_claude_md(path: Path, note: str, dry: bool) -> str:
    START, END = "<!-- second-brain:start -->", "<!-- second-brain:end -->"
    old = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    if START in old and END in old:
        head = old[: old.index(START)]
        tail = old[old.index(END) + len(END):]
        new = head + note.strip() + tail
        action = "updated"
    else:
        new = (old.rstrip() + "\n\n" + note.strip() + "\n") if old.strip() else note.strip() + "\n"
        action = "appended to" if old.strip() else "created"
    if not dry:
        path.parent.mkdir(parents=True, exist_ok=True)
        # UTF-8 WITHOUT a BOM, LF endings. A BOM here is how PowerShell-written
        # config files break tools that read the first line.
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
    return action


SKILL = """---
name: brain
description: >
  Answer a question about Andrew's own files, projects, notes, past decisions or preferences by
  querying the local second-brain index instead of searching the filesystem. Use for "what did I
  decide about X", "how do I deploy Y", "what's my preference for Z", "where is X in my projects",
  and to save a new memory. Do not use for questions about the outside world.
---

# Second brain

Retrieval is deterministic code. You are invoked once, at the end, with the evidence attached.

## Answering a question

Run exactly this, then answer from the output alone:

```
python "{brain}/q.py" "<the user's question>"
```

Output shape:

```
BRAIN <abs path>#<section heading>  [flags score/margin]
~ <what this folder contains>          (optional)
<the evidence>
BRAIN-HOP <path>#<section>             (optional, at most one)
<the pointed-to evidence>
```

Flags: `E`/`I`/`A` = extracted / inferred / ambiguous (A means the scorer is guessing - say so).
`W` = widened across near-tied sections. `S` = code declaration skeleton; rerun with `--full`
if the user needs method bodies.

Cite the path and section. If the bundle does not answer the question, say so plainly and rerun
with better keywords plus `--trace` rather than inventing an answer. Only fall back to Grep/Read
after `q.py` reports no match.

Useful flags: `--scope <substring>` to restrict to one project, `--cap brief|normal|wide`,
`--trace` to see the runners-up when a pick looks wrong.

## Saving a memory

```
python "{brain}/remember.py" "<the fact>" --kind decision|pref|gotcha|fact --tags a,b
```

Writes the file and its index line in one step. Prefer feedback that survives refactors
("never mock the DB in integration tests") over facts that rot ("uses Postgres 16").

## Never

Never run `idx.py` (a full reindex) on the user's behalf - print the command and let them run it.
Single-file repair is automatic and happens inside `q.py`; you never trigger it manually.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--claude-md", default=None)
    ap.add_argument("--no-index", action="store_true")
    a = ap.parse_args()

    home = Path.home()
    roots = [Path(r).expanduser().resolve() for r in a.root] if a.root else detect_roots(home)
    roots = [r for r in roots if r.is_dir()]
    if not roots:
        print(f"No roots found under {home}. Pass --root explicitly.", file=sys.stderr)
        return 2

    brain_str = str(BRAIN_DIR).replace("\\", "/")
    cfg = build_config(roots)

    print(f"brain     : {brain_str}")
    print(f"python    : {sys.executable}")
    print("roots     :")
    for r in roots:
        note, weight = PROFILE.get(r.name, (f"{r.name}.", 1.0))
        print(f"   {weight:>4.2f}  {r}   ({note})")

    if not a.dry_run:
        (BRAIN_DIR / "memories").mkdir(exist_ok=True)
        with open(BRAIN_DIR / "brain.json", "w", encoding="utf-8", newline="\n") as f:
            json.dump(cfg, f, indent=1)
        print(f"wrote     : {BRAIN_DIR / 'brain.json'}")

    md = Path(a.claude_md) if a.claude_md else home / ".claude" / "CLAUDE.md"
    action = patch_claude_md(md, ROUTING_NOTE.format(brain=brain_str), a.dry_run)
    print(f"routing   : {action} {md}")

    skill_dir = home / ".claude" / "skills" / "brain"
    if not a.dry_run:
        skill_dir.mkdir(parents=True, exist_ok=True)
        with open(skill_dir / "SKILL.md", "w", encoding="utf-8", newline="\n") as f:
            f.write(SKILL.format(brain=brain_str))
    print(f"skill     : {skill_dir / 'SKILL.md'}")

    if a.dry_run:
        print("\n(dry run - nothing written)")
        return 0
    if a.no_index:
        print(f"\nNow run:  python \"{brain_str}/idx.py\" --stats")
        return 0
    print("\nindexing (this is the slow part, and it only happens when you ask for it)...")
    subprocess.run([sys.executable, str(BRAIN_DIR / "idx.py"), "--stats"], check=False)
    print("\nTry it:")
    print(f'  python "{brain_str}/q.py" "what did i decide about X"')
    print(f'  python "{brain_str}/bench.py"      # prove it beats the alternatives')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
