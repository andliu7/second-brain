# What the four reference projects contributed, and what was deliberately left out

Nothing here was copied wholesale. Each mechanism below is in the build because it survived the
question "does this earn its keep on a single-user Windows machine with no server?"

## Taken

| Mechanism | From | Where it lives |
|---|---|---|
| A single small catalogue scored before any file is opened | Karpathy's `index.md` | `index.tsv`, one row per **section** |
| Append-only memory log with a rigid, greppable prefix | Karpathy's `log.md` | `memories/YYYY-MM.md`, `## [date] kind \| title` |
| `get file:from:count` — retrieval returns a **range**, not a document | qmd | `byte_start`/`byte_end` per row, `slice_bytes()` is a `seek`+`read` |
| Path-prefix context strings as both a score prior and an evidence header | qmd's `index.yml` `context:` map | `brain.json` `context`, longest prefix wins |
| mtime+size drift detection | qmd's `new/updated/unchanged/removed` diff | moved from a batch job to **per-query, on the one file being opened** |
| Zero-LLM pointer extraction at write time | gbrain's typed edges (+31.4 P@5, no model calls) | `PTR_PATTERNS`, one regex pass, `pointer` column |
| Named budget presets instead of loose knobs | gbrain's conservative/balanced/tokenmax | `--cap brief\|normal\|wide` |
| A config fingerprint in the artifact's identity | gbrain's `knobs_hash` | `index.tsv` header; `q.py` refuses to run on a mismatch |
| Retrieval that answers from the persisted artifact, never from a directory walk | Graphify v0.1.6 (25 tool calls / 90s → instant) | the whole design |
| Confidence enum on every row | Graphify `EXTRACTED\|INFERRED\|AMBIGUOUS` | `confidence` column, printed as `E`/`I`/`A` |
| Write-time validation gate | Graphify `validate.py` | `validate_row()`, plus pointer resolution dropping danglers |
| Path confinement checked again before every open | Graphify `security.py` | `under_roots()` in `verify_and_repair()` |
| Type-based dispatch; code skips semantic extraction | Graphify v0.1.5 | `.md` heading tree / code symbol tree / config / low-trust peek |
| Exact-match dominance, as a **floor** not a reranker | qmd's position-aware blend | `RARE_BONUS` — see the bug note below |
| Never filter after ranking | qmd #791/#803 (post-filter starvation) | `--scope` is applied **inside** the scoring loop |

## Left out, with reasons

| Not built | From | Why |
|---|---|---|
| Local GGUF embedding + reranker + query-expansion stack (~2 GB) | qmd | Native toolchain on Windows, per-query model load, and it puts three model calls in **front** of retrieval — the opposite of one call at the end |
| Vector search / `sqlite-vec` / pgvector | qmd, gbrain | Native extension pain on Windows; an index whose meaning silently changes when the embedding model rotates. Anthropic's own guidance: under ~200K tokens you don't need RAG, and their data shows hybrid BM25 contributes as much as embeddings do |
| PGLite / Postgres / Supabase | gbrain | WASM Postgres, migrations and engine-parity tests, to serve one person's notes folder |
| NetworkX graph + Leiden clustering + shortest paths | Graphify | Answers "what shape is this corpus". None of your questions are topology questions, and a graph invites the multi-hop traversal this design forbids |
| A generated `wiki/` consulted *before* the source | Graphify `--wiki` | A cache of a paraphrase sitting in front of the truth, free to disagree with it. This index stores byte pointers, so it structurally cannot |
| Any MCP server or daemon | all three | Lifecycle to babysit. qmd #806: a stale pidfile blocks startup and then SIGTERMs whatever unrelated process recycled that PID |
| File watchers / git hooks | Graphify `--watch`, gbrain `sync --watch` | They die silently and leave a confidently stale index. Lazy per-query verification is stateless and strictly stronger |
| Overnight autonomous consolidation | gbrain `dream` | Non-deterministic LLM rewriting of your own ground truth with no human in the loop |
| "Ingest updates 10–15 pages across the wiki" | Karpathy | An expensive many-file model edit per source, and the main mechanism by which contradictions get authored |
| Caching an interpreter path in a sidecar and shell-substituting it | Graphify #2856 | On Windows this is a *guaranteed* break: PowerShell writes a UTF-8 BOM, usernames contain spaces, unquoted `$(cat …)` word-splits. Their `query` command fails on every Windows box while `build` works fine |

## Two bugs this study directly prevented, and one it didn't

**Prevented — post-filter starvation.** qmd issues #791/#803: vector search fetched `limit * 3`
global nearest neighbours then filtered by collection, so a collection holding 0.7% of the corpus
returned *nothing* despite matching documents existing. `--scope` here is applied inside the
scoring loop for exactly that reason.

**Prevented — dangling pointers in the persisted artifact.** Graphify #2873: `graph.json`
contained edges to nodes that were never declared. `resolve_pointers()` drops any pointer that
does not resolve to a real index row, at index time, and reports the count.

**Not prevented — the exact-match clamp, implemented wrong first.** The repo study said "enforce
as a score *floor*, not a reranker." It was first built as a lexicographic *tier*: any row matching
a rare query token outranked any row that didn't, regardless of margin. In this corpus the word
"method" happened to be rare, so the question *"what methods does NestedObserverRepository8 have"*
returned a Kotlin build-troubleshooting note (score 7.96, one incidental rare hit) instead of the
file literally named `NestedObserverRepository8.kt` (score 66.53). A tier is a total order and
total orders have no mercy. It is now `score *= 1 + RARE_BONUS * rare_hits` — very hard to beat,
not impossible. The benchmark caught it; reading alone did not.

## On qmd specifically

qmd was installed and benchmarked, not just read. Two things are worth saying plainly:

1. **Its BM25 path is genuinely good and genuinely cheaper on tokens than this system** — it
   returns a tight ±5-line snippet where this returns a whole section. On a markdown-only corpus
   it is a serious competitor and you should not pretend otherwise.
2. **Its hybrid `query` path could not be run.** The model downloads
   (`embeddinggemma-300M`, `Qwen3-Reranker-0.6B`, `qmd-query-expansion-1.7B`, ~2 GB) returned
   HTTP 403 in this sandbox. So the benchmark compares against `qmd search`, its pure-BM25,
   no-model command. That is the *fairer* comparison anyway: `qmd query` makes three model calls
   before retrieval even starts, which is the design this system exists to avoid.

Where this system beats it: 2–4× lower latency, no 2 GB model stack, no Bun/`node-gyp` native
build (qmd's `better-sqlite3` install failed on the first attempt here and needs a compiler
toolchain — on Windows that means Visual Studio Build Tools), it indexes code, config and
low-trust junk rather than markdown only, and `remember.py` writes a memory and its index line in
one step with no model in the loop.

Where qmd beats it: tighter snippets, and a real hybrid-search story if you ever outgrow lexical.
