# Second brain

A retrieval system for your own files that costs one model call.

Most of a memory lookup needs no intelligence at all, so none is used. Stripping a question to
keywords, deciding which of eight thousand sections could plausibly hold the answer, opening the
right file and cutting out the right paragraph — all of that is arithmetic, and arithmetic runs in
50 milliseconds. The model is invoked exactly once, at the end, with the evidence already attached.

Python 3.9+, standard library only. No server, no daemon, no watcher, no embeddings, no
dependencies to install, nothing to keep running.

---

## Install

```
python install.py
```

Detects your project folders, writes `brain.json`, adds a routing note to `~/.claude/CLAUDE.md`,
installs a `/brain` skill, and builds the first index. `--dry-run` shows you everything it would
do first. `--root "C:/path"` (repeatable) if you want to choose the folders yourself.

Run it **natively** — PowerShell on Windows, not through a network mount. Indexing walks every
file once, and a slow filesystem is the only thing that makes it slow.

## Use

```
python q.py "why did i pick Room instead of Realm"
python q.py "what methods does TransactionService have" --full
python q.py "gradle memory settings" --scope habit --trace
python remember.py "never mock the DB in integration tests" --kind decision --tags testing
python idx.py --stats
python bench.py
```

In Claude Code you don't type any of that — the routing note tells it to run `q.py` before
reaching for Grep, and the `/brain` skill covers the same ground when invoked directly.

---

## The retrieval ladder

Every question climbs the same six rungs, and the model only sees the top one.

1. **Strip the question to keywords.** Stopwords out, `camelCase` and `snake_case` split into
   parts *and* kept whole, a crude symmetric stemmer applied to both sides.
2. **Score every candidate from the index alone.** No corpus file is opened. Two passes: a cheap
   integer pass over the postings lists narrows thousands of sections to 300, then field-weighted
   BM25 runs on the survivors. Headings count 3×, path 2×, body 1×; each folder carries a
   multiplier from `brain.json`, so `Downloads` at 0.45 has to be genuinely better to win.
3. **Open the winning file** — and, only when other files score within 45% of it, up to two
   more sections from those files. The original rule was "exactly one file, never three"; it had
   to go, because a question like *"what Java version and which Gradle DSL do I use"* lives in two
   documents and is otherwise unanswerable. See `RESULTS.md`.
4. **Verify the file against the index** — `mtime_ns` and `size`. On a mismatch, re-index
   that single file inline (milliseconds), re-score, and continue. This is why the index cannot
   lie without a daemon watching anything.
5. **Read only the answering byte range.** `seek`, `read`. Constant time whatever the file size.
   If the top few sections of the same file are near-tied, widen to span them rather than
   coin-flip — still one file, one read.
6. **Follow at most one pointer,** resolved through the index, and only when the winning section
   is a signpost rather than an answer.

Then it prints the bundle and stops. There is no code path in `q.py` that calls a model, so
"exactly one model call" is a property of the design rather than a promise.

## The index

`index.tsv` — one row per **section**, not per file. A row is a pointer into a byte range, never a
summary, so it structurally cannot disagree with the source:

```
path  byte_start  byte_end  heading  kind  keywords  pointer  confidence  mtime_ns  size
```

The header line carries a fingerprint of every knob that changes what a row *means* — indexer
version, stopword list, scoring weights, roots, recognised extensions. Change any of them and
`q.py` refuses to run until you reindex. This catches the drift that timestamps can't: the files
didn't change, the rules did.

Files are split by type, because paying semantic-extraction cost on material that already has a
grammar is waste. Markdown splits on its heading tree. Code splits on declarations nested by
indent, so a class spans its whole body *and* its methods are separately addressable. Config files
stay whole. Anything in a low-trust folder gets its filename and first 200 bytes, is marked
`AMBIGUOUS`, and is scored down — enough to find, not enough to mislead.

## Saving a memory

```
python remember.py "<the fact>" --kind decision|pref|gotcha|fact --tags a,b
```

One command writes the file *and* its index line. There is no path through the program that does
one without the other, which is the entire anti-drift argument.

The kinds are ordered by how long they survive. **Prefer feedback to facts.** *"Never mock the DB
in integration tests"* is still true after you migrate; *"uses Postgres 16"* is wrong the moment
you upgrade, and wrong memories are worse than no memories.

## Reading the output

```
BRAIN C:/Users/you/notes/how-i-work.md#How I work > Commit style  [E 17/9]
~ Personal notes: how I work, decisions, reading.
## Commit style
Conventional commits, imperative mood...
```

`[E 17/9]` is confidence, score, margin. `E`/`I`/`A` = extracted / inferred / ambiguous — treat
`A` as the scorer guessing and say so in your answer. `W` = widened across near-tied sections.
`S` = code declaration skeleton; rerun with `--full` for method bodies. A **small margin** means
the top two candidates were close, which is exactly when to run `--trace` and look at the
runners-up.

## Honest limits

- **Read `RESULTS.md` before believing any number.** The first benchmark this system shipped with
  was rigged in its own favour — not deliberately, but because the person who writes the baseline
  is the worst person to judge whether it is fair. The honest figure against a real agentic session
  is about 4x, not the 20x the first harness reported.

- **Lexical, not semantic.** Ask with words that appear in the text. If you consistently ask about
  something using vocabulary the file never uses, add a heading that uses your words — headings
  are weighted 3×. This is a real limitation, not a temporary one.
- **`PRESCORE_KEEP = 300`.** A question made entirely of very common words can rank its answer
  outside the cheap first pass and never get fully scored. Raise it and re-measure; it costs
  latency, not correctness.
- **Low-trust folders are indexed 200 bytes deep.** An answer buried at byte 5000 of a Downloads
  file will not be found. That is deliberate, and it is also a hint about where that file belongs.
- **It does not beat default Claude on facts already in your always-loaded context.** Nothing
  beats already having the answer. The brain wins on facts buried inside files, questions needing
  more than one section, and saving new memories.
- **The corpus has to be worth indexing.** A workspace of pure source code with no notes gets far
  less from this than one with a real notes layer, because the highest-value rows are the ones you
  wrote on purpose.

## Files

```
brainlib.py   tokenizer, config, Row format, byte-exact line offsets, validation gate
idx.py        the indexer -- walk, split by type, validate, atomic write
q.py          the retrieval path -- no model call lives here
remember.py   write a memory and its index row, in one step
bench.py      four-way benchmark: brain vs agentic vs auto-memory vs qmd
install.py    one-time setup for this machine
index.tsv     the index (fingerprint in the header line)
log.md        append-only audit of reindexes, repairs and writes
memories/     what you asked it to remember
TESTPROMPTS.md  how to verify the claims yourself with /context
QMD-NOTES.md    what was taken from the four reference projects, and what was not
```
