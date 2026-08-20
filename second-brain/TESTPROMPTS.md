# Prove it yourself

`bench.py` measures the deterministic side precisely, but it estimates tokens at 3.6 chars/token.
The only exact measurement is `/context` inside a real Claude Code session. These prompts get you
that number in about ten minutes. Rerun them whenever you change the scoring weights, add a big
folder, or suspect the brain has stopped earning its keep.

Pick **five questions about your own workspace** whose answers you already know — ideally the ones
in `questions.json`, since those have gold answers recorded. The brain wins on facts buried inside
files, questions needing more than one section, and saving new memories. It does **not** win on
facts already sitting in your always-loaded index — there, default Claude is instantly fast, and
that is your index doing its job, not a failure.

---

## Round A — fresh default session (the baseline)

Open a new Claude Code session in your workspace. **Do not let it use the brain.**

```
For this session, ignore the second-brain routing note in CLAUDE.md entirely. Do not run q.py.
Answer these five questions using only Glob, Grep and Read. Answer each fully before starting
the next, and after each one print the question number.

1. <your question 1>
2. <your question 2>
3. <your question 3>
4. <your question 4>
5. <your question 5>
```

Then, in the same session:

```
/context
```

Record: **total tokens used**, and the wall-clock time from your first message to the last answer.
Also record how many of the five answers were actually correct — a cheap wrong answer is not a win.

---

## Round B — the brain

Open a **new** Claude Code session (fresh context, same workspace).

```
Answer these five questions. For each one, run q.py exactly once and answer only from the evidence
bundle it prints. Do not use Grep or Read unless q.py reports no match. Print the question number
after each answer.

1. <same question 1>
2. <same question 2>
3. <same question 3>
4. <same question 4>
5. <same question 5>
```

```
/context
```

Record the same three numbers.

---

## Round C — the write path

This is where the brain wins most and where the benchmark understates it, because saving a memory
in a default session means the model deciding what to write, where to put it, and then editing an
index by hand — three or four model turns and a real chance of the index drifting out of sync.

Fresh session, no brain:

```
Remember this for future sessions: <a real decision you made this week, one sentence>.
Store it wherever you think it belongs and make sure a future session can find it.
```

`/context`, and note how many tool calls it took and whether it updated any index.

Fresh session, with the brain:

```
Remember this: <the same decision>. Use remember.py.
```

`/context`. One command, one file write, one index line, no drift possible.

---

## Filling in the table

| | Round A (default) | Round B (brain) | Round C-default | Round C-brain |
|---|---|---|---|---|
| tokens (`/context`) | | | | |
| wall time | | | | |
| answers correct | /5 | /5 | — | — |
| tool calls | | | | |

**The pass/fail line:** Round B must use fewer tokens than Round A *and* be at least as correct.
If it is cheaper but less correct, it has failed — go back to `bench.py --json`, find which
question regressed, and rerun `q.py "<that question>" --trace` to see what the scorer preferred
and why.

## When the brain loses

It happens, and the reasons are usually one of these:

- **The answer was in a file the indexer skipped.** Check `skip_dirs` and `max_file_bytes` in
  `brain.json`, and whether the extension is in `TEXT_EXT`/`CODE_EXT`/`CONF_EXT` in `brainlib.py`.
- **The question shares no rare words with the section.** Look at `--trace`: if the winning score
  is low and the margin is near zero, the scorer was guessing. Add a heading to the source file
  that uses the words you actually ask with — the heading is weighted 3× the body.
- **A folder weight buried it.** `Downloads` is at 0.45 by design. If a real answer lives there,
  it should probably not live there.
- **Prescore cut it.** `PRESCORE_KEEP` in `q.py` is 300. A query made entirely of very common
  words can rank the right answer outside that window. Raise it and re-measure; it costs latency,
  not correctness.
