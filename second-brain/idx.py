"""idx.py - the indexer. Walks the configured roots and emits one index row per
SECTION (not per file), each row a pointer into a byte range.

Type-based dispatch, because paying semantic-extraction cost on material that
has a grammar is waste:
  .md/.txt   -> heading tree
  code       -> top-level symbol declarations (regex, no AST dependency)
  config     -> whole file, shallow key extraction
  low-trust  -> filename + first 200 bytes, marked AMBIGUOUS, never deep-parsed

No model calls. Usage:
  python idx.py                 full reindex
  python idx.py --stats         reindex and print the reduction ratio
  python idx.py --file <path>   re-index exactly one file (used by q.py repair)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brainlib import (  # noqa: E402
    CODE_EXT, CONF_EXT, TEXT_EXT, Row, append_rows, context_for,
    knobs_fingerprint, load_config, norm, read_index, read_lines_with_offsets,
    tokenize, under_roots, validate_row, write_index,
)

BRAIN_DIR = Path(__file__).resolve().parent

# ---- pointer extraction: one regex pass, zero model calls -------------------
# NOTE ON SPACES: Windows paths contain spaces constantly ("My Notes\extra info.md").
# A naive [^\s]+ target pattern silently truncates at the first space, the pointer
# fails to resolve, and resolve_pointers() drops it -- so the hop just never happens
# and nothing ever tells you why. Targets therefore run to a delimiter or to end of
# line, and quoted targets are supported explicitly.
PTR_PATTERNS = [
    re.compile(r"\[\[([^\]|]+)"),                                   # [[wikilink]]
    re.compile(r"(?:^|\s)(?:see|ref|refs|source|src)\s*:\s*[\"'<]([^\"'>]+)[\"'>]", re.I),
    re.compile(r"(?:^|\s)(?:see|ref|refs|source|src)\s*:\s*([^\n,;]+?)\s*$", re.I | re.M),
    re.compile(r"\[[^\]]*\]\(([^)]+\.(?:md|txt|py|java|kt|ts|js))\)"),
    re.compile(r"->\s*([^\n,;]+?\.(?:md|txt))\s*$", re.I | re.M),
]

# ---- symbol declarations, per language family ------------------------------
SYMBOL_RE = {
    "java": re.compile(r"^\s*(?:@\w+\s+)*(?:public|protected|private|static|final|abstract|sealed|\s)*\s*(?:class|interface|enum|record|@interface)\s+(\w+)"),
    "kotlin": re.compile(r"^\s*(?:@\w+\s+)*(?:public|private|internal|open|sealed|data|abstract|\s)*\s*(?:class|interface|object|fun)\s+(\w+)"),
    "python": re.compile(r"^(?:class|def|async def)\s+(\w+)"),
    "js": re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)"),
    "go": re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?(\w+)|^\s*type\s+(\w+)"),
    "rust": re.compile(r"^\s*(?:pub\s+)?(?:fn|struct|enum|trait|impl|mod)\s+(\w+)"),
    "c": re.compile(r"^\s*(?:[\w:<>*&\[\]]+\s+)+(\w+)\s*\([^;]*\)\s*\{"),
    "cs": re.compile(r"^\s*(?:public|private|protected|internal|static|sealed|abstract|\s)*\s*(?:class|interface|struct|enum|record)\s+(\w+)"),
    "ruby": re.compile(r"^\s*(?:class|module|def)\s+([\w.]+)"),
    "php": re.compile(r"^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|function)\s+(\w+)"),
    "swift": re.compile(r"^\s*(?:public|private|internal|open|\s)*\s*(?:class|struct|enum|protocol|func|extension)\s+(\w+)"),
    "scala": re.compile(r"^\s*(?:case\s+)?(?:class|object|trait|def)\s+(\w+)"),
    "sh": re.compile(r"^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{"),
    "sql": re.compile(r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|INDEX)\s+[`\"\[]?(\w+)", re.I),
}
MD_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
CONF_KEY = re.compile(r'^\s*[-"\']?([A-Za-z_][\w.\-]{1,40})["\']?\s*[:=]')

MAX_KEYWORDS = 40
LOW_TRUST_PEEK = 200


def top_terms(text: str, n: int = MAX_KEYWORDS) -> list[str]:
    c = Counter(tokenize(text))
    return [w for w, _ in c.most_common(n)]


def find_pointers(text: str) -> list[str]:
    for pat in PTR_PATTERNS:
        m = pat.search(text)
        if m:
            for g in m.groups():
                if g:
                    return [g.strip().strip("<>\"'")]
    return []


def path_tokens(path: str) -> list[str]:
    p = Path(path)
    return tokenize(" ".join(list(p.parts[-3:]) + [p.stem]))


# ------------------------------------------------------------------ splitters

def split_markdown(path: str, lines, offsets, total) -> list[dict]:
    """Heading tree. A section runs from its heading to the next heading of the
    same or shallower depth. Preamble before the first heading is its own row."""
    heads = []
    for i, ln in enumerate(lines):
        m = MD_HEADING.match(ln)
        if m:
            heads.append((i, len(m.group(1)), m.group(2)))
    secs = []
    if not heads or heads[0][0] > 0:
        end_line = heads[0][0] if heads else len(lines)
        if end_line > 0:
            secs.append({"start_line": 0, "end_line": end_line,
                         "heading": Path(path).stem})
    stack: list[tuple[int, str]] = []
    for idx, (ln_i, depth, title) in enumerate(heads):
        while stack and stack[-1][0] >= depth:
            stack.pop()
        stack.append((depth, title))
        trail = " > ".join(t for _, t in stack)
        end_line = len(lines)
        for j in range(idx + 1, len(heads)):
            if heads[j][1] <= depth:
                end_line = heads[j][0]
                break
        secs.append({"start_line": ln_i, "end_line": end_line, "heading": trail})
    return secs


def split_code(path: str, lang: str, lines, offsets, total) -> list[dict]:
    """Declarations nest by INDENT, exactly like markdown headings nest by depth.
    A top-level class therefore spans its whole body (methods included), and its
    methods are additionally indexed as sub-sections. Treating them as flat
    siblings truncates the class at its first method, which makes "what methods
    does X have" unanswerable -- that was a real bug, caught by the benchmark."""
    rx = SYMBOL_RE.get(lang)
    marks: list[tuple[int, int, str]] = []   # (line, indent, name)
    if rx:
        for i, ln in enumerate(lines):
            if len(ln) > 400:
                continue
            m = rx.match(ln)
            if m:
                name = next((g for g in m.groups() if g), None)
                if name and name.lower() not in (
                        "if", "for", "while", "switch", "catch", "return", "else"):
                    marks.append((i, len(ln) - len(ln.lstrip()), name))
    if not marks:
        return [{"start_line": 0, "end_line": len(lines), "heading": Path(path).name}]

    secs = []
    if marks[0][0] > 0:
        secs.append({"start_line": 0, "end_line": marks[0][0],
                     "heading": Path(path).name + " (imports)"})
    stack: list[tuple[int, str]] = []
    for k, (ln_i, indent, name) in enumerate(marks):
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, name))
        trail = " > ".join(n for _, n in stack)
        end_line = len(lines)
        for j in range(k + 1, len(marks)):
            if marks[j][1] <= indent:
                end_line = marks[j][0]
                break
        secs.append({"start_line": ln_i, "end_line": end_line,
                     "heading": f"{Path(path).name} > {trail}", "symbol": name})
    return secs


def split_config(path: str, lines, offsets, total) -> list[dict]:
    return [{"start_line": 0, "end_line": len(lines), "heading": Path(path).name}]


# -------------------------------------------------------------------- indexer

def index_file(path: str, cfg: dict, low_trust: bool = False) -> list[Row]:
    p = Path(path)
    ext = p.suffix.lower()
    try:
        st = os.stat(path)
    except OSError:
        return []
    if st.st_size == 0:
        return []
    roots = cfg.get("roots", [])

    # low-trust: filename + a 200-byte peek. Never deep-parsed, never trusted.
    if low_trust or (ext not in TEXT_EXT and ext not in CODE_EXT and ext not in CONF_EXT):
        if ext not in TEXT_EXT and ext not in CODE_EXT and ext not in CONF_EXT and not low_trust:
            return []
        try:
            with open(path, "rb") as f:
                peek = f.read(LOW_TRUST_PEEK).decode("utf-8", errors="replace")
        except OSError:
            return []
        kw = path_tokens(path) + tokenize(peek)
        r = Row(path=norm(path), byte_start=0,
                byte_end=min(st.st_size, max(LOW_TRUST_PEEK, 1)),
                heading=p.name, kind="lowtrust",
                keywords=" ".join(dict.fromkeys(kw))[:2000], pointer="",
                confidence="AMBIGUOUS", mtime_ns=st.st_mtime_ns, size=st.st_size)
        return [r] if validate_row(r, roots) is None else []

    if st.st_size > cfg.get("max_file_bytes", 2_000_000):
        return []

    try:
        lines, offsets, total = read_lines_with_offsets(path)
    except OSError:
        return []
    if not lines:
        return []

    if ext in TEXT_EXT:
        kind, secs = "text", split_markdown(path, lines, offsets, total)
    elif ext in CODE_EXT:
        lang = CODE_EXT[ext]
        kind, secs = f"code:{lang}", split_code(path, lang, lines, offsets, total)
    else:
        kind, secs = "config", split_config(path, lines, offsets, total)

    ptoks = path_tokens(path)
    rows: list[Row] = []
    for s in secs:
        sl, el = s["start_line"], s["end_line"]
        if el <= sl:
            continue
        bstart = offsets[sl]
        bend = offsets[el] if el < len(offsets) else total
        if bend <= bstart:
            continue
        body = "\n".join(lines[sl:el])
        kw = list(dict.fromkeys(
            tokenize(s["heading"]) + ptoks
            + (tokenize(s["symbol"]) if s.get("symbol") else [])
            + top_terms(body)
        ))
        ptr = find_pointers(body)
        r = Row(path=norm(path), byte_start=bstart, byte_end=bend,
                heading=s["heading"], kind=kind,
                keywords=" ".join(kw)[:2000],
                pointer=ptr[0] if ptr else "",
                confidence="EXTRACTED" if s.get("symbol") or kind == "text" else "INFERRED",
                mtime_ns=st.st_mtime_ns, size=st.st_size)
        err = validate_row(r, roots)
        if err is None:
            rows.append(r)
    return rows


def resolve_pointers(rows: list[Row]) -> int:
    """A pointer that does not resolve to an existing index row is dropped.
    Dangling references must never survive into the persisted artifact."""
    by_path: dict[str, list[Row]] = {}
    by_head: dict[str, Row] = {}
    for r in rows:
        by_path.setdefault(r.path.casefold(), []).append(r)
        by_head.setdefault(r.heading.strip().casefold(), r)
        by_head.setdefault(Path(r.path).stem.casefold(), r)
    dropped = 0
    for r in rows:
        if not r.pointer:
            continue
        target = r.pointer.strip()
        cand = None
        tl = target.casefold()
        if tl in by_head:
            cand = by_head[tl]
        else:
            base = Path(target.split("#")[0]).name.casefold()
            for pth, rs in by_path.items():
                if Path(pth).name.casefold() == base:
                    cand = rs[0]
                    break
            if cand is None and Path(target).stem.casefold() in by_head:
                cand = by_head[Path(target).stem.casefold()]
        if cand is None or cand.key() == r.key():
            r.pointer = ""
            dropped += 1
        else:
            r.pointer = cand.key()
    return dropped


def walk(cfg: dict):
    skip = {d.casefold() for d in cfg.get("skip_dirs", [])}
    low = [norm(d).casefold() for d in cfg.get("low_trust_dirs", [])]
    for root in cfg.get("roots", []):
        rp = Path(norm(root))
        if not rp.exists():
            print(f"  ! root missing, skipped: {rp}", file=sys.stderr)
            continue
        for dirpath, dirnames, filenames in os.walk(rp):
            dirnames[:] = [d for d in dirnames
                           if d.casefold() not in skip and not d.startswith(".")]
            dl = dirpath.replace("\\", "/").casefold()
            is_low = any(dl == l or dl.startswith(l + "/") for l in low)
            for fn in filenames:
                if fn.startswith("."):
                    continue
                yield os.path.join(dirpath, fn), is_low


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="re-index exactly one file, in place")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    cfg = load_config(BRAIN_DIR)
    fp = knobs_fingerprint(cfg)
    index_path = BRAIN_DIR / "index.tsv"

    if a.file:
        target = norm(a.file)
        old_fp, rows = read_index(index_path)
        kept = [r for r in rows if r.path.casefold() != target.casefold()]
        low = [norm(d).casefold() for d in cfg.get("low_trust_dirs", [])]
        tl = str(Path(target).parent).replace("\\", "/").casefold()
        is_low = any(tl == l or tl.startswith(l + "/") for l in low)
        fresh = index_file(target, cfg, is_low) if os.path.exists(target) else []
        allrows = kept + fresh
        resolve_pointers(allrows)
        write_index(index_path, allrows, fp)
        log(BRAIN_DIR, "repair", f"{target} -> {len(fresh)} rows")
        if not a.quiet:
            print(f"repaired {target}: {len(fresh)} rows")
        return 0

    t0 = time.time()
    rows: list[Row] = []
    nfiles = corpus_bytes = 0
    for path, is_low in walk(cfg):
        rs = index_file(path, cfg, is_low)
        if rs:
            nfiles += 1
            corpus_bytes += rs[0].size
            rows.extend(rs)
    dropped = resolve_pointers(rows)
    write_index(index_path, rows, fp)
    dt = time.time() - t0
    log(BRAIN_DIR, "reindex", f"{nfiles} files, {len(rows)} rows, {dt:.1f}s")
    if not a.quiet:
        print(f"indexed {nfiles} files -> {len(rows)} sections in {dt:.1f}s")
        print(f"  fingerprint {fp}  |  dangling pointers dropped: {dropped}")
        print(f"  index size: {index_path.stat().st_size/1024:.0f} KB")
        if a.stats and rows:
            med = sorted(r.byte_end - r.byte_start for r in rows)[len(rows) // 2]
            print(f"  corpus {corpus_bytes/1024/1024:.1f} MB | median section "
                  f"{med} B | reduction ratio ~{corpus_bytes/max(med,1):.0f}x")
    return 0


def log(brain_dir: Path, kind: str, msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(brain_dir / "log.md", "a", encoding="utf-8", newline="\n") as f:
        f.write(f"## [{ts}] {kind} | {msg}\n")


if __name__ == "__main__":
    raise SystemExit(main())
