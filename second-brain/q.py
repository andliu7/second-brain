"""q.py - the deterministic retrieval path. THERE IS NO MODEL CALL IN THIS FILE.

The ladder, all plain code, all in milliseconds:
  1. strip the question to keywords (stopwords, camel/snake split, stem)
  2. score every candidate section FROM THE INDEX ONLY -- no corpus file opened
  3. open exactly ONE file: the winner
  4. verify that one file against the index (mtime_ns + size); repair inline on drift
  5. read only the answering byte range
  6. follow AT MOST ONE pointer, resolved through the index
  7. cap the bundle and print it

Claude Code reads stdout and answers in a single turn. That is the only model
call in the whole system, and it is structurally impossible for this file to
add another.

  python q.py "what did i decide about gradle"
  python q.py "..." --cap brief|normal|wide --scope android --trace --json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
from array import array
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from idx import SYMBOL_RE  # noqa: E402
from brainlib import (  # noqa: E402
    INDEX_HEADER_PREFIX, Row, context_for, expand, knobs_fingerprint, load_config, norm, read_index,
    slice_bytes, tokenize, under_roots,
)

BRAIN_DIR = Path(__file__).resolve().parent
K1, B = 1.4, 0.6
RARE_DF = 3          # a query token seen in <= this many sections is "rare"
HOP_MAX_BYTES = 400  # a winner this short is a signpost, not an answer
SKELETON_MIN = 1200  # code sections above this collapse to declaration lines
AMBIGUOUS_MARGIN = 0.15  # runner-up within this fraction of the winner = a coin flip
PHRASE_BONUS = 1.5       # per extra term in an in-order heading phrase match
MAX_EXTRA_FILES = 2      # extra near-tied sections from OTHER files in the bundle
CROSS_MARGIN = 0.45      # an extra file must score at least this fraction of the winner
SYN_WEIGHT = 0.45        # a synonym match counts less than the word you actually typed
MIN_CONFIDENT = 8.0      # below this the honest answer is "I do not have this"
WALL_CLOCK_LIMIT = 10.0


# ------------------------------------------------------------------- loading

def load(index_path: Path, fingerprint: str):
    """Cache holds INTEGERS ONLY -- postings, row lengths, and the byte offset of
    each row's line in index.tsv. Row objects are parsed lazily, and only for the
    few hundred candidates a query actually touches. Pickling 8k Row objects cost
    40ms and 4.6MB; this costs ~8ms and ~600KB."""
    st = index_path.stat()
    cache_key = f"{st.st_mtime_ns}:{st.st_size}:{fingerprint}"
    cache_path = BRAIN_DIR / "index.cache"
    if cache_path.exists():
        try:
            with open(cache_path, "rb") as f:
                blob = pickle.load(f)
            if blob.get("key") == cache_key:
                return blob["postings"], blob["lens"], blob["avg"], blob["offsets"]
        except Exception:
            pass

    postings: dict[str, array] = {}
    lens = array("i")
    offsets = array("q")
    with open(index_path, "rb") as f:
        pos = 0
        first = f.readline()
        pos += len(first)
        fp_on_disk = ""
        if first.startswith(INDEX_HEADER_PREFIX.encode()):
            fp_on_disk = first.decode().rstrip("\n").split("\t")[1]
        else:
            f.seek(0)
            pos = 0
        if fp_on_disk and fp_on_disk != fingerprint:
            print(f"BRAIN ERROR: index fingerprint {fp_on_disk} != current rules "
                  f"{fingerprint}. The scoring rules changed since this index was "
                  f"built. Run:  python idx.py", file=sys.stderr)
            raise SystemExit(3)
        i = 0
        for raw in f:
            if raw.strip():
                offsets.append(pos)
                cols = raw.decode("utf-8", "replace").rstrip("\n").split("\t")
                toks = (cols[5] if len(cols) > 5 else "").split()
                lens.append(len(toks) or 1)
                for t in set(toks):
                    a = postings.get(t)
                    if a is None:
                        a = postings[t] = array("i")
                    a.append(i)
                i += 1
            pos += len(raw)
    avg = (sum(lens) / len(lens)) if lens else 1.0
    try:
        tmp = cache_path.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            pickle.dump({"key": cache_key, "postings": postings, "lens": lens,
                         "avg": avg, "offsets": offsets}, f, protocol=4)
        os.replace(tmp, cache_path)
    except Exception:
        pass
    return postings, lens, avg, offsets


class LazyRows:
    """rows[i] parses one line on demand. Nothing else is ever materialised."""

    def __init__(self, index_path: Path, offsets):
        self._path = index_path
        self._f = open(index_path, "rb")
        self._off = offsets
        self._cache: dict[int, Row] = {}

    def close(self):
        """Windows cannot os.replace() over a file this process holds open, and
        the repair path does exactly that. Always close before repairing."""
        if self._f is not None:
            try:
                self._f.close()
            except OSError:
                pass
            self._f = None

    def reopen(self):
        if self._f is None:
            self._f = open(self._path, "rb")

    def __len__(self):
        return len(self._off)

    def __getitem__(self, i: int) -> Row:
        r = self._cache.get(i)
        if r is None:
            self.reopen()
            self._f.seek(self._off[i])
            r = Row.from_line(self._f.readline().decode("utf-8", "replace"))
            self._cache[i] = r
        return r

    def find_key(self, key: str):
        self.reopen()
        """Targeted lookup for a pointer target. A single C-speed bytes scan for
        the row's literal 'path\tbyte_start\t' prefix -- no per-row parsing.
        Only runs when a hop actually happens."""
        path, _, start = key.rpartition("#")
        needle = ("\n" + path.replace("\\", "\\\\") + "\t" + start + "\t").encode("utf-8")
        self._f.seek(0)
        data = self._f.read()
        j = data.find(needle)
        if j < 0:
            return None
        end = data.find(b"\n", j + 1)
        line = data[j + 1: end if end > 0 else len(data)]
        return Row.from_line(line.decode("utf-8", "replace"))


# ------------------------------------------------------------------- scoring

_path_tok_cache: dict[str, set] = {}


def path_toks(p: str) -> set:
    s = _path_tok_cache.get(p)
    if s is None:
        pp = Path(p)
        s = set(tokenize(" ".join(list(pp.parts[-3:]) + [pp.stem])))
        _path_tok_cache[p] = s
    return s


PRESCORE_KEEP = 300     # rows that survive the cheap pass and get fully scored
DF_CEILING = 0.25       # a token in >25% of sections is a stopword for THIS corpus
RARE_BONUS = 1.0        # multiplier per rare-token hit -- a FLOOR, not a tier


def score_all(qtoks, rows, postings, lens, avg, cfg, scope, qseq=None, typed=None):
    """Two passes, and the expensive one never runs on the whole index.

    Pass 1 is pure integer/float arithmetic over the postings lists -- it never
    parses a row, never touches the filesystem, and narrows thousands of
    candidates to PRESCORE_KEEP.
    Pass 2 does the real field-weighted BM25, but only on the survivors."""
    W = cfg["weights"]
    N = max(len(rows), 1)
    ctx_map = cfg.get("context", {})
    qseq = qseq if qseq is not None else list(qtoks)
    typed = set(typed if typed is not None else qtoks)

    df = {t: len(postings.get(t, ())) for t in qtoks}
    live = [t for t in qtoks if df[t] > 0]
    if not live:
        return [], set()
    idf = {t: math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)) for t in live}
    rare = {t for t in live if df[t] <= RARE_DF}

    # ---- pass 1: cheap prescore. Tokens that appear nearly everywhere are
    # skipped as candidate SOURCES (they still score if the row qualifies some
    # other way); if every token is that common, keep the rarest anyway.
    sources = [t for t in live if df[t] <= DF_CEILING * N] or \
              sorted(live, key=lambda t: df[t])[:1]
    pre: dict[int, float] = {}
    rare_hit: dict[int, int] = {}
    for t in sources:
        w_t, is_rare = idf[t], t in rare
        for i in postings[t]:
            pre[i] = pre.get(i, 0.0) + w_t
            if is_rare:
                rare_hit[i] = rare_hit.get(i, 0) + 1
    if not pre:
        return [], rare
    order = sorted(pre, key=lambda i: -(pre[i] * (1 + RARE_BONUS * rare_hit.get(i, 0))
                                        ))[:PRESCORE_KEEP]

    # ---- pass 2: full scoring on survivors only
    scope_l = scope.casefold() if scope else None
    scored = []
    for i in order:
        r = rows[i]
        if scope_l and scope_l not in r.path.casefold() and scope_l not in r.heading.casefold():
            continue
        head_seq = tokenize(r.heading)
        head = set(head_seq)
        pth = path_toks(r.path)
        kw = set(r.keywords.split())
        norm_len = 1 - B + B * (lens[i] / avg)
        s, hits, rare_hits = 0.0, 0, 0
        for t in live:
            w = 0.0
            if t in head:
                w += W["heading"]
            if t in pth:
                w += W["path"]
            if t in kw:
                w += W["body"]
            if w == 0:
                continue
            hits += 1
            if t in rare:
                rare_hits += 1
            contrib = idf[t] * (w * (K1 + 1)) / (w + K1 * norm_len)
            s += contrib if t in typed else contrib * SYN_WEIGHT
        if hits == 0:
            continue
        # Phrase adjacency. Terms appearing together IN ORDER in the heading are
        # far stronger evidence than the same terms scattered. Without this, a
        # section headed "Decode migration" cannot outrank a hundred unrelated
        # methods that merely mention both words -- which is exactly what the
        # recall test showed.
        if len(qseq) > 1:
            for n in range(len(qseq), 1, -1):
                if any(head_seq[j:j + n] == qseq[k:k + n]
                       for k in range(len(qseq) - n + 1)
                       for j in range(len(head_seq) - n + 1)):
                    s *= 1.0 + PHRASE_BONUS * (n - 1)
                    break

        weight, note = context_for(r.path, ctx_map)
        s *= weight
        if r.confidence == "AMBIGUOUS":
            s *= 0.6
        # coverage bonus: matching more distinct query terms beats matching one
        # term loudly.
        s *= 1.0 + 0.25 * (hits - 1)
        # Exact-rare-token bonus. This is a FLOOR, not a total order. As a
        # lexicographic tier it was actively harmful: any document matching one
        # incidental rare word ("method") outranked the exactly-named file,
        # whatever the margin. A multiplier makes a rare hit very hard to beat
        # without making it impossible to beat.
        s *= 1.0 + RARE_BONUS * rare_hits
        scored.append((rare_hits, s, i, note))
    scored.sort(key=lambda x: -x[1])
    return scored, rare


# ---------------------------------------------------------- drift + reading

def verify_and_repair(row: Row, cfg: dict, rows=None) -> tuple[Row | None, str]:
    """Lazy per-query drift check on THE ONE FILE we are about to open.
    This is what makes the index unable to lie, with no daemon and no watcher."""
    if not under_roots(row.path, cfg.get("roots", [])):
        return None, "path escapes configured roots -- refusing to open"
    try:
        st = os.stat(row.path)
    except OSError:
        return None, "file no longer exists"
    if st.st_mtime_ns == row.mtime_ns and st.st_size == row.size:
        return row, ""
    import subprocess
    if rows is not None:
        rows.close()          # must happen BEFORE idx.py os.replace()s the index
    subprocess.run([sys.executable, str(BRAIN_DIR / "idx.py"), "--file",
                    row.path, "--quiet"], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return None, "STALE"


def truncate(text: str, cap: int) -> tuple[str, bool]:
    if len(text.encode("utf-8")) <= cap:
        return text, False
    b = text.encode("utf-8")[:cap]
    s = b.decode("utf-8", errors="ignore")
    cut = s.rfind("\n\n")
    if cut < cap * 0.4:
        cut = s.rfind("\n")
    return (s[:cut] if cut > 0 else s), True


# ----------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("question", nargs="+")
    ap.add_argument("--cap", default=None, choices=["brief", "normal", "wide"])
    ap.add_argument("--scope", default=None)
    ap.add_argument("--trace", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-hop", action="store_true")
    ap.add_argument("--full", action="store_true",
                    help="return code bodies instead of the declaration skeleton")
    a = ap.parse_args()

    t0 = time.time()
    question = " ".join(a.question)
    cfg = load_config(BRAIN_DIR)
    fp = knobs_fingerprint(cfg)
    index_path = BRAIN_DIR / "index.tsv"
    if not index_path.exists():
        print("BRAIN ERROR: no index. Run:  python idx.py", file=sys.stderr)
        return 3

    qseq = tokenize(question)                      # order preserved, for phrases
    typed = list(dict.fromkeys(qseq))              # what the user actually typed
    qtoks = expand(typed)                          # plus deterministic synonyms
    if not qtoks:
        print("BRAIN: question reduced to zero keywords.", file=sys.stderr)
        return 2

    postings, lens, avg, offsets = load(index_path, fp)
    rows = LazyRows(index_path, offsets)

    # Absent-fact detection, before any scoring can rationalise a wrong answer.
    # If the DISTINCTIVE words the user typed appear nowhere in the index at all,
    # the corpus does not contain this. Synonym expansion makes it far too easy to
    # find a plausible-looking section anyway -- "jenkins or github actions for CI"
    # matched a note about the Lighthouse CI action -- so this check looks only at
    # what was actually typed, and only at whether the token exists at all.
    # Only DISTINCTIVE terms count. The first version of this check used
    # len > 3 and immediately refused "whose build of java do i install", because
    # "whose" and "install" are not in the index -- they are English, not content.
    # Requiring two absent terms of >=6 characters keeps the signal (jenkins,
    # github) and drops the noise (whose, word, list).
    missing = [t for t in typed if len(t) >= 6 and t not in postings]
    if len(missing) >= 2:
        print(f"BRAIN: no section anywhere in the index mentions {missing}. "
              f"The brain does not have this - say so plainly rather than "
              f"answering from a partial match, or fall back to Grep/Read.")
        return 1

    scored, rare = score_all(qtoks, rows, postings, lens, avg, cfg, a.scope, qseq, typed)

    if not scored:
        out = {"status": "no_match", "question": question, "tokens": qtoks}
        print(json.dumps(out) if a.json else
              f"BRAIN: no section in the index matches {qtoks}.\n"
              f"Answer from your own knowledge, or run: python idx.py")
        return 1

    # Refusing to answer. A retriever that always returns its best row will
    # confidently hand over a plausible section for a fact that is simply not in
    # the corpus, and the model has no way to tell. Below MIN_CONFIDENT the honest
    # output is "I do not have this", which costs 20 tokens and saves a wrong
    # answer. Tested explicitly by the ABSENT question in the hard suite.
    if scored and scored[0][1] < MIN_CONFIDENT:
        print(f"BRAIN: no section scores confidently for {typed} "
              f"(best {scored[0][1]:.1f} < {MIN_CONFIDENT}). The brain does not "
              f"have this. Say so, or fall back to Grep/Read.")
        return 1

    # open exactly one file -- the winner. One retry if it needed repair.
    winner = None
    for attempt in range(2):
        _, top_score, top_i, note = scored[0]
        cand = rows[top_i]
        fixed, err = verify_and_repair(cand, cfg, rows)
        if fixed is not None:
            winner = (fixed, top_score, note)
            break
        if err == "STALE" and attempt == 0:
            for p in (BRAIN_DIR / "index.cache",):
                p.unlink(missing_ok=True)
            postings, lens, avg, offsets = load(index_path, fp)
            rows = LazyRows(index_path, offsets)
            scored, rare = score_all(qtoks, rows, postings, lens, avg, cfg, a.scope, qseq, typed)
            if not scored:
                break
            continue
        scored = scored[1:]
        if not scored:
            break
    if winner is None:
        print("BRAIN: index pointed at a file that could not be read; "
              "run: python idx.py", file=sys.stderr)
        return 1

    row, score, note = winner

    # Sibling collapse. When the top candidates are near-tied sections of the
    # SAME file, picking one is a coin flip -- and the coin-flip loss is a wrong
    # answer. Widen to span them instead. Still exactly one file, one read.
    widened = 0
    sib_lo, sib_hi = row.byte_start, row.byte_end
    for rh, s, i, _ in scored[:8]:
        r2 = rows[i]
        if r2.key() == row.key():
            continue
        if r2.path.casefold() == row.path.casefold() and s >= 0.72 * score:
            sib_lo, sib_hi = min(sib_lo, r2.byte_start), max(sib_hi, r2.byte_end)
            widened += 1
    cap_probe = cfg["caps"][a.cap or cfg.get("default_cap", "normal")]
    if widened and (sib_hi - sib_lo) <= cap_probe:
        row_start, row_end = sib_lo, sib_hi
    else:
        widened, row_start, row_end = 0, row.byte_start, row.byte_end

    text = slice_bytes(row.path, row_start, row_end)

    # Code skeleton. A large code section answers "what does this class expose"
    # with its declaration lines; the method bodies are 90% of the bytes and
    # almost never the answer. Deterministic rule, no intent guessing: code
    # only, over SKELETON_MIN bytes, and --full always returns the real thing.
    skeleton = False
    if (not a.full and row.kind.startswith("code:")
            and len(text.encode()) > SKELETON_MIN):
        lang = row.kind.split(":", 1)[1]
        rx = SYMBOL_RE.get(lang)
        if rx is not None:
            keep = [ln for ln in text.splitlines()
                    if rx.match(ln) or ln.strip().startswith(
                        ("package ", "import ", "@", "//!", "///"))]
            if len(keep) >= 2:
                text = "\n".join(keep)
                skeleton = True

    # at most ONE pointer hop, resolved through the index (no filesystem scan)
    hop = None
    # Widening already gave us plenty of THIS file, so a hop is only still worth
    # it when the pointer leads somewhere else entirely.
    hop_worth_it = (not widened) or (
        row.pointer and row.pointer.rsplit("#", 1)[0].casefold() != row.path.casefold())
    if not a.no_hop and hop_worth_it and row.pointer and (
        len(text.encode()) < HOP_MAX_BYTES or "see:" in text.lower() or "ref:" in text.lower()
    ):
        tgt = rows.find_key(row.pointer)
        if tgt is not None:
            fixed, _ = verify_and_repair(tgt, cfg, rows)
            if fixed is not None:
                hop = (fixed, slice_bytes(fixed.path, fixed.byte_start, fixed.byte_end))

    # Extra sections from OTHER files. The original rule was "open exactly one
    # file, not three" -- but that rule makes any question spanning two documents
    # ("what java version AND which gradle dsl") structurally unanswerable, and it
    # loses coin-flips on near-ties. Opening at most two more near-tied sections
    # costs a few hundred tokens, keeps the single model call intact, and is still
    # an order of magnitude below reading whole files. Correctness first.
    extras = []
    seen_paths = {row.path.casefold()}
    for rh, sc, i, nt in scored[1:12]:
        if len(extras) >= MAX_EXTRA_FILES or sc < CROSS_MARGIN * score:
            break
        r2 = rows[i]
        if r2.path.casefold() in seen_paths:
            continue
        fixed2, _ = verify_and_repair(r2, cfg, rows)
        if fixed2 is None:
            continue
        seen_paths.add(r2.path.casefold())
        extras.append((fixed2, sc, slice_bytes(fixed2.path, fixed2.byte_start,
                                               fixed2.byte_end)))

    cap = cfg["caps"][a.cap or cfg.get("default_cap", "normal")]
    share = 1.0 / (1 + len(extras) + (1 if hop else 0))
    body, cut1 = truncate(text, max(600, int(cap * max(share, 0.4))))
    hop_body, cut2 = (truncate(hop[1], int(cap * 0.4)) if hop else ("", False))
    ms = (time.time() - t0) * 1000

    runners = [{"label": rows[i].label(), "score": round(s, 2), "rare": rh}
               for rh, s, i, _ in scored[1:6]]

    if a.json:
        print(json.dumps({
            "status": "ok", "question": question, "tokens": qtoks,
            "rare_tokens": sorted(rare), "ms": round(ms, 1),
            "winner": {"path": row.path, "heading": row.heading,
                       "kind": row.kind, "confidence": row.confidence,
                       "score": round(score, 2), "bytes": row_end - row_start,
                       "widened_sections": widened,
                       "context_note": note, "truncated": cut1},
            "evidence": body,
            "hop": ({"path": hop[0].path, "heading": hop[0].heading,
                     "evidence": hop_body, "truncated": cut2} if hop else None),
            "runners_up": runners,
        }, indent=1))
        return 0

    margin = score - (scored[1][1] if len(scored) > 1 else 0.0)

    # Output is deliberately spartan. Every line here is a line that enters the
    # context window on EVERY query, so anything that can live in CLAUDE.md once
    # per session (the "answer only from this" instruction) or behind --trace
    # (scorer diagnostics) does not belong in the default bundle.
    # Low-margin honesty. When the runner-up is within AMBIGUOUS_MARGIN of the
    # winner AND lives in a different file, the pick was close to a coin flip and
    # sibling collapse cannot help. Saying so costs ~25 tokens and stops the model
    # presenting a guess with the same confidence as a certainty.
    close = [r for r in runners
             if r["score"] >= score * (1 - AMBIGUOUS_MARGIN)
             and not r["label"].startswith(row.path)][:3]

    print(f"BRAIN {row.path}#{row.heading}"
          f"  [{row.confidence[0]}{'W' if widened else ''}"
          f"{'S' if skeleton else ''} {score:.0f}/{margin:.0f}]")
    if skeleton:
        print("~ declaration skeleton only - rerun with --full for method bodies")
    if close:
        print("~ AMBIGUOUS: these scored within "
              f"{int(AMBIGUOUS_MARGIN*100)}% and are in other files -- if the "
              "evidence below does not answer it, re-query with --scope:")
        for c in close:
            print(f"~   {c['label']}")
    if note:
        print(f"~ {note}")
    print(body)
    if cut1:
        print(f"[cut at {cap}B - rerun --cap wide for more]")
    if hop:
        print(f"BRAIN-HOP {hop[0].path}#{hop[0].heading}")
        print(hop_body)
    for r2, sc2, t2 in extras:
        b2, _ = truncate(t2, max(400, int(cap * share * 0.7)))
        print(f"BRAIN-ALSO {r2.path}#{r2.heading}  [{r2.confidence[0]} {sc2:.0f}]")
        print(b2)
    if a.trace:
        print(f"~trace {ms:.0f}ms {len(rows)} sections, keywords: {' '.join(qtoks)}"
              + (f", rare: {' '.join(sorted(rare))}" if rare else ""))
        for r in runners:
            print(f"~  {r['score']:7.2f} rare={r['rare']}  {r['label']}")
    if time.time() - t0 > WALL_CLOCK_LIMIT:
        print("BRAIN WARNING: retrieval exceeded wall-clock guard.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    except BrokenPipeError:
        # `q.py ... | head` closes the pipe early. Without this, Python prints a
        # scary traceback on exit and Claude Code reports it as a tool failure.
        try:
            os.close(sys.stdout.fileno())
        except OSError:
            pass
        rc = 0
    raise SystemExit(rc)
