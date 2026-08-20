"""brainlib - shared deterministic primitives for the second brain.

No model calls. No third-party dependencies. Python 3.9+ stdlib only.

Everything in here that can change the MEANING of an index row is folded into
KNOBS_FINGERPRINT. q.py refuses to run against an index built under a different
fingerprint, which catches the drift class that mtime checks cannot: the files
did not change, the rules did.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import sys
from pathlib import Path, PurePosixPath

INDEXER_VERSION = "1.0.0"

# ---------------------------------------------------------------- tokenizer --

STOPWORDS = frozenset("""
a about above after again against all am an and any are as at be because been
before being below between both but by can cannot could did do does doing down
during each few for from further had has have having he her here hers herself
him himself his how i if in into is it its itself just me more most my myself
no nor not now of off on once only or other ought our ours ourselves out over
own same she should so some such than that the their theirs them themselves
then there these they this those through to too under until up very was we
were what when where which while who whom why with would you your yours
yourself yourselves does doesn isn aren wasn weren don didn won shouldn
couldn wouldn get got make made use used using want need know tell show give
thing things stuff anything something please help
""".split())

_SPLIT_RE = re.compile(r"[^A-Za-z0-9]+")
_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _stem(w: str) -> str:
    """Deliberately crude, deliberately symmetric. Applied to index and query
    alike, so it only has to be consistent, not linguistically correct."""
    if len(w) > 4:
        for suf in ("ities", "ing", "ies", "ed", "es", "ly", "s"):
            if w.endswith(suf) and len(w) - len(suf) >= 3:
                base = w[: -len(suf)]
                if suf == "ies":
                    base += "y"
                return base
    return w


def tokenize(text: str, keep_stop: bool = False) -> list[str]:
    """Text -> normalized tokens. Emits both the compound and its camel/snake
    parts so `getUserName` matches `user`, `name`, and `getusername`."""
    out: list[str] = []
    for raw in _SPLIT_RE.split(text or ""):
        if not raw:
            continue
        parts = _CAMEL_RE.split(raw)
        forms = [raw] + parts if len(parts) > 1 else [raw]
        for f in forms:
            f = f.lower()
            if len(f) < 2:
                continue
            if not keep_stop and f in STOPWORDS:
                continue
            out.append(_stem(f))
    return out


# A small, hand-written, query-time synonym map. This is the honest answer to
# the biggest weakness of a lexical retriever: you ask "how does my site get
# PUBLISHED" and the file says "DEPLOY". Expansion happens on the QUERY only, at
# query time, so it costs nothing at index time and you can edit it without
# reindexing. It is deliberately small and domain-specific -- a general thesaurus
# would blur the rare tokens that make scoring work.
SYNONYMS = {
    "publish": ["deploy", "host", "ship", "release"],
    "publi": ["deploy", "host", "ship", "releas"],
    "deploy": ["publish", "host", "release", "build"],
    "memory": ["ram", "heap", "jvmarg", "oom", "xmx"],
    "ram": ["memory", "heap", "jvmarg", "xmx"],
    "oom": ["memory", "heap", "jvmarg", "xmx"],
    "thread": ["worker", "concurrency", "parallel", "pool"],
    "worker": ["thread", "concurrency", "pool"],
    "round": ["rounding", "half", "even", "bigdecimal", "precision"],
    "currency": ["money", "bigdecimal", "invoice", "amount"],
    "money": ["currency", "bigdecimal", "amount", "invoice"],
    "editor": ["ide", "intellij", "studio", "vscode", "eclipse"],
    "ide": ["editor", "intellij", "studio", "vscode"],
    "install": ["version", "distribution", "build", "sdk", "use"],
    "distribution": ["version", "build", "vendor", "temurin"],
    "git": ["commit", "message", "branch", "merge"],
    "messag": ["commit", "convention", "style"],
    "word": ["style", "convention", "format", "phras"],
    "api": ["method", "function", "fun", "public", "interface"],
    "method": ["fun", "function", "api"],
    "stub": ["mock", "fake", "double"],
    "mock": ["stub", "fake", "testcontainer"],
    "wait": ["delay", "timeout", "backoff", "retry", "sleep"],
    "delay": ["wait", "timeout", "backoff"],
    "shell": ["terminal", "powershell", "bash", "wsl"],
    "todo": ["comment", "peeve", "rule"],
    "package": ["namespace", "import", "edu", "com"],
    "declar": ["class", "define", "file"],
    "lose": ["lost", "cost", "bug"],
    "storag": ["database", "room", "realm", "persist", "db"],
    "orm": ["hibernate", "jdbc", "sql", "jpa"],
    "ci": ["jenkins", "actions", "pipeline", "workflow"],
}


def expand(tokens: list[str]) -> list[str]:
    """Query tokens plus their synonyms, originals first so they keep priority."""
    out = list(tokens)
    for t in tokens:
        for syn in SYNONYMS.get(t, ()):
            st = _stem(syn)
            if st not in out:
                out.append(st)
    return out


# ------------------------------------------------------------------- config --

DEFAULT_CONFIG = {
    "roots": [],
    # longest-prefix wins. weight multiplies the final score; note is pasted
    # into the evidence header so the single model call knows what it is reading.
    "context": {},
    "weights": {"heading": 3.0, "path": 2.0, "symbol": 2.5, "body": 1.0},
    "caps": {"brief": 2000, "normal": 8000, "wide": 20000},
    "default_cap": "normal",
    "max_file_bytes": 2_000_000,
    "low_trust_dirs": [],
    "skip_dirs": [
        ".git", "node_modules", "build", "dist", "out", "target", "venv",
        ".venv", "__pycache__", ".gradle", ".idea", ".vscode", "bin", "obj",
        ".next", ".nuxt", "coverage", ".pytest_cache", ".mypy_cache", "vendor",
        "Pods", ".cxx", "site-packages", ".terraform", ".cache", "brain-out",
    ],
}

TEXT_EXT = {".md", ".markdown", ".txt", ".rst", ".org", ".adoc"}
CODE_EXT = {
    ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".py": "python",
    ".js": "js", ".jsx": "js", ".ts": "js", ".tsx": "js", ".mjs": "js",
    ".go": "go", ".rs": "rust", ".c": "c", ".h": "c", ".cpp": "c",
    ".hpp": "c", ".cc": "c", ".cs": "cs", ".rb": "ruby", ".php": "php",
    ".swift": "swift", ".scala": "scala", ".sh": "sh", ".ps1": "sh",
    ".sql": "sql", ".vue": "js", ".svelte": "js",
}
CONF_EXT = {
    ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".xml", ".gradle",
    ".properties", ".env", ".lock", ".csv", ".tsv",
}


def load_config(brain_dir: Path) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    p = brain_dir / "brain.json"
    if p.exists():
        user = json.loads(p.read_text(encoding="utf-8-sig"))
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


def knobs_fingerprint(cfg: dict) -> str:
    """Any knob that changes what an index row MEANS belongs in here."""
    payload = json.dumps(
        {
            "v": INDEXER_VERSION,
            "stop": sorted(STOPWORDS),
            "weights": cfg.get("weights"),
            "roots": sorted(norm(r) for r in cfg.get("roots", [])),
            "text_ext": sorted(TEXT_EXT),
            "code_ext": sorted(CODE_EXT),
            "conf_ext": sorted(CONF_EXT),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


# -------------------------------------------------------------------- paths --

def norm(p) -> str:
    """One canonical path spelling everywhere: absolute, forward slashes.
    Windows is case-insensitive, so compare casefolded but store as-is."""
    return str(Path(p).expanduser().resolve()).replace("\\", "/")


def under_roots(path: str, roots: list[str]) -> bool:
    """Read-time path confinement. Checked again before every open()."""
    pl = path.replace("\\", "/").casefold()
    for r in roots:
        rl = norm(r).casefold().rstrip("/")
        if pl == rl or pl.startswith(rl + "/"):
            return True
    return False


def context_for(path: str, ctx_map: dict) -> tuple[float, str]:
    """Longest-prefix wins. Returns (weight, note)."""
    pl = path.replace("\\", "/").casefold()
    best_len, best = -1, (1.0, "")
    for prefix, spec in (ctx_map or {}).items():
        pf = norm(prefix).casefold().rstrip("/")
        if pl == pf or pl.startswith(pf + "/"):
            if len(pf) > best_len:
                best_len = len(pf)
                if isinstance(spec, dict):
                    best = (float(spec.get("weight", 1.0)), str(spec.get("note", "")))
                else:
                    best = (1.0, str(spec))
    return best


# --------------------------------------------------------------- index rows --

COLUMNS = [
    "path", "byte_start", "byte_end", "heading", "kind", "keywords",
    "pointer", "confidence", "mtime_ns", "size",
]

_ESC = {"\t": "\\t", "\n": "\\n", "\r": "\\r", "\\": "\\\\"}
_UNESC = {"t": "\t", "n": "\n", "r": "\r", "\\": "\\"}


def esc(s: str) -> str:
    return "".join(_ESC.get(c, c) for c in (s or ""))


def unesc(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            out.append(_UNESC.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


class Row:
    __slots__ = tuple(COLUMNS)

    def __init__(self, **kw):
        for c in COLUMNS:
            setattr(self, c, kw.get(c))

    def to_line(self) -> str:
        return "\t".join(
            esc(str(getattr(self, c) if getattr(self, c) is not None else ""))
            for c in COLUMNS
        )

    @staticmethod
    def from_line(line: str) -> "Row":
        parts = line.rstrip("\n").split("\t")
        parts += [""] * (len(COLUMNS) - len(parts))
        d = {c: unesc(parts[i]) for i, c in enumerate(COLUMNS)}
        for f in ("byte_start", "byte_end", "mtime_ns", "size"):
            d[f] = int(d[f] or 0)
        return Row(**d)

    def key(self) -> str:
        return f"{self.path}#{self.byte_start}"

    def label(self) -> str:
        return f"{self.path}#{self.heading}" if self.heading else self.path


# validate.py-as-a-gate: a row that fails this never reaches the index.
def validate_row(r: Row, roots: list[str]) -> str | None:
    if not r.path:
        return "empty path"
    if r.byte_start >= r.byte_end:
        return f"inverted offsets {r.byte_start}>={r.byte_end}"
    if r.size and r.byte_end > r.size:
        return f"byte_end {r.byte_end} beyond file size {r.size}"
    if roots and not under_roots(r.path, roots):
        return "path escapes configured roots"
    if r.confidence not in ("EXTRACTED", "INFERRED", "AMBIGUOUS"):
        return f"bad confidence {r.confidence!r}"
    return None


INDEX_HEADER_PREFIX = "#brain-index\t"


def write_index(index_path: Path, rows: list[Row], fingerprint: str) -> None:
    """Atomic: write to a temp file, then replace. Never truncate in place.

    The retry loop is for Windows: os.replace() over a file another process has
    open raises PermissionError there (POSIX lets you rename over an open file;
    Windows does not). q.py closes its handle before triggering a repair, but a
    second Claude Code session, an editor, or an antivirus scanner can hold it
    for a few hundred milliseconds. Failing the write outright would leave the
    index un-updated with no error the user ever sees."""
    tmp = index_path.with_suffix(index_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{INDEX_HEADER_PREFIX}{fingerprint}\t{INDEXER_VERSION}\t{len(rows)}\n")
        for r in rows:
            f.write(r.to_line() + "\n")
    last = None
    for attempt in range(6):
        try:
            os.replace(tmp, index_path)
            return
        except PermissionError as e:      # Windows: target is open elsewhere
            last = e
            time.sleep(0.05 * (attempt + 1))
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise last


def read_index(index_path: Path) -> tuple[str, list[Row]]:
    rows: list[Row] = []
    fp = ""
    with open(index_path, "r", encoding="utf-8", newline="") as f:
        first = f.readline()
        if first.startswith(INDEX_HEADER_PREFIX):
            fp = first.rstrip("\n").split("\t")[1]
        elif first.strip():
            rows.append(Row.from_line(first))
        for line in f:
            if line.strip():
                rows.append(Row.from_line(line))
    return fp, rows


def append_rows(index_path: Path, rows: list[Row]) -> None:
    with open(index_path, "a", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(r.to_line() + "\n")


# ---------------------------------------------------------------- line index --

def read_lines_with_offsets(path: str) -> tuple[list[str], list[int], int]:
    """Byte-exact line offsets. Decode per line so multibyte characters can
    never shift an offset -- this is the bug that makes seek/read unsafe if you
    decode the whole file first."""
    with open(path, "rb") as f:
        data = f.read()
    lines, offsets, pos = [], [], 0
    for raw in data.splitlines(keepends=True):
        offsets.append(pos)
        pos += len(raw)
        # Strip a leading BOM from the DECODED text only. The byte offset is
        # already recorded, so the slice stays exact -- but a heading regex must
        # not be defeated by an invisible U+FEFF that PowerShell wrote.
        lines.append(raw.decode("utf-8", errors="replace")
                        .rstrip("\r\n").lstrip("\ufeff"))
    return lines, offsets, len(data)


def slice_bytes(path: str, start: int, end: int) -> str:
    with open(path, "rb") as f:
        f.seek(start)
        return f.read(max(0, end - start)).decode("utf-8", errors="replace")
