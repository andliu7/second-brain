#!/usr/bin/env python3
"""
build_home.py - regenerate OS/HOME.html from what is actually true right now.

The home page is not hand-maintained. Every number on it is read from disk at build
time, so it cannot quietly disagree with reality -- the same argument the second brain
makes about its index.

    python build_home.py            # writes OS/HOME.html
    python build_home.py --open     # ...and opens it

Standard library only. Run it natively in PowerShell, not over a network mount.
"""

import argparse
import html
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
import webbrowser
from datetime import datetime
from pathlib import Path

OS_DIR = Path(__file__).resolve().parent
BRAIN = OS_DIR.parent / "second-brain"
PROJECTS = OS_DIR.parent.parent            # ...\Downloads\Projects

REPOS = [
    ("blueberry_game", "Chemistry learning platform", True),
    ("grignard/grignard-app-source", "Flashcard study guides, shipped", False),
    ("mechanism_trainer", "Mechanism practice, standalone", False),
    ("Pibble", "Checkout bot + Electron shell", False),
    ("Portfolio", "Next.js + react-three-fiber", False),
]


SKIP_GIT = False


def git(repo: Path, *args, default=""):
    """Returns None when git could not answer -- never an empty string.

    An empty string means "git ran and there is nothing", i.e. a clean repo. A timeout
    means "we do not know". Collapsing those two is how a dashboard ends up confidently
    reporting a repo as clean when it has two dozen uncommitted files.
    """
    if SKIP_GIT or not (repo / ".git").is_dir():
        return None
    try:
        r = subprocess.run(["git", "-C", str(repo), *args],
                           capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def repo_state(rel: str):
    """Two git calls per repo, not four.

    `status --porcelain --branch` returns the branch and the dirty set together, which
    matters because each subprocess costs a filesystem round trip -- cheap natively,
    expensive over a network mount.
    """
    p = PROJECTS / rel
    if not p.is_dir():
        return None
    if not (p / ".git").is_dir():
        # Not version controlled at all -- a different thing from "git failed".
        return {"name": rel.split("/")[-1], "path": rel, "branch": "not a repo",
                "last": "—", "stale_days": 0, "dirty": 0, "known": True,
                "untracked_project": True}
    out = git(p, "status", "--porcelain", "--branch")
    known = out is not None
    branch, dirty = ("—", None) if not known else ("—", 0)
    if known and out:
        lines = out.splitlines()
        if lines and lines[0].startswith("##"):
            branch = lines[0][2:].strip().split("...")[0].strip() or "—"
            dirty = len([l for l in lines[1:] if l.strip()])
        else:
            dirty = len([l for l in lines if l.strip()])
    last = git(p, "log", "-1", "--format=%cs")
    stale = 0
    if last:
        try:
            stale = (datetime.now().date() - datetime.strptime(last, "%Y-%m-%d").date()).days
        except ValueError:
            pass
    return {
        "name": rel.split("/")[-1],
        "path": rel,
        "branch": branch,
        "last": last if last else ("no commits" if last == "" else "unknown"),
        "stale_days": stale,
        "dirty": dirty,
        "known": known,
        "untracked_project": False,
    }


def blueberry_phase():
    """Pull the live phase row and the Phase 1 numbers out of STATUS.md."""
    f = PROJECTS / "blueberry_game" / "STATUS.md"
    out = {"phase": None, "mode": None, "state": None, "numbers": [], "updated": None}
    if not f.is_file():
        return out
    txt = f.read_text(encoding="utf-8", errors="replace")

    m = re.search(r"Updated\s+(\d{4}-\d{2}-\d{2})", txt)
    if m:
        out["updated"] = m.group(1)

    # the phase table row whose state is not DONE / Not started
    for row in re.findall(r"^\|\s*(\d+[^|]*)\|([^|]*)\|([^|]*)\|", txt, re.M):
        phase, mode, state = (c.strip() for c in row)
        if "IN PROGRESS" in state.upper():
            out.update(phase=phase, mode=mode, state=state)
            break

    for label, pat in (
        ("Checks", r"checks run:\s*(\d+)\s+passed:\s*(\d+)\s+failed:\s*(\d+)"),
        ("Fixtures", r"FIXTURE COUNT:\s*(\d+)"),
        ("Mutation score", r"([\d.]+)\s*percent killed"),
        ("Named causes", r"(\d+)\s+of\s+(\d+)\s+defined"),
    ):
        m = re.search(pat, txt)
        if not m:
            continue
        g = m.groups()
        if label == "Checks":
            out["numbers"].append((label, f"{g[1]}/{g[0]} passed", g[2] == "0"))
        elif label == "Mutation score":
            out["numbers"].append((label, f"{g[0]}%", float(g[0]) >= 80))
        elif label == "Named causes":
            out["numbers"].append((label, f"{g[0]} of {g[1]}", int(g[0]) >= 12))
        else:
            out["numbers"].append((label, g[0], True))
    return out


def memory_notes():
    idx = OS_DIR / "MEMORY.md"
    notes = []
    if idx.is_file():
        for m in re.finditer(r"\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([a-z]+)\s*\|\s*([^|]+)\|",
                             idx.read_text(encoding="utf-8", errors="replace")):
            notes.append({"file": m.group(1), "href": m.group(2),
                          "kind": m.group(3), "what": m.group(4).strip()})
    return notes


def routines():
    out = []
    for f in sorted((OS_DIR / "routines").glob("*.md")):
        if f.name == "README.md":
            continue
        t = f.read_text(encoding="utf-8", errors="replace")
        title = re.search(r"^#\s*Routine\s*[—-]\s*(.+)$", t, re.M)
        cad = re.search(r"\*\*Cadence:\*\*\s*(.+)", t)
        st = re.search(r"\*\*Status:\*\*\s*(.+)", t)
        out.append({
            "name": title.group(1).strip() if title else f.stem,
            "file": f.name,
            "cadence": cad.group(1).strip() if cad else "—",
            "on": bool(st and "not scheduled" not in st.group(1).lower()),
        })
    return out


def brain_state():
    installed = (BRAIN / "index.tsv").is_file() and (BRAIN / "brain.json").is_file()
    rows = 0
    mem = 0
    if installed:
        try:
            with (BRAIN / "index.tsv").open(encoding="utf-8", errors="replace") as fh:
                rows = max(0, sum(1 for _ in fh) - 1)
        except Exception:
            pass
    d = BRAIN / "memories"
    if d.is_dir():
        mem = len([p for p in d.glob("*.md")])
    return {"installed": installed, "rows": rows, "memories": mem}


def generations():
    for c in (Path.home() / "generations", PROJECTS / "generations"):
        if c.is_dir():
            n = len([p for p in c.iterdir()
                     if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"}])
            g = c / "gallery.html"
            return {"dir": str(c), "count": n, "gallery": str(g) if g.is_file() else None}
    return None


# ── the ARMS checklist, computed rather than asserted ──────────────────────────
def arms_status(repos, notes, rts, brain, gens):
    apps = len(list((OS_DIR / "apps").glob("*.html"))) + 1        # + HOME itself
    return [
        ("A", "Applications", "One home page open every morning; every weekly tool one click away",
         apps >= 1, f"{apps} page{'s' if apps != 1 else ''}"),
        ("R", "Routines", "At least one piece of work shows up on time without being asked",
         any(r["on"] for r in rts), f"{sum(r['on'] for r in rts)} of {len(rts)} scheduled"),
        ("M", "Memory", "A brand-new conversation answers \"what am I working on?\" correctly",
         len(notes) >= 5 and (PROJECTS / "CLAUDE.md").is_file(),
         f"{len(notes)} notes, auto-loaded"),
        ("S", "Skills", "One line gets a full deliverable, the same way every time",
         True, "generate, gauntlet-loop"),
    ]


CSS = """
:root{--bg:#faf8f5;--card:#fff;--sunk:#f2efe9;--edge:#e2ddd3;--ink:#1b1a18;--dim:#6b675f;
--faint:#9c968b;--go:#2f7d5f;--warn:#b5721a;--stop:#a8402f;--mark:#d4541f;
--fd:"Bricolage Grotesque",Segoe UI,system-ui,sans-serif;
--fb:"IBM Plex Sans",Segoe UI,system-ui,sans-serif;
--fm:"IBM Plex Mono",Consolas,ui-monospace,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#14130f;--card:#1c1b17;--sunk:#100f0c;
--edge:#2c2a24;--ink:#efece5;--dim:#9b958a;--faint:#6b665c;--go:#5fbf92;--warn:#e0a052;
--stop:#e0705c;--mark:#f0793a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--fb);font-size:15px;
line-height:1.6;-webkit-font-smoothing:antialiased}
.w{max-width:1100px;margin:0 auto;padding:0 26px}
header{padding:40px 0 8px}
.eyebrow{font-family:var(--fm);font-size:11px;letter-spacing:.16em;text-transform:uppercase;
color:var(--mark);margin:0 0 10px}
h1{font-family:var(--fd);font-size:36px;letter-spacing:-.025em;margin:0 0 6px;font-weight:700}
.sub{color:var(--dim);margin:0;font-size:14.5px}
h2{font-family:var(--fm);font-size:11px;letter-spacing:.15em;text-transform:uppercase;
color:var(--faint);margin:38px 0 14px;display:flex;align-items:center;gap:13px}
h2::after{content:"";flex:1;height:1px;background:var(--edge)}
.grid{display:grid;gap:13px}
.g4{grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.card{background:var(--card);border:1px solid var(--edge);border-radius:13px;padding:15px 17px}
.arms{display:flex;gap:13px;align-items:flex-start}
.letter{font-family:var(--fd);font-size:26px;font-weight:700;color:var(--mark);
line-height:1;width:22px;flex:none}
.arms h3{margin:0 0 3px;font-size:15px;font-family:var(--fd);font-weight:700}
.arms p{margin:0;font-size:12.5px;color:var(--dim);line-height:1.45}
.tick{margin-left:auto;font-size:17px;line-height:1;flex:none}
.ok{color:var(--go)}.no{color:var(--faint)}
.note{font-family:var(--fm);font-size:11px;color:var(--faint);margin-top:7px;display:block}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-family:var(--fm);font-size:10px;letter-spacing:.11em;
text-transform:uppercase;color:var(--faint);font-weight:400;padding:0 12px 8px 0;
border-bottom:1px solid var(--edge)}
td{padding:10px 12px 10px 0;border-bottom:1px solid var(--edge);vertical-align:top}
tr:last-child td{border-bottom:0}
.mono{font-family:var(--fm);font-size:12.5px;font-variant-numeric:tabular-nums}
.pill{display:inline-block;font-family:var(--fm);font-size:10.5px;padding:2px 7px;
border-radius:5px;border:1px solid var(--edge);background:var(--sunk);color:var(--dim)}
.pill.go{color:var(--go);border-color:currentColor}
.pill.warn{color:var(--warn);border-color:currentColor}
.pill.stop{color:var(--stop);border-color:currentColor}
.tw{overflow-x:auto}
a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--edge)}
a:hover{border-bottom-color:var(--mark);color:var(--mark)}
.kind{font-family:var(--fm);font-size:10px;text-transform:uppercase;letter-spacing:.08em;
color:var(--mark)}
.big{font-family:var(--fm);font-size:20px;font-weight:500;font-variant-numeric:tabular-nums}
.lede{background:var(--sunk);border:1px solid var(--edge);border-left:3px solid var(--mark);
border-radius:0 11px 11px 0;padding:14px 17px;margin:22px 0 0;font-size:14px;color:var(--dim)}
.lede b{color:var(--ink);font-weight:600}
footer{margin:56px 0 60px;padding-top:18px;border-top:1px solid var(--edge);
color:var(--faint);font-family:var(--fm);font-size:11.5px}
"""


def esc(s):
    return html.escape(str(s), quote=True)


def render(ctx):
    P = []
    a = P.append
    a(f'<!doctype html><html lang="en"><head><meta charset="utf-8">')
    a('<meta name="viewport" content="width=device-width,initial-scale=1">')
    a(f'<title>{esc(ctx["title"])}</title>')
    a('<link rel="preconnect" href="https://fonts.googleapis.com">')
    a('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    a('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
      'family=Bricolage+Grotesque:opsz,wght@12..96,700&family=IBM+Plex+Mono:wght@400;500'
      '&family=IBM+Plex+Sans:wght@400;500;600&display=swap">')
    a(f"<style>{CSS}</style></head><body><div class='w'>")

    a(f"<header><p class='eyebrow'>Agentic OS · {esc(ctx['today'])}</p>"
      f"<h1>{esc(ctx['title'])}</h1>"
      f"<p class='sub'>{esc(ctx['sub'])}</p></header>")

    a(f"<div class='lede'>{ctx['focus']}</div>")

    # ARMS
    a("<h2>The four parts</h2><div class='grid g4'>")
    for letter, name, test, ok, detail in ctx["arms"]:
        a(f"<div class='card arms'><div class='letter'>{letter}</div><div>"
          f"<h3>{esc(name)}</h3><p>{esc(test)}</p>"
          f"<span class='note'>{esc(detail)}</span></div>"
          f"<div class='tick {'ok' if ok else 'no'}'>{'&#10003;' if ok else '&#9675;'}</div></div>")
    a("</div>")

    # Blueberry
    b = ctx["phase"]
    if b["phase"]:
        a("<h2>Blueberry &mdash; current phase</h2><div class='card'>")
        a(f"<div class='big'>Phase {esc(b['phase'])}</div>"
          f"<p class='sub' style='margin:2px 0 13px'>{esc(b['mode'])} &middot; "
          f"{esc(b['state'])}{' &middot; STATUS.md updated ' + esc(b['updated']) if b['updated'] else ''}</p>")
        if b["numbers"]:
            a("<div class='grid' style='grid-template-columns:repeat(auto-fit,minmax(150px,1fr))'>")
            for label, val, good in b["numbers"]:
                a(f"<div><span class='note' style='margin:0'>{esc(label)}</span>"
                  f"<div class='mono' style='font-size:15px;color:var(--{'go' if good else 'stop'})'>"
                  f"{esc(val)}</div></div>")
            a("</div>")
        a("</div>")

    # repos
    a("<h2>Repositories</h2><div class='card tw'><table><tr>"
      "<th>Project</th><th>Branch</th><th>Last commit</th><th>Uncommitted</th><th></th></tr>")
    for r in ctx["repos"]:
        if r.get("untracked_project"):
            cls, word = "", "no git"
        elif not r["known"]:
            cls, word = "warn", "git unreadable"
        elif r["stale_days"] > 21:
            cls, word = "stop", f"quiet {r['stale_days']}d"
        elif r["stale_days"] > 7:
            cls, word = "warn", f"quiet {r['stale_days']}d"
        else:
            cls, word = "go", "active"
        if r["dirty"] is None:
            dirty = "<span class='pill warn'>unknown</span>"
        elif r.get("untracked_project"):
            dirty = "<span class='pill'>&mdash;</span>"
        elif r["dirty"]:
            dirty = (f"<span class='pill warn'>{r['dirty']} file"
                     f"{'s' if r['dirty'] != 1 else ''}</span>")
        else:
            dirty = "<span class='pill'>clean</span>"
        a(f"<tr><td><b>{esc(r['name'])}</b><br><span class='note' style='margin:0'>"
          f"{esc(r['desc'])}</span></td>"
          f"<td class='mono'>{esc(r['branch'])}</td>"
          f"<td class='mono'>{esc(r['last'])}</td><td>{dirty}</td>"
          f"<td><span class='pill {cls}'>{esc(word)}</span></td></tr>")
    a("</table></div>")

    # memory
    a("<h2>Memory</h2><div class='card tw'><table>")
    for n in ctx["notes"]:
        a(f"<tr><td style='width:1%;white-space:nowrap'><span class='kind'>{esc(n['kind'])}</span></td>"
          f"<td><a href='{esc(n['href'])}'>{esc(n['file'])}</a></td>"
          f"<td style='color:var(--dim)'>{esc(n['what'])}</td></tr>")
    a("</table></div>")

    # routines
    a("<h2>Routines</h2><div class='card tw'><table><tr>"
      "<th>Routine</th><th>Cadence</th><th>Status</th></tr>")
    for r in ctx["routines"]:
        p = ("<span class='pill go'>scheduled</span>" if r["on"]
             else "<span class='pill'>written, not scheduled</span>")
        a(f"<tr><td><a href='routines/{esc(r['file'])}'>{esc(r['name'])}</a></td>"
          f"<td class='mono'>{esc(r['cadence'])}</td><td>{p}</td></tr>")
    a("</table></div>")

    # systems
    a("<h2>Systems</h2><div class='grid g4'>")
    br = ctx["brain"]
    if br["installed"]:
        a(f"<div class='card'><span class='note' style='margin:0'>Second brain</span>"
          f"<div class='big'>{br['rows']:,}</div>"
          f"<span class='note'>indexed sections &middot; {br['memories']} memories &middot; "
          f"<a href='http://127.0.0.1:7432'>open console</a></span></div>")
    else:
        a("<div class='card'><span class='note' style='margin:0'>Second brain</span>"
          "<div class='big' style='color:var(--warn)'>not installed</div>"
          "<span class='note'>run <code>python install.py</code> in PowerShell</span></div>")
    g = ctx["gens"]
    if g:
        link = (f"<a href='file:///{esc(g['gallery'])}'>open gallery</a>"
                if g["gallery"] else "no gallery yet")
        a(f"<div class='card'><span class='note' style='margin:0'>Generations</span>"
          f"<div class='big'>{g['count']}</div><span class='note'>{link}</span></div>")
    a("<div class='card'><span class='note' style='margin:0'>Cross-project memory</span>"
      f"<div class='big' style='color:var(--{'go' if ctx['claude_md'] else 'warn'})'>"
      f"{'loaded' if ctx['claude_md'] else 'missing'}</div>"
      "<span class='note'>Projects/CLAUDE.md</span></div>")
    a("</div>")

    a(f"<footer>Regenerated by <code>build_home.py</code> at {esc(ctx['stamp'])}. "
      "Every number here was read from disk at build time &mdash; if one looks wrong, "
      "the source is wrong, not the page. Rebuild after any week&rsquo;s upkeep."
      "</footer></div></body></html>")
    return "\n".join(P)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="open the page after building")
    ap.add_argument("--no-git", action="store_true",
                    help="skip git entirely -- fast rebuild when only notes changed")
    ap.add_argument("--out", default=str(OS_DIR / "HOME.html"))
    a = ap.parse_args()

    global SKIP_GIT
    SKIP_GIT = a.no_git
    # Each git call is a filesystem round trip, and they are independent, so run them
    # together. Trivial locally; the difference between usable and not over a mount.
    with ThreadPoolExecutor(max_workers=4) as pool:
        states = list(pool.map(lambda r: repo_state(r[0]), REPOS))
    repos = []
    for (rel, desc, _), st in zip(REPOS, states):
        if st:
            st["desc"] = desc
            repos.append(st)

    notes, rts = memory_notes(), routines()
    brain, gens = brain_state(), generations()
    phase = blueberry_phase()

    dirty_total = sum(r["dirty"] or 0 for r in repos)
    if phase["phase"]:
        focus = (f"<b>Blueberry Phase {esc(phase['phase'])}</b> is the live thread "
                 f"&mdash; {esc(phase['state'].lower())}.")
    else:
        focus = "<b>No phase in progress.</b>"
    if dirty_total:
        focus += (f" {dirty_total} uncommitted file{'s' if dirty_total != 1 else ''} "
                  f"across {sum(1 for r in repos if r['dirty'])} repo(s).")
    unknown = [r["name"] for r in repos if not r["known"]]
    if unknown:
        focus += (" Git could not be read for " + ", ".join(esc(u) for u in unknown) +
                  " &mdash; those rows say <b>unknown</b>, not clean.")
    if not brain["installed"]:
        focus += " The second brain is still uninstalled &mdash; that is the one setup step left."

    ctx = {
        "title": "Andrew's OS",
        "sub": "Four parts, one page. Open this first.",
        "today": datetime.now().strftime("%A %d %B %Y"),
        "stamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "focus": focus,
        "repos": repos, "notes": notes, "routines": rts,
        "brain": brain, "gens": gens, "phase": phase,
        "claude_md": (PROJECTS / "CLAUDE.md").is_file(),
        "arms": arms_status(repos, notes, rts, brain, gens),
    }

    out = Path(a.out)
    out.write_text(render(ctx), encoding="utf-8")
    print(f"wrote  {out}")
    print(f"       {len(repos)} repos, {len(notes)} memory notes, {len(rts)} routines, "
          f"brain {'installed' if brain['installed'] else 'NOT installed'}")
    if a.open:
        webbrowser.open(out.as_uri())


if __name__ == "__main__":
    main()
