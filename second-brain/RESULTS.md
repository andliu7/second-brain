# Results

All numbers produced by `python bench.py --suite <file>`, on a 2,336-file / 3.0 MB corpus of
Kotlin/Java/TSX projects, markdown notes, superseded and contradictory duplicates, and a
low-trust Downloads folder. Tokens are estimated at 3.6 chars/token, applied identically to
every path, so the ratios are sound even though the absolute numbers are not exact. Run the
prompts in `TESTPROMPTS.md` for exact `/context` numbers on your own machine.

## The honest headline

The number that matters is the **hard suite**: 27 questions written by an independent critic
agent that had not seen the indexer, deliberately paraphrasing the facts rather than restating
the section headings, against a corpus seeded with distractors. The easy suite is included only
because it is what the system was originally tuned against, and the gap between the two is the
most instructive thing here.

### Hard suite (independent questions, distractor corpus)

| path | tokens | correct | tool calls |
|---|---|---|---|
| **BRAIN** | 12,145 | 26/27 | 29 |
| fresh default session | 44,634 | 20/27 | 105 |
| Claude Code auto memory | 170,118 | 22/27 | 119 |
| qmd (BM25) | 12,550 | 17/27 | 27 |

- vs fresh default session: **3.7x fewer tokens**, correctness 26/27 vs 20/27
- vs auto memory: **14.0x fewer tokens**, correctness 26/27 vs 22/27
- vs qmd: **1.0x fewer tokens**, correctness 26/27 vs 17/27

### Easy suite (my own questions - kept for contrast)

| path | tokens | correct | tool calls |
|---|---|---|---|
| **BRAIN** | 4,023 | 13/13 | 13 |
| fresh default session | 8,579 | 12/13 | 41 |
| Claude Code auto memory | 75,902 | 12/13 | 50 |
| qmd (BM25) | 1,751 | 12/13 | 13 |

- vs fresh default session: **2.1x fewer tokens**, correctness 13/13 vs 12/13
- vs auto memory: **18.9x fewer tokens**, correctness 13/13 vs 12/13
- vs qmd: **0.4x fewer tokens**, correctness 13/13 vs 12/13


## What the gauntlet actually caught

Every one of these was found by testing, not by reading. Several were found by critic agents with
fresh context attacking the build, which is the only reason they were found at all — the person
who writes the benchmark is the last person who can see what is wrong with it.

**The benchmark was rigged, and I wrote it.** The first `run_agentic` baseline used `rg -l`
(filenames only) and then read whole files. A real Claude Code session greps for *content* with
`-n` and a head limit, and on a sparse corpus one grep often returns the answer line outright. That
single wrong flag inflated the baseline about 6×. The headline went from a claimed **20.3×** to an
honest **2.1×** the moment it was fixed. Everything above this line in this document exists because
that number was wrong.

**The questions were written by the person who wrote the splitter.** Five of the original thirteen
restated a markdown `##` heading almost verbatim, and headings are weighted 3×, so those queries
were unloseable. Paraphrasing the same thirteen facts dropped the system from 13/13 to 9/13. The
hard suite exists because of this.

**The corpus had no haystack.** Every gold term appeared exactly once and nowhere else, so any
BM25 system scored near-perfectly. 145 distractor files, superseded decisions, and contradictory
restatements were added afterwards.

**Only the baseline was charged for being wrong.** Auto memory paid for falling through to agentic
search on a miss; the brain paid nothing for a bad bundle. Now both do.

**The rare-token clamp was a hard tier.** Any row matching one rare query token outranked any row
that did not, whatever the margin. The word "method" happened to be rare in this corpus, so *"what
methods does NestedObserverRepository8 have"* returned a Kotlin build-troubleshooting note instead
of the file literally named `NestedObserverRepository8.kt`. Now a multiplier, not a total order.

**The code splitter truncated every class at its first method,** because declarations were treated
as flat siblings instead of nesting by indent. "What methods does X have" was unanswerable.

**`q.py` held `index.tsv` open while the repair path did `os.replace` over it.** Fine on Linux,
`PermissionError` on Windows — which is where this actually ships.

**Pointer targets broke on paths with spaces.** `see: ../My Notes/extra info.md` silently truncated
at the first space, the pointer failed to resolve, and it was dropped with no error anyone would
see. Windows paths have spaces constantly.

**"Open exactly one file" was wrong.** It is a good instinct and it makes any question spanning two
documents structurally unanswerable. *"What java version and which gradle DSL do I use"* cannot be
answered from one file. Up to two extra near-tied sections from other files now join the bundle —
still one model call, still an order of magnitude below reading whole files.

**It confabulated on facts it did not have.** Asked *"do I use Jenkins or GitHub Actions for CI"* —
a fact absent from the corpus entirely — it confidently returned a note about the Lighthouse CI
action. It now checks whether the distinctive words you typed exist in the index at all, before
scoring gets a chance to rationalise an answer.

## Where it still loses

- **qmd matches it on tokens.** qmd returns tight ±5-line snippets; this returns whole sections.
  On correctness the gap is wide (26/27 vs 17/27) and on latency this is 2–4× faster, but anyone
  claiming a clean sweep on tokens would be lying.
- **1/27 on the hard suite: "what java package are the eclipse workspace classes in."** Not a code
  bug — `eclipse-workspace` is weighted 0.7 in the shipped profile as "rarely relevant", so a notes
  file mentioning Eclipse outranks the actual source tree. Raise the weight in `brain.json` if you
  disagree with that guess.
- **Superseded content can win.** *"How do we round currency"* returns the 2024 journal entry,
  which happens to contain the right answer next to the word SUPERSEDED. Lexical scoring has no
  concept of recency. Writing "SUPERSEDED" in the text is currently the only defence.
- **Synonym coverage is a hand-written list.** It fixed "published"→"deploy" and "memory"→"jvmargs",
  and it will not cover a word nobody thought of. This is a real ceiling, not a temporary one.
