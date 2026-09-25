"""hits.py - does q.py put the gold file first? No model, no cost, seconds to run.

The two-arm gauntlet (run.mjs) is the real test, but it spends dollars and minutes. This
is the deterministic half: for every question in questions.json, run q.py exactly as a
session would, and check whether the gold file is the first BRAIN line, appears anywhere
in the bundle (BRAIN-ALSO and the ambiguous runners-up), or is missing. Rerun after any
change to q.py, brainlib.py or brain.json and compare the last line.

    python bench\\hits.py            # table plus the summary line
    python bench\\hits.py --json     # machine-readable
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRAIN = HERE.parent
PROJECTS = BRAIN.parent.parent            # .../Projects, what goldPath is relative to
Q = sys.executable
PATH_LINE = re.compile(r"^(?:BRAIN|BRAIN-ALSO)\s+(\S+?)#|^~\s{3}(\S+?)#")


def paths_in(bundle: str) -> list[str]:
    """Every file the bundle names, in the order it names them, deduplicated."""
    out = []
    for line in bundle.splitlines():
        m = PATH_LINE.match(line)
        if not m:
            continue
        p = (m.group(1) or m.group(2)).replace("\\", "/")
        if p not in out:
            out.append(p)
    return out


def accepted(q: dict) -> list[str]:
    rel = [q["goldPath"]] + list(q.get("alsoAcceptPaths") or [])
    # goldPath is relative to Projects/, except "Projects/CLAUDE.md" which names it outright.
    return [str(PROJECTS / r.removeprefix("Projects/")).replace("\\", "/").casefold() for r in rel]


def main() -> int:
    as_json = "--json" in sys.argv
    qs = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))
    qs = qs["questions"] if isinstance(qs, dict) else qs
    rows = []
    for q in qs:
        t = time.perf_counter()
        r = subprocess.run([Q, str(BRAIN / "q.py"), "--trace", q["question"]], capture_output=True, text=True, encoding="utf-8", errors="replace")
        dt = time.perf_counter() - t
        found = paths_in(r.stdout)
        gold = accepted(q)
        rank = next((i + 1 for i, p in enumerate(found) if p.casefold() in gold), None)
        rows.append({"id": q["id"], "indexed": q.get("indexedInBrain"), "rank": rank, "seconds": round(dt, 2), "top": found[0] if found else None})
    first = sum(1 for r in rows if r["rank"] == 1)
    anywhere = sum(1 for r in rows if r["rank"])
    if as_json:
        print(json.dumps({"rows": rows, "first": first, "anywhere": anywhere, "n": len(rows)}, indent=1))
        return 0
    for r in rows:
        where = "FIRST" if r["rank"] == 1 else f"#{r['rank']}" if r["rank"] else "miss"
        print(f"{r['id']:34} {'idx' if r['indexed'] else '   '} {where:6} {r['seconds']:5.2f}s  {(r['top'] or '').split('/Projects/')[-1][:70]}")
    print(f"\ngold first {first}/{len(rows)}, gold anywhere in bundle {anywhere}/{len(rows)}, "
          f"median {sorted(r['seconds'] for r in rows)[len(rows) // 2]:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
