#!/usr/bin/env python3
"""
build_home.py - regenerate OS/HOME.html from what is actually true right now.

The home page is not hand-maintained. Every number on it is read from disk at build
time, so it cannot quietly disagree with reality -- the same argument the second brain
makes about its index.

    python build_home.py            # writes OS/HOME.html
    python build_home.py --open     # ...and opens it
    python build_home.py --json     # prints the same data as JSON, writes nothing

Standard library only. Run it natively in PowerShell, not over a network mount.

Visual system: Dala (dark void + Electric Iris violet + Saffron Spark amber).
PPNeueMontreal is not a licensable web font, so Inter stands in for it per the
reference guide's own fallback note -- weight 200 body / weight 400 display are
kept, which is the part of the system that actually carries the identity.
"""

import argparse
import html
import json
import random
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
SCHOOL = PROJECTS / "school"
SKILLS_DIR = Path.home() / ".claude" / "skills"
BLUEBERRY_STATUS = PROJECTS / "grignard" / "grignard-app-source" / "documentation" / "STATUS.md"

REPOS = [
    ("grignard/grignard-app-source", "Blueberry: the site and the learning game, live", True),
    ("blueberry_game", "Frozen reference: design images and the gauntlet harness", False),
    ("mechanism_trainer", "Mechanism practice, standalone", False),
    ("Pibble", "Checkout bot + Electron shell", False),
    ("Portfolio", "Next.js + react-three-fiber", False),
    ("second-brain", "This OS: engine, console, launcher, home page", False),
    ("dashboard", "Life app: notes, food, workouts, goals, tasks", False),
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


def blueberry_status(limit=4):
    """The newest dated headings in Blueberry's STATUS.md.

    Since the 2026-09-08 merge the live STATUS.md has no phase table: it is a stack of
    sections headed "## <what happened>, YYYY-MM-DD", newest first. So the page shows
    those headings, which is what the file itself leads with.
    """
    out = {"updated": None, "entries": [], "found": BLUEBERRY_STATUS.is_file()}
    if not out["found"]:
        return out
    txt = BLUEBERRY_STATUS.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"Updated\s+(\d{4}-\d{2}-\d{2})", txt)
    if m:
        out["updated"] = m.group(1)
    for m in re.finditer(r"^##\s+(.+?),\s*(\d{4}-\d{2}-\d{2})\s*$", txt, re.M):
        # The entry's text runs to the next "## " heading, dated or not.
        nxt = re.search(r"^##\s", txt[m.end():], re.M)
        body = txt[m.end():m.end() + nxt.start()] if nxt else txt[m.end():]
        out["entries"].append({"what": m.group(1).strip(), "date": m.group(2),
                               "body": body.strip()})
        if len(out["entries"]) >= limit:
            break
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


def courses():
    """One entry per folder in Projects/school, one project per folder inside it.

    Nothing is listed by hand: a new project shows up here the next time the page is
    rebuilt, because the folder is the registration.
    """
    out = []
    if not SCHOOL.is_dir():
        return out
    for c in sorted(p for p in SCHOOL.iterdir() if p.is_dir() and not p.name.startswith(".")):
        title = ""
        md = c / "CLAUDE.md"
        if md.is_file():
            m = re.search(r"^#\s+(.+)$", md.read_text(encoding="utf-8", errors="replace"), re.M)
            title = m.group(1).strip() if m else ""
        projects = []
        for p in sorted(x for x in c.iterdir() if x.is_dir() and not x.name.startswith(".")):
            st = repo_state(f"school/{c.name}/{p.name}")
            if st:
                st["desc"] = ""
                projects.append(st)
        out.append({"name": c.name, "title": title, "projects": projects})
    return out


def _frontmatter_field(text, key):
    """Read one field from a SKILL.md YAML header without a YAML library.

    Handles the three shapes the installed skills use: `key: value`, a quoted value,
    and a `|` or `>` block whose lines are indented below the key.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            break
        if not line.startswith(key + ":"):
            continue
        value = line[len(key) + 1:].strip()
        if value in ("", "|", ">", "|-", ">-"):
            block = []
            for nxt in lines[i + 1:]:
                if nxt.strip() == "---" or (nxt and not nxt[0].isspace()):
                    break
                block.append(nxt.strip())
            value = " ".join(b for b in block if b)
        return value.strip().strip("'\"")
    return ""


def skills():
    """Every skill installed on this machine, with the text of its docs.

    Account skills on claude.ai are not on disk, so they cannot be listed here.
    """
    out = []
    if not SKILLS_DIR.is_dir():
        return out
    for d in sorted(p for p in SKILLS_DIR.iterdir() if p.is_dir()):
        main = d / "SKILL.md"
        if not main.is_file():
            continue
        text = main.read_text(encoding="utf-8", errors="replace")
        docs = [("SKILL.md", text)]
        readme = d / "README.md"
        if readme.is_file():
            docs.append(("README.md", readme.read_text(encoding="utf-8", errors="replace")))
        files = sorted(str(f.relative_to(d)).replace("\\", "/")
                       for f in d.rglob("*") if f.is_file())
        out.append({
            "name": _frontmatter_field(text, "name") or d.name,
            "slug": d.name,
            "desc": _frontmatter_field(text, "description"),
            "dir": d,
            "docs": docs,
            "files": files,
        })
    return out


# ── the ARMS checklist, computed rather than asserted ──────────────────────────
def arms_status(repos, notes, rts, brain, gens, sks):
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
         bool(sks), f"{len(sks)} installed"),
    ]


# ── Dala tokens: void black, Electric Iris violet, Saffron Spark amber ─────────
CSS = """
:root{
  --void:#000000;
  --white:#ffffff;
  --ash:#9a9a9a;
  --silver:#bdbdbd;
  --iris:#8052ff;
  --iris-soft:#a98bff;
  --amber:#ffb829;
  --verdant:#15846e;
  --verdant-soft:#5fd6b8;
  --stop:#ff5470;
  --ff:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --fm:"IBM Plex Mono",Consolas,ui-monospace,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--void)}
body{color:var(--white);font-family:var(--ff);font-weight:200;font-size:17px;
line-height:1.6;-webkit-font-smoothing:antialiased}
code{font-family:var(--fm);color:var(--silver);font-size:.92em}
.w{max-width:1200px;margin:0 auto;padding:0 32px}
a{color:var(--white);text-decoration:none;transition:color .15s ease}
a:hover{color:var(--iris-soft)}
.eyebrow{font-family:var(--ff);font-weight:600;font-size:13px;letter-spacing:.16em;
text-transform:uppercase;color:var(--amber);margin:0 0 16px}
.hero{position:relative;padding:84px 0 44px;overflow:hidden}
.hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr .85fr;
gap:40px;align-items:center}
h1.display{font-family:var(--ff);font-weight:400;letter-spacing:-.035em;line-height:1.03;
margin:0 0 24px;font-size:clamp(42px,6.4vw,88px)}
.lede-hero{font-weight:200;font-size:18px;color:var(--silver);max-width:560px;margin:0}
.lede-hero b{color:var(--white);font-weight:600}
.particles{position:absolute;inset:0;pointer-events:none;z-index:0}
section{padding:60px 0;position:relative}
.section-title{font-family:var(--ff);font-weight:400;letter-spacing:-.02em;
font-size:clamp(26px,3vw,36px);margin:0 0 40px;color:var(--white)}
.spread{display:flex;flex-wrap:wrap;gap:48px 64px}
.arms-item{flex:1 1 220px;min-width:220px}
.arms-item .letter{display:block;font-weight:400;font-size:34px;color:var(--iris);
letter-spacing:-.02em;line-height:1;margin-bottom:12px}
.arms-item h3{margin:0 0 8px;font-size:19px;font-weight:600;color:var(--white)}
.arms-item p{margin:0 0 14px;font-size:14.5px;font-weight:300;color:var(--silver);
line-height:1.5}
.status{font-family:var(--fm);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
display:inline-flex;align-items:center;gap:8px}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:none}
.dot.go{background:var(--verdant-soft)}
.dot.warn{background:var(--amber)}
.dot.stop{background:var(--stop)}
.dot.off{background:var(--ash)}
.status.go{color:var(--verdant-soft)}
.status.warn{color:var(--amber)}
.status.stop{color:var(--stop)}
.status.off{color:var(--ash)}
.bignum{font-family:var(--ff);font-weight:400;font-size:clamp(38px,5vw,62px);
letter-spacing:-.03em;line-height:1;color:var(--white)}
.bignum.go{color:var(--verdant-soft)}
.bignum.stop{color:var(--stop)}
.stat-row{display:flex;flex-wrap:wrap;gap:44px 64px;margin-top:26px}
.stat{min-width:130px}
.stat .cap{display:block;font-family:var(--fm);font-size:11px;letter-spacing:.08em;
text-transform:uppercase;color:var(--ash);margin-bottom:10px}
.stat .sub{display:block;font-size:13.5px;font-weight:300;color:var(--silver);
margin-top:8px}
.stack{display:flex;flex-direction:column;gap:34px}
.repo-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;
gap:10px 32px}
.repo-name{font-size:21px;font-weight:600;color:var(--white)}
.repo-desc{display:block;font-size:14px;font-weight:300;color:var(--silver);margin-top:5px}
.repo-meta{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:baseline;
font-family:var(--fm);font-size:12.5px;color:var(--ash)}
.repo-meta .v{color:var(--silver)}
.note-row{display:flex;flex-wrap:wrap;gap:5px 20px;align-items:baseline}
.note-kind{font-family:var(--fm);font-size:11px;letter-spacing:.08em;
text-transform:uppercase;color:var(--amber);min-width:74px}
.note-what{font-size:14.5px;font-weight:300;color:var(--silver)}
.routine-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;
gap:8px 32px}
.routine-name{font-size:17px;font-weight:400;color:var(--white)}
.routine-cadence{font-family:var(--fm);font-size:12.5px;color:var(--ash)}
footer{padding:44px 0 76px;color:var(--ash);font-family:var(--fm);font-size:11.5px;
letter-spacing:.02em}
.course{margin-bottom:44px}
.course h3{margin:0 0 4px;font-size:21px;font-weight:600}
.course .repo-desc{margin:0 0 20px}
.course .stack{gap:18px;padding-left:18px;border-left:1px solid #242424}
.empty{font-size:14.5px;font-weight:300;color:var(--ash)}
.skill-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px 32px}
.skill-grid a{display:block}
.skill-grid .nm{font-size:16px;font-weight:600;color:var(--white)}
.skill-grid a:hover .nm{color:var(--iris-soft)}
.skill-grid .ds{display:block;font-size:13px;font-weight:300;color:var(--ash);line-height:1.45;
margin-top:3px}
details.skill{border-top:1px solid #242424;padding:18px 0}
details.skill summary{cursor:pointer;list-style:none}
details.skill summary::-webkit-details-marker{display:none}
details.skill summary .nm{font-size:20px;font-weight:600}
details.skill summary .ds{display:block;font-size:14.5px;font-weight:300;color:var(--silver);
margin-top:4px;max-width:900px}
details.skill[open] summary .nm{color:var(--iris-soft)}
.files{font-family:var(--fm);font-size:12px;color:var(--ash);margin:16px 0 8px}
.doc-name{font-family:var(--fm);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
color:var(--amber);margin:22px 0 8px}
pre.doc{white-space:pre-wrap;word-break:break-word;font-family:var(--fm);font-size:13px;
line-height:1.55;color:var(--silver);background:#0b0b0b;border:1px solid #1e1e1e;
border-radius:8px;padding:18px 20px;margin:0;max-height:70vh;overflow:auto}
@media(max-width:820px){
  .hero{padding:56px 0 28px}
  .hero-grid{grid-template-columns:1fr}
  .particles{opacity:.45}
  section{padding:44px 0}
}
"""


def particles_svg(n=54, seed=7):
    """A small, fixed constellation of outlined triangles -- Dala's signature gesture,
    scaled down to decoration rather than the thousand-particle brain-cloud the
    reference uses. Seeded so the page looks the same from one rebuild to the next."""
    rnd = random.Random(seed)
    colors = ["#8052ff", "#a98bff", "#ffb829", "#15846e", "#5fd6b8"]
    W, H = 1200, 560
    g = []
    for _ in range(n):
        x = rnd.uniform(0, W)
        y = rnd.uniform(0, H)
        s = rnd.uniform(4, 11)
        op = rnd.uniform(0.14, 0.62)
        c = rnd.choice(colors)
        rot = rnd.uniform(0, 360)
        pts = f"{s/2:.2f},0 {s:.2f},{s:.2f} 0,{s:.2f}"
        g.append(f'<g transform="translate({x:.1f} {y:.1f}) rotate({rot:.0f})" '
                 f'opacity="{op:.2f}"><polygon points="{pts}" fill="none" '
                 f'stroke="{c}" stroke-width="1"/></g>')
    return (f'<svg class="particles" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" '
            f'xmlns="http://www.w3.org/2000/svg">' + "".join(g) + "</svg>")


def esc(s):
    return html.escape(str(s), quote=True)


def head(title):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{esc(title)}</title>'
            '<link rel="preconnect" href="https://fonts.googleapis.com">'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
            'family=Inter:wght@200;300;400;600;700&family=IBM+Plex+Mono:wght@400;500'
            '&display=swap">'
            f"<style>{CSS}</style></head><body><div class='w'>")


def repo_row(r):
    """One repository line: name, description, branch, last commit, dirty count, state."""
    if r.get("untracked_project"):
        cls, word = "off", "no git"
    elif not r["known"]:
        cls, word = "warn", "git unreadable"
    elif r["stale_days"] > 21:
        cls, word = "stop", f"quiet {r['stale_days']}d"
    elif r["stale_days"] > 7:
        cls, word = "warn", f"quiet {r['stale_days']}d"
    else:
        cls, word = "go", "active"
    if r["dirty"] is None:
        dirty = "unknown"
    elif r.get("untracked_project"):
        dirty = "&mdash;"
    elif r["dirty"]:
        dirty = f"{r['dirty']} file{'s' if r['dirty'] != 1 else ''}"
    else:
        dirty = "clean"
    desc = f"<span class='repo-desc'>{esc(r['desc'])}</span>" if r.get("desc") else ""
    return ("<div class='repo-row'><div>"
            f"<a class='repo-name' href='{esc((PROJECTS / r['path']).as_uri())}'>"
            f"{esc(r['name'])}</a>{desc}</div>"
            "<div class='repo-meta'>"
            f"<span>branch <span class='v'>{esc(r['branch'])}</span></span>"
            f"<span>last <span class='v'>{esc(r['last'])}</span></span>"
            f"<span>uncommitted <span class='v'>{dirty}</span></span>"
            f"<span class='status {cls}'><span class='dot {cls}'></span>{esc(word)}</span>"
            "</div></div>")


def render(ctx):
    P = []
    a = P.append
    a(head(ctx["title"]))

    # ── hero ─────────────────────────────────────────────────────────────
    a("<div class='hero'>")
    a(particles_svg())
    a("<div class='hero-grid'><div>")
    a(f"<p class='eyebrow'>Agentic OS &middot; {esc(ctx['today'])}</p>")
    a(f"<h1 class='display'>{esc(ctx['title'])}</h1>")
    a(f"<p class='lede-hero'>{ctx['focus']}</p>")
    a("</div><div></div></div></div>")

    # ── ARMS ─────────────────────────────────────────────────────────────
    a("<section><p class='eyebrow'>The four parts</p>"
      "<h2 class='section-title'>Applications, Routines, Memory, Skills</h2>")
    a("<div class='spread'>")
    for letter, name, test, ok, detail in ctx["arms"]:
        cls = "go" if ok else "off"
        a(f"<div class='arms-item'><span class='letter'>{letter}</span>"
          f"<h3>{esc(name)}</h3><p>{esc(test)}</p>"
          f"<span class='status {cls}'><span class='dot {cls}'></span>{esc(detail)}</span>"
          f"</div>")
    a("</div></section>")

    # ── school ───────────────────────────────────────────────────────────
    if ctx["courses"]:
        a("<section><p class='eyebrow'>School</p>"
          "<h2 class='section-title'>Course projects</h2>")
        for c in ctx["courses"]:
            href = (SCHOOL / c["name"]).as_uri()
            a(f"<div class='course'><h3><a href='{esc(href)}'>{esc(c['name'])}</a></h3>")
            if c["title"]:
                a(f"<span class='repo-desc'>{esc(c['title'])}</span>")
            a("<div class='stack'>")
            if c["projects"]:
                for r in c["projects"]:
                    a(repo_row(r))
            else:
                a(f"<span class='empty'>No projects yet. Start one with "
                  f"<code>mkdir school\\{esc(c['name'])}\\&lt;name&gt;</code>; "
                  "it appears here on the next rebuild.</span>")
            a("</div></div>")
        a("</section>")

    # ── Blueberry ────────────────────────────────────────────────────────
    b = ctx["blueberry"]
    if b["entries"]:
        a("<section><p class='eyebrow'>Blueberry</p>"
          "<h2 class='section-title'>Latest in STATUS.md</h2>")
        if b["updated"]:
            a(f"<p class='lede-hero' style='max-width:640px'>Header says updated "
              f"{esc(b['updated'])}. Newest sections first.</p>")
        a("<div class='stack' style='gap:18px;margin-top:26px'>")
        for e in b["entries"]:
            a("<div class='note-row'>"
              f"<span class='note-kind'>{esc(e['date'])}</span>"
              f"<span class='note-what' style='color:var(--white)'>{esc(e['what'])}</span>"
              "</div>")
        a("</div></section>")

    # ── repositories ─────────────────────────────────────────────────────
    a("<section><p class='eyebrow'>Repositories</p>"
      "<h2 class='section-title'>What&rsquo;s live, what&rsquo;s quiet</h2>")
    a("<div class='stack'>")
    for r in ctx["repos"]:
        a(repo_row(r))
    a("</div></section>")

    # ── skills ───────────────────────────────────────────────────────────
    if ctx["skills"]:
        a("<section><p class='eyebrow'>Skills</p>"
          f"<h2 class='section-title'>{len(ctx['skills'])} installed</h2>")
        a("<div class='skill-grid'>")
        for s in ctx["skills"]:
            d = s["desc"]
            short = esc(d) if len(d) <= 110 else esc(d[:107].rstrip()) + "&hellip;"
            a(f"<a href='SKILLS.html#{esc(s['slug'])}'><span class='nm'>{esc(s['name'])}</span>"
              f"<span class='ds'>{short}</span></a>")
        a("</div></section>")

    # ── memory ───────────────────────────────────────────────────────────
    a("<section><p class='eyebrow'>Memory</p>"
      "<h2 class='section-title'>What&rsquo;s on file</h2>")
    a("<div class='stack' style='gap:22px'>")
    for n in ctx["notes"]:
        a("<div class='note-row'>"
          f"<span class='note-kind'>{esc(n['kind'])}</span>"
          f"<a href='{esc(n['href'])}'>{esc(n['file'])}</a>"
          f"<span class='note-what'>{esc(n['what'])}</span></div>")
    a("</div></section>")

    # ── routines ─────────────────────────────────────────────────────────
    a("<section><p class='eyebrow'>Routines</p>"
      "<h2 class='section-title'>What runs on its own</h2>")
    a("<div class='stack' style='gap:22px'>")
    for r in ctx["routines"]:
        cls = "go" if r["on"] else "off"
        word = "scheduled" if r["on"] else "written, not scheduled"
        a("<div class='routine-row'>"
          f"<a class='routine-name' href='routines/{esc(r['file'])}'>{esc(r['name'])}</a>"
          f"<span class='routine-cadence'>{esc(r['cadence'])}</span>"
          f"<span class='status {cls}'><span class='dot {cls}'></span>{esc(word)}</span>"
          "</div>")
    a("</div></section>")

    # ── systems ──────────────────────────────────────────────────────────
    a("<section><p class='eyebrow'>Systems</p>"
      "<h2 class='section-title'>Underneath</h2>")
    a("<div class='stat-row'>")
    br = ctx["brain"]
    if br["installed"]:
        a(f"<div class='stat'><span class='cap'>Second brain</span>"
          f"<div class='bignum'>{br['rows']:,}</div>"
          f"<span class='sub'>indexed sections &middot; {br['memories']} memories &middot; "
          f"<a href='http://127.0.0.1:7432'>open console</a></span></div>")
    else:
        a("<div class='stat'><span class='cap'>Second brain</span>"
          "<div class='bignum stop'>not installed</div>"
          "<span class='sub'>run <code>python install.py</code> in PowerShell</span></div>")
    a("<div class='stat'><span class='cap'>Skill launcher</span>"
      "<div class='bignum'><a href='http://127.0.0.1:8787/'>open</a></div>"
      "<span class='sub'>start it first: <code>python OS\\apps\\launcher\\launcher.py</code></span>"
      "</div>")
    g = ctx["gens"]
    if g:
        link = (f"<a href='file:///{esc(g['gallery'])}'>open gallery</a>"
                if g["gallery"] else "no gallery yet")
        a(f"<div class='stat'><span class='cap'>Generations</span>"
          f"<div class='bignum'>{g['count']}</div><span class='sub'>{link}</span></div>")
    a(f"<div class='stat'><span class='cap'>Cross-project memory</span>"
      f"<div class='bignum {'go' if ctx['claude_md'] else 'stop'}'>"
      f"{'loaded' if ctx['claude_md'] else 'missing'}</div>"
      "<span class='sub'>Projects/CLAUDE.md</span></div>")
    a("</div></section>")

    a(f"<footer>Regenerated by <code>build_home.py</code> at {esc(ctx['stamp'])}. "
      "Every number here was read from disk at build time &mdash; if one looks wrong, "
      "the source is wrong, not the page. Rebuild after any week&rsquo;s upkeep."
      "</footer></div></body></html>")
    return "\n".join(P)


def render_skills(sks, stamp):
    """SKILLS.html: every installed skill, its description, and its docs in full.

    The docs are shown as plain preformatted text rather than rendered markdown. That
    keeps this script free of a markdown library, and markdown reads fine as text.
    """
    P = []
    a = P.append
    a(head("Skills"))
    a("<div class='hero' style='padding-bottom:24px'>"
      "<p class='eyebrow'><a href='HOME.html'>&larr; Home</a></p>"
      f"<h1 class='display'>{len(sks)} skills</h1>"
      "<p class='lede-hero'>Everything in <code>~/.claude/skills</code> on this machine. "
      "Click one to read its <code>SKILL.md</code>, and its <code>README.md</code> when it "
      "has one. Account skills on claude.ai are not on disk, so they are not here.</p></div>")
    for s in sks:
        a(f"<details class='skill' id='{esc(s['slug'])}'><summary>"
          f"<span class='nm'>{esc(s['name'])}</span>"
          f"<span class='ds'>{esc(s['desc'])}</span></summary>")
        a(f"<div class='files'><a href='{esc(s['dir'].as_uri())}'>open folder</a> &middot; "
          f"{esc(', '.join(s['files'][:12]))}"
          f"{' &hellip;' if len(s['files']) > 12 else ''}</div>")
        for name, text in s["docs"]:
            a(f"<div class='doc-name'>{esc(name)}</div><pre class='doc'>{esc(text)}</pre>")
        a("</details>")
    a(f"<footer>Regenerated by <code>build_home.py</code> at {esc(stamp)}. "
      "Install or delete a skill, then rebuild, and this page follows.</footer></div>")
    # A link like SKILLS.html#generate should land on that skill already open.
    a("<script>function openHash(){var d=location.hash&&document.getElementById("
      "decodeURIComponent(location.hash.slice(1)));if(d){d.open=true;d.scrollIntoView();}}"
      "addEventListener('hashchange',openHash);openHash();</script>")
    a("</body></html>")
    return "\n".join(P)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="open the page after building")
    ap.add_argument("--no-git", action="store_true",
                    help="skip git entirely -- fast rebuild when only notes changed")
    ap.add_argument("--out", default=str(OS_DIR / "HOME.html"))
    ap.add_argument("--json", action="store_true",
                    help="print the gathered data as JSON and write no files (the web app reads this)")
    a = ap.parse_args()

    global SKIP_GIT
    SKIP_GIT = a.no_git
    # Each git call is a filesystem round trip, and they are independent, so run them
    # together. Trivial locally; the difference between usable and not over a mount.
    # REPOS gives each repo its line. Any other git repo directly under Projects/ is listed too,
    # without one, so a repo started since REPOS was last edited never goes missing from the page.
    listed = {rel for rel, _, _ in REPOS}
    found = [(d.name, "", False) for d in sorted(PROJECTS.iterdir(), key=lambda d: d.name.lower())
             if d.name not in listed and (d / ".git").is_dir()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        states = list(pool.map(lambda r: repo_state(r[0]), REPOS + found))
    repos = []
    for (rel, desc, _), st in zip(REPOS + found, states):
        if st:
            st["desc"] = desc
            repos.append(st)

    notes, rts = memory_notes(), routines()
    brain, gens = brain_state(), generations()
    blueberry, crs, sks = blueberry_status(), courses(), skills()

    if a.json:
        # ASCII-only JSON, so the Windows console encoding cannot mangle it on the way out.
        print(json.dumps({"repos": repos, "courses": crs, "blueberry": blueberry,
                          "routines": rts, "notes": notes, "brain": brain, "gens": gens,
                          "skills": sks}, default=str))
        return

    dirty_total = sum(r["dirty"] or 0 for r in repos)
    if blueberry["entries"]:
        focus = (f"<b>Blueberry</b> is the live thread. Latest: "
                 f"{esc(blueberry['entries'][0]['what'])}.")
    elif not blueberry["found"]:
        focus = f"<b>Blueberry's STATUS.md was not found</b> at {esc(BLUEBERRY_STATUS)}."
    else:
        focus = "<b>Blueberry's STATUS.md has no dated sections.</b>"
    if crs:
        n = sum(len(c["projects"]) for c in crs)
        focus += (f" {len(crs)} course{'s' if len(crs) != 1 else ''} in school/, "
                  f"{n} project{'s' if n != 1 else ''} started.")
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
        "brain": brain, "gens": gens, "blueberry": blueberry,
        "courses": crs, "skills": sks,
        "claude_md": (PROJECTS / "CLAUDE.md").is_file(),
        "arms": arms_status(repos, notes, rts, brain, gens, sks),
    }

    out = Path(a.out)
    out.write_text(render(ctx), encoding="utf-8")
    skills_out = out.with_name("SKILLS.html")
    skills_out.write_text(render_skills(sks, ctx["stamp"]), encoding="utf-8")
    print(f"wrote  {out}")
    print(f"wrote  {skills_out}")
    print(f"       {len(repos)} repos, {len(crs)} courses, {len(sks)} skills, "
          f"{len(notes)} memory notes, {len(rts)} routines, "
          f"brain {'installed' if brain['installed'] else 'NOT installed'}")
    if a.open:
        webbrowser.open(out.as_uri())


if __name__ == "__main__":
    main()
