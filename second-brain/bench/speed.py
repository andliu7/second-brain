"""speed.py - is the brain faster and more accurate than plain file search? No model, no cost.

For every question in questions.json this times three ways of finding the gold file:

  BRAIN      q.py, the way a session runs it (subprocess), plus in-process for reference
  GREP       ripgrep over Projects with the question's content words, respecting .gitignore
             (what Claude Code's Grep tool does), files ranked by the 3 rarest terms
  GREP-ALL   the same search with .gitignore switched off, because the memory notes are
             gitignored and plain GREP cannot see them at all
  GLOB       filename-only search with the same words

The GREP arms get the rarity of each term for free (one rg pass counts every term, then the
3 rarest that match anything are kept). A real agent guesses rarity, so this baseline is
generous on purpose: RESULTS.md explains why a rigged baseline is the worst failure here.

Latency is measured sequentially on one machine. A throwaway pass runs first and is
reported as "cold"; the headline numbers are the median of the warm repeats that follow.

    python bench\\speed.py               # run, write results-speed*.json and results-speed-tasks.md
    python bench\\speed.py --repeats 3   # fewer warm repeats
    python bench\\speed.py --history     # only rebuild results-history-summary.json

Outputs: results-speed.json and results-speed-tasks.md quote questions and paths and stay
local (bench/.gitignore). results-speed-summary.json and results-history-summary.json hold
aggregates only and are safe to commit.
"""
from __future__ import annotations

import contextlib
import datetime
import io
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRAIN = HERE.parent
PROJECTS = BRAIN.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(BRAIN))
from hits import accepted, paths_in  # noqa: E402
from brainlib import STOPWORDS  # noqa: E402

CHARS_PER_TOKEN = 3.6          # the estimate RESULTS.md uses for every path
READ_LINE_CAP = 2000           # Claude Code's Read tool returns at most this many lines
FILES_TO_CONFIRM = 5           # an agent opens at most this many grep hits
LISTING_CAP = 250              # Grep tool's default head_limit on its file listing
TERMS_KEPT = 3
EXCLUDE = ["!node_modules", "!dist", "!.git"]
# Brain artifacts that quote the questions or every section of the corpus. Only matters for
# GREP-ALL, since .gitignore already hides them from GREP.
EXCLUDE_ALL = EXCLUDE + ["!**/second-brain/second-brain/index.tsv",
                         "!**/second-brain/second-brain/index.cache",
                         "!**/second-brain/second-brain/bench/**",
                         "!__pycache__", "!.venv", "!venv"]
TRACE_LINE = re.compile(r"^~\s+-?[\d.]+\s+rare=\S+\s+(.+)$")
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]")


# ------------------------------------------------------------------ helpers (tested)

def est_tokens(chars: int) -> int:
    return round(chars / CHARS_PER_TOKEN)


def content_terms(question: str) -> list[str]:
    """Lower-cased words of 3+ characters that are not stopwords, first occurrence order."""
    out = []
    for w in WORD.findall(question):
        w = w.lower()
        if len(w) >= 3 and w not in STOPWORDS and not w.isdigit() and w not in out:
            out.append(w)
    return out


def pick_rarest(terms: list[str], df: dict[str, int], k: int = TERMS_KEPT) -> list[str]:
    """The k terms with the smallest document frequency, ignoring terms that match nothing
    (an agent that gets zero hits moves on to its next word). Ties keep question order."""
    live = [t for t in terms if df.get(t, 0) > 0]
    return sorted(live, key=lambda t: (df[t], terms.index(t)))[:k]


def rank_files(counts: dict[str, dict[str, int]], terms: list[str]) -> list[str]:
    """Files ranked by how many of the chosen terms they contain, then by total matches."""
    scored = []
    for path, per in counts.items():
        hit = [t for t in terms if per.get(t)]
        if hit:
            scored.append((-len(hit), -sum(per[t] for t in hit), path))
    return [p for *_, p in sorted(scored)]


def norm(p: str) -> str:
    return str(p).replace("\\", "/").casefold()


def gold_rank(ranked: list[str], gold: list[str]) -> int | None:
    g = {norm(x) for x in gold}
    return next((i + 1 for i, p in enumerate(ranked) if norm(p) in g), None)


def read_cost(path: str) -> int:
    """Characters the Read tool would hand back for this file: at most READ_LINE_CAP lines."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return sum(len(line) for _, line in zip(range(READ_LINE_CAP), f))
    except OSError:
        return 0


def chars_to_confirm(ranked: list[str], rank: int | None) -> int:
    """Open hits in rank order until the gold file is read, at most FILES_TO_CONFIRM files."""
    n = min(rank or FILES_TO_CONFIRM, FILES_TO_CONFIRM)
    return sum(read_cost(p) for p in ranked[:n])


def brain_ranked(bundle: str) -> list[str]:
    """Distinct files in score order: the winner, then --trace runners-up. BRAIN-ALSO and
    the AMBIGUOUS lines are drawn from the same scored list, so they add nothing new."""
    out = []
    first = paths_in(bundle)[:1]
    for p in first + [m.group(1).split("#", 1)[0] for m in map(TRACE_LINE.match, bundle.splitlines()) if m]:
        if norm(p) not in map(norm, out):
            out.append(p)
    return out


def pctl(xs: list[float], q: float) -> float | None:
    """Nearest-rank percentile, no interpolation."""
    if not xs:
        return None
    s = sorted(xs)
    return s[max(0, math.ceil(q * len(s)) - 1)]


# ------------------------------------------------------------------ ripgrep

def rg_command() -> tuple[list[str], dict]:
    """ripgrep: $SPEED_RG, then rg on PATH, then the copy embedded in Claude Code (the
    same binary its Grep tool runs, selected by ARGV0=rg)."""
    env = dict(os.environ)
    exe = os.environ.get("SPEED_RG") or shutil.which("rg")
    if exe:
        return [exe], env
    cc = Path.home() / ".local" / "bin" / ("claude.exe" if os.name == "nt" else "claude")
    if cc.exists():
        env["ARGV0"] = "rg"
        return [str(cc)], env
    raise SystemExit("speed.py: ripgrep not found. Set SPEED_RG to the rg executable.")


def rg_counts(root: Path, terms: list[str], ignore_vcs: bool = True) -> tuple[dict, float, str]:
    """One rg pass for every term. Returns ({path: {term: matches}}, seconds, stderr)."""
    if not terms:
        return {}, 0.0, ""
    cmd, env = rg_command()
    globs = EXCLUDE if ignore_vcs else EXCLUDE_ALL
    args = cmd + ["-o", "-i", "-F", "--null", "--no-line-number", "--with-filename",
                  "--no-messages"]
    if not ignore_vcs:
        args.append("--no-ignore-vcs")
    for g in globs:
        args += ["--glob", g]
    for t in terms:
        args += ["-e", t]
    args.append(str(root))
    t0 = time.perf_counter()
    r = subprocess.run(args, env=env, capture_output=True)
    dt = time.perf_counter() - t0
    counts: dict[str, dict[str, int]] = {}
    for line in r.stdout.split(b"\n"):
        path, sep, match = line.partition(b"\0")
        if not sep:
            continue
        p = path.decode("utf-8", "replace").replace("\\", "/")
        m = match.decode("utf-8", "replace").strip().lower()
        per = counts.setdefault(p, {})
        per[m] = per.get(m, 0) + 1
    return counts, dt, r.stderr.decode("utf-8", "replace")[:300]


def rg_files(root: Path) -> tuple[list[str], float]:
    cmd, env = rg_command()
    args = cmd + ["--files", "--no-messages"]
    for g in EXCLUDE:
        args += ["--glob", g]
    t0 = time.perf_counter()
    r = subprocess.run(args + [str(root)], env=env, capture_output=True)
    dt = time.perf_counter() - t0
    return [ln.decode("utf-8", "replace").replace("\\", "/") for ln in r.stdout.splitlines()], dt


def choose_terms(root: Path, question: str, ignore_vcs: bool = True) -> tuple[list[str], dict, float]:
    """The oracle step: one rg pass over every content word gives each word's document
    frequency, and the 3 rarest that match anything are kept. Returns (chosen, counts, s)."""
    terms = content_terms(question)
    counts, dt, _ = rg_counts(root, terms, ignore_vcs)
    df = {t: sum(1 for per in counts.values() if per.get(t)) for t in terms}
    return pick_rarest(terms, df), counts, dt


def grep_arm(root: Path, question: str, gold: list[str], ignore_vcs: bool = True,
             terms: list[str] | None = None) -> dict:
    """With terms given, time the search an agent actually runs: those words only. Without,
    one all-words pass both picks the words and is the timed search (used where a second
    pass would cost minutes)."""
    if terms is None:
        chosen, counts, dt = choose_terms(root, question, ignore_vcs)
        err = ""
    else:
        chosen = terms
        counts, dt, err = rg_counts(root, chosen, ignore_vcs)
    ranked = rank_files(counts, chosen)
    rank = gold_rank(ranked, gold)
    listing = sum(len(p) + 1 for p in ranked[:LISTING_CAP])
    chars = listing + chars_to_confirm(ranked, rank)
    return {"ms": dt * 1000, "terms": chosen, "rank": rank, "hits": len(ranked),
            "top": ranked[:5], "chars": chars, "tokens": est_tokens(chars), "stderr": err}


def glob_arm(files: list[str], list_s: float, question: str, gold: list[str]) -> dict:
    """Filename-only: one listing, then rank paths by how many question words the last
    three path components contain."""
    t0 = time.perf_counter()
    terms = content_terms(question)
    scored = []
    for f in files:
        tail = "/".join(f.lower().split("/")[-3:])
        n = sum(1 for t in terms if t in tail)
        if n:
            scored.append((-n, f))
    ranked = [f for _, f in sorted(scored)]
    dt = list_s + (time.perf_counter() - t0)
    rank = gold_rank(ranked, gold)
    chars = sum(len(p) + 1 for p in ranked[:LISTING_CAP]) + chars_to_confirm(ranked, rank)
    return {"ms": dt * 1000, "rank": rank, "hits": len(ranked), "top": ranked[:5],
            "chars": chars, "tokens": est_tokens(chars)}


# ------------------------------------------------------------------ brain

def brain_subprocess(question: str, trace: bool = False) -> tuple[str, float]:
    args = [sys.executable, str(BRAIN / "q.py")] + (["--trace"] if trace else []) + [question]
    t0 = time.perf_counter()
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout, time.perf_counter() - t0


def brain_inprocess(question: str) -> tuple[str, float]:
    import gc
    import q as qmod
    buf = io.StringIO()
    argv = sys.argv
    sys.argv = ["q.py", question]
    t0 = time.perf_counter()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
            qmod.main()
    finally:
        sys.argv = argv
    dt = time.perf_counter() - t0
    gc.collect()        # q.main leaves index.tsv open; Windows repair needs it closed
    return buf.getvalue(), dt


def index_state() -> tuple[set[str], str | None]:
    """Every path the index knows (case-folded) and the date of the last full reindex."""
    known = set()
    with open(BRAIN / "index.tsv", encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("#"):
                known.add(norm(line.split("\t", 1)[0]))
    stamp = None
    try:
        for ln in (BRAIN / "log.md").read_text(encoding="utf-8").splitlines():
            if "] reindex |" in ln:
                stamp = ln.split("[", 1)[1].split("]", 1)[0]
    except OSError:
        pass
    return known, stamp


# ------------------------------------------------------------------ history

def _num(s: str) -> float:
    return float(s.replace(",", "").replace("$", "").rstrip("s"))


def history() -> dict:
    """Aggregates from the two earlier studies, parsed from their markdown so a rerun of
    either study flows through here unchanged."""
    out: dict = {"built": datetime.date.today().isoformat(), "studies": []}
    text = (BRAIN / "RESULTS.md").read_text(encoding="utf-8")
    for suite, title in (("hard", "### Hard suite"), ("easy", "### Easy suite")):
        block = text.split(title, 1)[1].split("###", 1)[0].split("## ", 1)[0]
        arms = {}
        for m in re.finditer(r"^\|\s*\**([^|*]+?)\**\s*\|\s*([\d,]+)\s*\|\s*(\d+)/(\d+)\s*\|\s*(\d+)\s*\|", block, re.M):
            arms[m.group(1).strip()] = {"tokens": int(_num(m.group(2))), "correct": int(m.group(3)),
                                       "n": int(m.group(4)), "tool_calls": int(m.group(5))}
        out["studies"].append({"study": f"bench.py {suite} suite", "source": "RESULTS.md",
                               "kind": "simulated sessions, token estimate chars/3.6", "arms": arms})
    full = HERE / "results-full.md"
    if full.exists():
        t = full.read_text(encoding="utf-8")
        head = re.search(r"^(\d{4}-\d{2}-\d{2}) · model `([^`]+)` · (\d+) repeats · (\d+) of (\d+)", t, re.M)

        def row(label):
            m = re.search(r"^\|\s*\**" + re.escape(label) + r"\**\s*\|(.+)$", t, re.M)
            return [c.strip().strip("*") for c in m.group(1).strip().strip("|").split("|")]
        names = ["brain (ARM A)", "repo map, no brain (ARM B)"]
        arms = {n: {} for n in names}
        for i, n in enumerate(names):
            c = row("Correct, and the brain produced it")[i].split("/")
            arms[n]["correct_headline"], arms[n]["runs"] = int(c[0]), int(c[1])
            c = row("Correct by any means (A includes fallbacks to reading files)")[i].split(" ")[0].split("/")
            arms[n]["correct_any_means"] = int(c[0])
            arms[n]["median_cost_usd"] = _num(row("Median cost per question")[i])
            arms[n]["median_wall_clock_s"] = _num(row("Median wall clock")[i])
            arms[n]["cited_gold_file"] = int(row("Cited the gold file")[i].split("/")[0])
            arms[n]["tokens_all_four_sum"] = int(_num(row("all four")[i]))
            arms[n]["tokens_median_per_run"] = int(_num(row("median per run")[i]))
        out["studies"].append({
            "study": "real-agent gauntlet (run.mjs)", "source": "bench/results-full.md",
            "date": head.group(1) if head else None, "model": head.group(2) if head else None,
            "repeats": int(head.group(3)) if head else None,
            "questions": int(head.group(4)) if head else None,
            "kind": "real Claude Code sessions, billed tokens and dollars",
            "correct_headline_note": "ARM A counts only answers the brain produced (fallbacks to "
                                     "reading files excluded); ARM B is plain correct",
            "arms": arms})
    return out


# ------------------------------------------------------------------ main

def summarize(rows: list[dict], arm: str) -> dict:
    live = [r[arm] for r in rows]
    ms = [a["ms"] for a in live]
    s = {"n": len(live),
         "median_ms": round(statistics.median(ms), 1), "p90_ms": round(pctl(ms, 0.9), 1),
         "hit_at_1": sum(1 for a in live if a["rank"] == 1),
         "hit_at_5": sum(1 for a in live if a["rank"] and a["rank"] <= 5),
         "median_chars_to_read": round(statistics.median(a["chars"] for a in live)),
         "median_tokens_to_read": round(statistics.median(a["tokens"] for a in live)),
         "p90_tokens_to_read": pctl([a["tokens"] for a in live], 0.9)}
    if "cold_ms" in live[0]:
        s["cold_median_ms"] = round(statistics.median(a["cold_ms"] for a in live), 1)
    stale = [r for r in rows if not r["gold_in_index"]]
    s["gold_not_in_index"] = len(stale)
    s["misses_at_1_gold_not_in_index"] = sum(1 for r in stale if r[arm]["rank"] != 1)
    hidden = [r for r in rows if r["gold_gitignored"]]
    s["gold_gitignored"] = len(hidden)
    s["misses_at_1_gold_gitignored"] = sum(1 for r in hidden if r[arm]["rank"] != 1)
    return s


def verdict(r: dict) -> str:
    b, g = r["BRAIN"]["rank"] == 1, r["GREP"]["rank"] == 1
    if b and g:
        return "tie"
    if b:
        return "brain wins"
    if g:
        return "stale index" if not r["gold_in_index"] else "grep wins"
    return "stale index" if not r["gold_in_index"] else "both miss"


def write_tasks_md(rows: list[dict], path: Path, stamp: str | None) -> None:
    yn = lambda a: "yes" if a["rank"] == 1 else (f"#{a['rank']}" if a["rank"] else "no")  # noqa: E731
    lines = ["# Brain vs no brain, per task", "",
             f"{datetime.date.today()} · last full reindex {stamp} · GREP respects .gitignore",
             "", "| id | task | BRAIN first? | BRAIN ms | BRAIN tokens | GREP first? | GREP ms | GREP tokens | GREP-ALL first? | verdict |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        b, g, ga = r["BRAIN"], r["GREP"], r.get("GREP-ALL")
        lines.append(f"| {r['id']} | {r['question']} | {yn(b)} | {b['ms']:.0f} | {b['tokens']} | "
                     f"{yn(g)} | {g['ms']:.0f} | {g['tokens']} | {yn(ga) if ga else "-"} | {verdict(r)} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if "--history" in sys.argv:
        (HERE / "results-history-summary.json").write_text(json.dumps(history(), indent=1), encoding="utf-8")
        print("wrote results-history-summary.json")
        return 0
    repeats = int(sys.argv[sys.argv.index("--repeats") + 1]) if "--repeats" in sys.argv else 5
    qs = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))
    qs = [q for q in (qs["questions"] if isinstance(qs, dict) else qs) if not q.get("excluded")]
    known, stamp = index_state()
    files, _ = rg_files(PROJECTS)
    visible = {norm(f) for f in files}

    grep_all = "--no-grep-all" not in sys.argv
    rows = []
    # Pass 0, throwaway, reported as cold: the first brain run, and GREP's oracle pass over
    # every content word (which also picks the 3 words the timed GREP runs search for).
    for q in qs:
        gold = accepted(q)
        _, bs = brain_subprocess(q["question"])
        chosen, _, g1 = choose_terms(PROJECTS, q["question"])
        rows.append({"id": q["id"], "question": q["question"], "gold": gold, "terms": chosen,
                     "gold_in_index": any(norm(g) in known for g in gold),
                     "gold_gitignored": not any(norm(g) in visible for g in gold),
                     "cold": {"BRAIN": bs * 1000, "GREP": g1 * 1000}})
        print(f"cold  {q['id']:34} brain {bs*1000:6.0f}ms  grep all-words {g1*1000:6.0f}ms", flush=True)

    # Warm passes, one arm after another, never interleaved with GREP-ALL (it reads ~3 GB and
    # evicts the file cache every other arm depends on).
    for q, r in zip(qs, rows):
        text = q["question"]
        traced, _ = brain_subprocess(text, trace=True)
        ranked = brain_ranked(traced)
        rank = gold_rank(ranked, r["gold"])
        sub, inproc, bundle = [], [], ""
        for _ in range(repeats):
            bundle, dt = brain_subprocess(text)
            sub.append(dt * 1000)
        for _ in range(repeats):
            _, dt = brain_inprocess(text)
            inproc.append(dt * 1000)
        r["BRAIN"] = {"ms": statistics.median(sub), "cold_ms": r["cold"]["BRAIN"],
                      "inprocess_ms": statistics.median(inproc), "rank": rank,
                      "answer": (paths_in(bundle) or [None])[0],
                      "top": ranked[:5], "chars": len(bundle), "tokens": est_tokens(len(bundle)),
                      "stale_line": "STALE INDEX" in bundle}
        runs = [grep_arm(PROJECTS, text, r["gold"], terms=r["terms"]) for _ in range(repeats)]
        r["GREP"] = runs[-1]
        r["GREP"]["ms"], r["GREP"]["cold_ms"] = statistics.median(x["ms"] for x in runs), r["cold"]["GREP"]
        lst = []
        for _ in range(repeats):
            f2, ls = rg_files(PROJECTS)
            lst.append(glob_arm(f2, ls, text, r["gold"]))
        r["GLOB"] = lst[-1]
        r["GLOB"]["ms"] = statistics.median(x["ms"] for x in lst)
        print(f"warm  {r['id']:34} brain #{rank} {r['BRAIN']['ms']:5.0f}ms  "
              f"grep #{r['GREP']['rank']} {r['GREP']['ms']:5.0f}ms  glob #{r['GLOB']['rank']}", flush=True)

    # GREP-ALL last, once per question: a single all-words pass is both the search and the
    # word picker, since a second pass would cost another two minutes.
    for q, r in zip(qs, rows if grep_all else []):
        r["GREP-ALL"] = grep_arm(PROJECTS, q["question"], r["gold"], ignore_vcs=False)
        print(f"all   {r['id']:34} grep-all #{r['GREP-ALL']['rank']} {r['GREP-ALL']['ms']:6.0f}ms", flush=True)

    arms = ["BRAIN", "GREP", "GLOB"] + (["GREP-ALL"] if grep_all else [])
    summary = {
        "built": datetime.datetime.now().isoformat(timespec="seconds"),
        "questions": len(rows), "warm_repeats": repeats,
        "index_last_full_reindex": stamp,
        "index_note": ("The index is stale: files created after the last full reindex are "
                       "unknown to the brain, so gold files missing from it are expected misses, "
                       "counted separately as gold_not_in_index. The same way, gold files hidden by "
                       ".gitignore are unreachable for GREP and GLOB, counted as gold_gitignored."),
        "method": {
            "latency": "sequential, one throwaway pass (cold_median_ms), then median of warm repeats "
                       "per question; median_ms and p90_ms are across questions",
            "BRAIN": "python q.py <question> as a subprocess, as a session runs it; rank from --trace "
                     "runners-up by distinct file; tokens = bundle chars / 3.6",
            "BRAIN_inprocess_median_ms": round(statistics.median(r["BRAIN"]["inprocess_ms"] for r in rows), 1),
            "GREP": "ripgrep over Projects respecting .gitignore, skipping node_modules/dist/.git, "
                    "for the 3 rarest content words that match anything; rarity comes from an untimed "
                    "oracle pass over every word (generous to grep, a real agent guesses); timed = the "
                    "3-word search; files ranked by words matched then match count; cold_median_ms is "
                    "the first all-words pass",
            "GREP-ALL": "one all-words pass with .gitignore off (brain index and bench files still "
                        "excluded), run once per question after every other arm; it reads ~3 GB of "
                        "cloned reference repos and build output, so it is disk-bound on this machine",
            "GLOB": "one file listing, paths ranked by question words in the last 3 path parts",
            "tokens_to_read": "file listing (up to 250 paths) plus hits opened in rank order until "
                              "the gold file, at most 5 files, each capped at 2000 lines, chars / 3.6",
        },
        "arms": {a: summarize(rows, a) for a in arms},
    }
    (HERE / "results-speed.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1), encoding="utf-8")
    (HERE / "results-speed-summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (HERE / "results-history-summary.json").write_text(json.dumps(history(), indent=1), encoding="utf-8")
    write_tasks_md(rows, HERE / "results-speed-tasks.md", stamp)
    print(json.dumps(summary["arms"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
