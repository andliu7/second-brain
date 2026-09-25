#!/usr/bin/env node
// Second brain retrieval gauntlet, v3.
//
// One question goes to two arms of the same model on the same machine.
//
//   ARM A "brain" : told to run a launcher, ask.py, sitting in its own working
//                   directory, and to answer from the bundle it prints.
//   ARM B "map"   : same question, no mention of the brain, so it navigates
//                   with Andrew's own hand-written repo map plus Grep and Read.
//
// The arms differ in exactly one paragraph of the prompt. Same model, same
// flags, same tools, same permission handling, same copy of the repo map, same
// workspace root. Everything else is held still on purpose.
//
// Node 18+, no dependencies, runs from PowerShell 5.1.
//
//   node bench\run.mjs --check-only
//   node bench\run.mjs --ids q01,q04,q06 --repeats 1 --label smoke3
//   node bench\run.mjs --repeats 3 --label full
//   node bench\run.mjs --rescore bench\results-full.json
//
// Writes results-<label>.json and results-<label>.md next to this file.
//
// ---------------------------------------------------------------- ARM B is not blind grep
//
// Andrew's hand-written C:\Users\zeusa\Downloads\Projects\CLAUDE.md is the real
// competitor here, not an empty prompt. It routes several of these questions in
// one hop and he wrote it himself. So a copy of it is written into BOTH arms'
// working directories, with one section removed: "Finding things", the section
// that names second-brain/index.tsv and second-brain/README.md. That is the only
// deletion, it is done by locating the heading rather than by hand, and the
// removed text is stored verbatim in results.json so it can be audited.
//
// Neither arm is spawned with --safe-mode. Safe mode was measured on this
// machine on 2026-09-23: it drops the working directory's CLAUDE.md as well as
// the user-level one, so it would take the repo map away from ARM B, which is
// the whole complaint that sank the previous harness.
//
// ---------------------------------------------------------------- the user-level note
//
// One thing cannot be switched off. C:\Users\zeusa\.claude\CLAUDE.md opens with
// "Memory: check the index before you search" and prints the absolute path to
// q.py. Measured on 2026-09-23 on this machine:
//
//   * --setting-sources project,local does NOT drop it. A probe session with a
//     one-line project note quoted the q.py sentence straight back.
//   * --safe-mode drops it, but drops the working directory note too.
//   * --bare drops CLAUDE.md discovery but requires ANTHROPIC_API_KEY; this
//     machine authenticates by OAuth, so the spawn would not start.
//   * CLAUDE_CONFIG_DIR relocates it, but the relocated directory carries no
//     login. Copying a credentials file to make a benchmark run is not
//     something this harness will do.
//
// So it is in both arms' context, identically, and it is handled in the prompt
// instead: BOTH arms are told, in the same words, to ignore any loaded note that
// says to consult a second-brain index or q.py. Two consequences, both stated
// rather than hidden:
//
//   1. ARM B is not quietly turned into ARM A. Every ARM B transcript is
//      scanned for brain tooling anyway and any hit is reported as
//      contamination, not silently averaged in.
//   2. The absolute path to q.py reaches both arms equally, so it is no longer
//      an advantage handed to one of them. This harness's own prompts contain
//      no absolute path except the workspace root, which both arms get.
//
// ---------------------------------------------------------------- what is measured
//
// Token counts and dollars come out of the final result event of
// --output-format stream-json, which is what the API actually billed. Nothing
// here is estimated from string lengths.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = resolve(HERE, "..");                 // holds q.py
const PROJECTS_ROOT = "C:\\Users\\zeusa\\Downloads\\Projects";
const REPO_MAP_SOURCE = join(PROJECTS_ROOT, "CLAUDE.md");
const INDEX_TSV = join(BRAIN_DIR, "index.tsv");
const QUESTIONS_FILE = join(HERE, "questions.json");
const ARM_ROOT = join(tmpdir(), "brainbench-arms");

// --------------------------------------------------------------------- args

function parseArgs(argv) {
  const out = { repeats: 3, label: "run", ids: null, checkOnly: false, rescore: null, timeoutMs: 300000, arms: ["A", "B"] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repeats") out.repeats = Number(argv[++i]);
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--ids") out.ids = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--check-only") out.checkOnly = true;
    else if (a === "--rescore") out.rescore = argv[++i];
    else if (a === "--timeout") out.timeoutMs = Number(argv[++i]);
    else if (a === "--arm") out.arms = [argv[++i].toUpperCase()];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.repeats) || out.repeats < 1) throw new Error("--repeats must be 1 or more");
  return out;
}

// ------------------------------------------------------------------ helpers

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function spread(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { n: s.length, min: s[0], p25: at(0.25), median: median(s), p75: at(0.75), max: s[s.length - 1] };
}
const round = (x, d = 4) => (x == null ? null : Number(x.toFixed(d)));

// ------------------------------------------------------- the sanitised repo map
//
// Removes exactly one section, located by its heading, and returns both the
// kept text and the removed text so the edit can be audited.

function sanitiseRepoMap(raw) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Finding things");
  if (start === -1) {
    return { text: raw, removed: "", removedHeading: null, note: "no '## Finding things' heading found; map passed through unchanged" };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const removed = lines.slice(start, end).join("\n");
  const kept = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return { text: kept, removed, removedHeading: "## Finding things", note: "one section removed, located by heading" };
}

// --------------------------------------------------------------- arm working dirs

const ASK_PY = `# Launcher. Asks the second brain and prints its bundle.
# The brain's location comes from the environment, not from this file, so that
# reading this file tells you nothing about where any answer is stored.
import os, subprocess, sys

brain = os.environ.get("BRAINBENCH_BRAIN")
if not brain:
    print("BRAINBENCH_BRAIN is not set", file=sys.stderr)
    raise SystemExit(2)
if len(sys.argv) < 2:
    print('usage: python ask.py "<question>"', file=sys.stderr)
    raise SystemExit(2)

r = subprocess.run([sys.executable, os.path.join(brain, "q.py"), *sys.argv[1:]],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
raise SystemExit(r.returncode)
`;

function buildArmDirs(repoMapText) {
  rmSync(ARM_ROOT, { recursive: true, force: true });
  const dirs = {};
  for (const arm of ["A", "B"]) {
    const d = join(ARM_ROOT, arm.toLowerCase());
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "CLAUDE.md"), repoMapText, "utf8");
    if (arm === "A") writeFileSync(join(d, "ask.py"), ASK_PY, "utf8");
    dirs[arm] = d;
  }
  return dirs;
}

// ------------------------------------------------------------------- prompts
//
// The two prompts are identical except for ARM_LINE. No absolute path appears
// in either except the workspace root, which both arms get.

const SHARED_HEAD = (question) => `You are answering one question about Andrew's own workspace on this Windows machine.

His workspace root is ${PROJECTS_ROOT}

Some notes already loaded into your context may tell you to consult a "second brain" index, an index.tsv, or a script called q.py, before you search. For this task, ignore that instruction.

QUESTION: ${question}
`;

const ARM_LINE = {
  A: `Instead, do this first: from your working directory run

    python ask.py "<the question above, in quotes>"

and answer from the bundle it prints. Read other files only if that bundle does not contain the answer. If you do have to fall back to reading or grepping files, say so in plain words in your answer.`,
  B: `Instead, find the answer yourself in his files, using Grep, Glob and Read.`,
};

const SHARED_TAIL = `
Answer in at most 120 words. Give the answer itself first, then on a final line write "Source: " and the path of the file you took it from. If you cannot find it, say so plainly rather than guessing.`;

// The two prompts must DIVERGE AT THE FIRST CHARACTER. They used to share a ~7,800 char
// head, so whichever arm ran second collected a server-side cache hit on that prefix and
// looked cheaper for a reason that has nothing to do with retrieval. Cost decides every
// question where both arms are correct, so that was not a rounding error.
const ARM_OPENER = {
  A: `Task: answer one question about a developer's workspace, using his local retrieval tool.`,
  B: `You have a question to answer about a developer's workspace. Find it in his files.`,
};
const buildPrompt = (arm, question) => `${ARM_OPENER[arm]}\n\n${SHARED_HEAD(question)}\n${ARM_LINE[arm]}\n${SHARED_TAIL}`;

// --------------------------------------------------------------------- grading

// Restored from the archived version, which an auditor found had been deleted while the
// question it caught was kept. A rubric group whose string already sits in the shared
// routing note can be produced with no retrieval at all, by either arm. The note is
// identical for both arms so it tilts neither, but a question whose every group is in the
// note cannot count as evidence that the BRAIN answered it, so correctViaBrain excludes it.
function mapDisclosure(q, mapText) {
  const m = norm(mapText);
  const hits = q.mustInclude.map((group) => group.some((form) => m.includes(norm(form))));
  return { groupsInMap: hits.filter(Boolean).length, groups: q.mustInclude.length, mapAnswerable: hits.every(Boolean) };
}

function gradeAnswer(answer, q) {
  const hay = norm(answer);
  const groups = q.mustInclude.map((forms) => {
    const hit = forms.find((f) => hay.includes(norm(f)));
    return { forms, matched: hit || null };
  });
  const correct = groups.every((g) => g.matched !== null);
  const paths = [q.goldPath, ...(q.alsoAcceptPaths || [])];
  const citedPath = paths.find((p) => {
    const a = norm(p), b = norm(p.replace(/\//g, "\\"));
    // accept the tail of the path too, e.g. "dashboard/README.md" cited as "README.md"
    // only when the distinctive parent is also present somewhere in the answer.
    return hay.includes(a) || hay.includes(b);
  }) || null;
  return { correct, groups, citedPath, pathCited: citedPath !== null };
}

const NO_OP_PATTERNS = [
  /fell back/i, /falling back/i, /had to (read|grep|search)/i,
  /(bundle|index|brain|ask\.py|q\.py)[^.]{0,80}(did not|didn't|does not|doesn't|no|none)[^.]{0,40}(contain|surface|return|have|find|match|answer|result)/i,
  /(no|not|nothing)[^.]{0,40}(in the (bundle|index))/i,
  /(bundle|index) (was|is|came back) empty/i,
  /so i (read|grepped|searched|opened)/i,
  /(did ?n.?t|could ?n.?t|didn't|couldn't) find .{0,40}(via|with|using|from|in) (ask\.py|q\.py|the (bundle|brain|index))/i,
  /(ask\.py|q\.py|the bundle|the brain|the index)[^.]{0,70}(returned|gave|produced|surfaced)[^.]{0,70}(unrelated|nothing|no |irrelevant|wrong|outdated|ambiguous)/i,
  /found (it )?by (grepping|reading|searching)/i,
];
const BRAIN_TOOLING = [/q\.py/i, /index\.tsv/i, /brainlib/i, /ask\.py/i, /serve\.py/i, /index\.cache/i];
// The answer key, the rubrics and every prior transcript live in bench/, inside the search
// space both arms are given. Nothing has read it so far, but nothing detected it either.
const BENCH_PEEK = [/[\\/]bench[\\/]/i, /questions\.json/i, /results-[\w.-]*\.(json|md)/i];

function classifyRun(arm, answer, toolCalls) {
  const text = String(answer || "");
  const selfReported = NO_OP_PATTERNS.some((re) => re.test(text));
  const benchPeeks = toolCalls.filter((t) => BENCH_PEEK.some((re) => re.test(t.detail || "")));
  const brainCalls = toolCalls.filter((t) => BRAIN_TOOLING.some((re) => re.test(t.detail || "")));
  const fileCalls = toolCalls.filter(
    (t) => ["Read", "Grep", "Glob"].includes(t.name) || (t.name === "Bash" && !BRAIN_TOOLING.some((re) => re.test(t.detail || "")))
  );
  if (arm === "A") {
    return {
      brainCallCount: brainCalls.length,
      fileCallCount: fileCalls.length,
      noOpSelfReported: selfReported,
      noOpByToolUse: brainCalls.length > 0 && fileCalls.length > 0,
      brainNeverCalled: brainCalls.length === 0,
      benchPeekCount: benchPeeks.length,
      benchPeekCalls: benchPeeks.map((t) => t.detail),
    };
  }
  return { contaminated: brainCalls.length > 0, benchPeekCount: benchPeeks.length, benchPeekCalls: benchPeeks.map((t) => t.detail), contaminatingCalls: brainCalls.map((c) => c.detail).slice(0, 5), fileCallCount: fileCalls.length };
}

// -------------------------------------------------------------- pre-run checks
//
// Rule: no accepted surface form may appear in the question that asks for it,
// and no rubric may be satisfied by generic English or by echoing the question.

const GENERIC_NON_ANSWERS = [
  "I could not find the answer in the workspace.",
  "It is documented in the repository. See the README for the details and the reasoning behind the decision.",
  "The decision was made because it is simpler, safer and easier to maintain, and the relevant file is in the repo. Source: README.md",
  "This lives in the second brain index, under the section that covers it. Check there first.",
  "Yes. The separate file behind the folder covers this, and the setup is standard for a project like this one, so the usual approach applies. It is in the main directory with the other configuration, and the reason is performance and security. Source: CLAUDE.md",
  "The answer is in his notes. He decided this earlier and wrote it down at the time, with the reason, in the file that holds his decisions.",
];

function runChecks(spec) {
  const leaks = [];
  for (const q of spec.questions) {
    const qtext = norm(q.question);
    for (const forms of q.mustInclude) {
      for (const f of forms) {
        if (norm(f).length >= 3 && qtext.includes(norm(f))) leaks.push({ id: q.id, form: f });
      }
    }
  }

  const genericPasses = [];
  for (const q of spec.questions) {
    for (const g of GENERIC_NON_ANSWERS) {
      if (gradeAnswer(g, q).correct) genericPasses.push({ id: q.id, text: g.slice(0, 60) });
    }
    // the strongest version of the leak check: the question's own words, graded
    // through its own rubric, must fail.
    if (gradeAnswer(q.question, q).correct) genericPasses.push({ id: q.id, text: "<the question text itself>" });
  }

  const goldFails = [];
  for (const q of spec.questions) {
    if (!gradeAnswer(q.goldAnswer, q).correct) goldFails.push(q.id);
  }
  return { leaks, genericPasses, goldFails, genericProbeCount: GENERIC_NON_ANSWERS.length + 1 };
}

// ---------------------------------------------------------------- the spawn

function cliArgs() {
  return [
    "-p",
    "--model", "sonnet",
    "--output-format", "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--permission-prompts", "none",
    "--add-dir", PROJECTS_ROOT,
    "--allowedTools", "Read", "Grep", "Glob", "Bash",
    "--disallowedTools", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task",
  ];
}

function askArm(arm, cwd, prompt, timeoutMs) {
  return new Promise((done) => {
    const env = { ...process.env, BRAINBENCH_BRAIN: BRAIN_DIR };
    const started = Date.now();
    const child = spawn("claude.exe", cliArgs(), { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    let buf = "", stderr = "";
    const events = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { events.push(JSON.parse(line)); } catch { /* not a json line */ }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { stderr += c; });

    child.on("close", (code) => {
      clearTimeout(timer);
      const wallSec = (Date.now() - started) / 1000;
      const init = events.find((e) => e.type === "system" && e.subtype === "init");
      const result = events.find((e) => e.type === "result");

      const toolCalls = [];
      for (const e of events) {
        if (e.type !== "assistant") continue;
        for (const blk of e.message?.content || []) {
          if (blk.type !== "tool_use") continue;
          const i = blk.input || {};
          const detail = [i.command, i.file_path, i.pattern, i.path, i.glob].filter(Boolean).join(" | ");
          toolCalls.push({ name: blk.name, detail });
        }
      }

      const u = result?.usage || {};
      done({
        ok: !killed && code === 0 && !!result && result.is_error !== true,
        killed,
        exitCode: code,
        stderr: stderr.slice(-800),
        answer: result?.result ?? "",
        wallSec: round(wallSec, 2),
        apiMs: result?.duration_api_ms ?? null,
        numTurns: result?.num_turns ?? null,
        costUsd: result?.total_cost_usd ?? null,
        tokens: {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheCreation: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
        },
        resolvedModel: init?.model ?? null,
        toolCalls,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// --------------------------------------------------------------------- report

function totalTokens(t) { return t.input + t.output + t.cacheCreation + t.cacheRead; }

function summarise(rows, spec, mapText = "") {
  // Questions whose every rubric group is already in the shared routing note. Either arm
  // can produce those words with no retrieval, so they cannot be evidence that the brain
  // answered anything. Reported, and excluded from correctViaBrain, never silently dropped.
  const disclosure = new Map(spec.questions.map((q) => [q.id, mapDisclosure(q, mapText)]));
  const freeFromMap = new Set(spec.questions.filter((q) => disclosure.get(q.id).mapAnswerable).map((q) => q.id));

  const byArm = {};
  for (const arm of ["A", "B"]) {
    const rs = rows.filter((r) => r.arm === arm && r.ok);
    const costs = rs.map((r) => r.costUsd).filter((x) => x != null);
    const secs = rs.map((r) => r.wallSec);
    byArm[arm] = {
      runs: rs.length,
      failedSpawns: rows.filter((r) => r.arm === arm && !r.ok).length,
      correct: rs.filter((r) => r.grade.correct).length,
      correctRate: rs.length ? round(rs.filter((r) => r.grade.correct).length / rs.length, 3) : null,
      // For ARM A only: correct AND the brain actually produced it. A run that fell back to
      // reading files is a run ARM B's method answered, so it cannot count for the brain.
      correctViaBrain: rs.filter((r) => r.grade.correct && !freeFromMap.has(r.id) && !(r.armInfo.noOpSelfReported || r.armInfo.noOpByToolUse || r.armInfo.brainNeverCalled)).length,
      correctButFreeFromMap: rs.filter((r) => r.grade.correct && freeFromMap.has(r.id)).length,
      pathCited: rs.filter((r) => r.grade.pathCited).length,
      costUsd: spread(costs),
      wallSec: spread(secs),
      tokensSummed: {
        input: rs.reduce((a, r) => a + r.tokens.input, 0),
        output: rs.reduce((a, r) => a + r.tokens.output, 0),
        cacheCreation: rs.reduce((a, r) => a + r.tokens.cacheCreation, 0),
        cacheRead: rs.reduce((a, r) => a + r.tokens.cacheRead, 0),
        all: rs.reduce((a, r) => a + totalTokens(r.tokens), 0),
      },
      tokensPerRun: spread(rs.map((r) => totalTokens(r.tokens))),
    };
  }

  // per question: majority correctness across repeats, then a win count
  const perQuestion = [];
  for (const q of spec.questions) {
    const cell = (arm) => rows.filter((r) => r.arm === arm && r.id === q.id && r.ok);
    const a = cell("A"), b = cell("B");
    const maj = (rs) => (rs.length ? rs.filter((r) => r.grade.correct).length * 2 > rs.length : null);
    const aOk = maj(a), bOk = maj(b);
    const aNoOp = a.some((r) => r.armInfo.noOpSelfReported || r.armInfo.noOpByToolUse || r.armInfo.brainNeverCalled);
    // A no-op is a question the brain did not answer: it was answered by falling back to
    // files, which is what ARM B does anyway. It never counts toward ARM A, in any branch.
    // The earlier version applied this only when A won alone, so a no-op that both arms
    // got right still scored as "both" and inflated ARM A's correctness.
    let winner = "n/a";
    if (aOk !== null && bOk !== null) {
      const aBrainOk = aOk && !aNoOp;
      if (aBrainOk && !bOk) winner = "A";
      else if (bOk && !aBrainOk) winner = aNoOp && aOk ? "B (A answered only after the index failed it)" : "B";
      else if (aBrainOk && bOk) winner = "both";
      else if (aNoOp && aOk) winner = "A (no-op, not a brain win)";
      else winner = "neither";
    }
    perQuestion.push({
      id: q.id, kind: q.kind, indexedInBrain: q.indexedInBrain,
      aCorrect: a.filter((r) => r.grade.correct).length, aRuns: a.length,
      bCorrect: b.filter((r) => r.grade.correct).length, bRuns: b.length,
      aMedianCost: round(median(a.map((r) => r.costUsd).filter((x) => x != null)), 4),
      bMedianCost: round(median(b.map((r) => r.costUsd).filter((x) => x != null)), 4),
      aMedianTokens: median(a.map((r) => totalTokens(r.tokens))),
      bMedianTokens: median(b.map((r) => totalTokens(r.tokens))),
      brainNoOp: aNoOp,
      mapAnswerable: disclosure.get(q.id).mapAnswerable,
      groupsInMap: `${disclosure.get(q.id).groupsInMap}/${disclosure.get(q.id).groups}`,
      winner,
    });
  }

  const wins = { A: 0, AnoOp: 0, B: 0, both: 0, neither: 0, unscored: 0 };
  for (const p of perQuestion) {
    if (p.winner === "A") wins.A++;
    else if (p.winner.startsWith("A (no-op")) wins.AnoOp++;
    else if (p.winner.startsWith("B")) wins.B++;   // includes "B (A answered only after the index failed it)"
    else if (p.winner === "both") wins.both++;
    else if (p.winner === "neither") wins.neither++;
    else wins.unscored++;                          // "n/a", a question with no usable runs
  }
  // An earlier version of this tally silently dropped a verdict string that matched no
  // bucket, so ARM B wins vanished from the headline and the counts did not sum. Fail loudly.
  const tallied = wins.A + wins.AnoOp + wins.B + wins.both + wins.neither + wins.unscored;
  if (tallied !== perQuestion.length) {
    throw new Error(`wins tally ${tallied} does not match ${perQuestion.length} questions: a verdict string matched no bucket`);
  }

  const noOps = rows.filter((r) => r.arm === "A" && r.ok && (r.armInfo.noOpSelfReported || r.armInfo.noOpByToolUse || r.armInfo.brainNeverCalled));
  const contaminated = rows.filter((r) => r.arm === "B" && r.ok && r.armInfo.contaminated);

  return { byArm, perQuestion, wins, noOpRuns: noOps.length, contaminatedArmBRuns: contaminated.length, contaminationDetail: contaminated.map((r) => ({ id: r.id, rep: r.rep, calls: r.armInfo.contaminatingCalls })) };
}

function renderMarkdown(out) {
  const s = out.summary, L = [];
  const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);
  const usd = (x) => (x == null ? "n/a" : `$${x.toFixed(4)}`);

  L.push(`# Retrieval gauntlet: ${out.meta.comparison}`);
  L.push("");
  L.push(`${out.meta.date} · model \`${out.meta.resolvedModel || out.meta.model}\` · ${out.meta.repeats} repeats · ${out.meta.questionsRun} of ${out.meta.questionsTotal} questions · questions sha256 \`${out.meta.questionsSha256.slice(0, 16)}\` · index \`${out.meta.indexFingerprint}\``);
  L.push("");
  L.push("## Headline");
  L.push("");
  L.push("| | ARM A, brain | ARM B, his own repo map |");
  L.push("|---|---|---|");
  L.push(`| **Correct, and the brain produced it** | **${s.byArm.A.correctViaBrain}/${s.byArm.A.runs}** | ${s.byArm.B.correct}/${s.byArm.B.runs} |`);
  L.push(`| Correct by any means (A includes fallbacks to reading files) | ${s.byArm.A.correct}/${s.byArm.A.runs} (${pct(s.byArm.A.correctRate)}) | ${s.byArm.B.correct}/${s.byArm.B.runs} (${pct(s.byArm.B.correctRate)}) |`);
  L.push(`| Median cost per question | ${usd(s.byArm.A.costUsd?.median)} | ${usd(s.byArm.B.costUsd?.median)} |`);
  L.push(`| Cost spread (min / p25 / p75 / max) | ${[s.byArm.A.costUsd?.min, s.byArm.A.costUsd?.p25, s.byArm.A.costUsd?.p75, s.byArm.A.costUsd?.max].map(usd).join(" / ")} | ${[s.byArm.B.costUsd?.min, s.byArm.B.costUsd?.p25, s.byArm.B.costUsd?.p75, s.byArm.B.costUsd?.max].map(usd).join(" / ")} |`);
  L.push(`| Median wall clock | ${s.byArm.A.wallSec?.median ?? "n/a"}s | ${s.byArm.B.wallSec?.median ?? "n/a"}s |`);
  L.push(`| Cited the gold file | ${s.byArm.A.pathCited}/${s.byArm.A.runs} | ${s.byArm.B.pathCited}/${s.byArm.B.runs} |`);
  L.push("");
  L.push(`**Per-question wins** (majority of repeats): ARM A ${s.wins.A}, ARM B ${s.wins.B}, both ${s.wins.both}, neither ${s.wins.neither}, plus ${s.wins.AnoOp} that ARM A got right only after the index failed it, which is not a brain win.`);
  L.push("");
  L.push(`**Brain no-ops:** ${s.noOpRuns} of ${s.byArm.A.runs} ARM A runs either never called the brain, called it and then read files anyway, or said in their own words that the bundle did not have the answer.`);
  L.push("");
  if (s.contaminatedArmBRuns) L.push(`**Contamination:** ${s.contaminatedArmBRuns} ARM B runs touched brain tooling and are flagged in results.json. They are still counted; they are not hidden.`);
  else L.push(`**Contamination:** no ARM B run touched brain tooling.`);
  L.push("");
  L.push("## Secondary: tokens");
  L.push("");
  L.push("Priced differently from each other, so they sit below the dollars rather than above them.");
  L.push("");
  L.push("| Tokens, summed over all runs | ARM A | ARM B |");
  L.push("|---|---|---|");
  for (const [k, lbl] of [["input", "input"], ["output", "output"], ["cacheCreation", "cache write"], ["cacheRead", "cache read"], ["all", "all four"]]) {
    L.push(`| ${lbl} | ${s.byArm.A.tokensSummed[k].toLocaleString("en-US")} | ${s.byArm.B.tokensSummed[k].toLocaleString("en-US")} |`);
  }
  L.push(`| median per run | ${s.byArm.A.tokensPerRun?.median?.toLocaleString("en-US") ?? "n/a"} | ${s.byArm.B.tokensPerRun?.median?.toLocaleString("en-US") ?? "n/a"} |`);
  L.push("");
  L.push("## Per question");
  L.push("");
  L.push("| id | kind | in index | A correct | B correct | A cost | B cost | winner |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const p of s.perQuestion) {
    if (!p.aRuns && !p.bRuns) continue;
    L.push(`| ${p.id} | ${p.kind} | ${p.indexedInBrain ? "yes" : "no"} | ${p.aCorrect}/${p.aRuns} | ${p.bCorrect}/${p.bRuns} | ${usd(p.aMedianCost)} | ${usd(p.bMedianCost)} | ${p.winner} |`);
  }
  L.push("");
  L.push("## Checks that ran before any spawn");
  L.push("");
  L.push(`- accepted answer strings found inside their own question: **${out.checks.leaks.length}**`);
  L.push(`- generic non-answers or echoed questions that passed a rubric: **${out.checks.genericPasses.length}** of ${out.checks.genericProbeCount * out.meta.questionsTotal} graded`);
  L.push(`- gold answers that fail their own rubric: **${out.checks.goldFails.length}**`);
  L.push(`- repo map given to both arms: \`${REPO_MAP_SOURCE}\` with the section \`${out.meta.repoMap.removedHeading}\` removed (${out.meta.repoMap.removedChars} characters)`);
  L.push("");
  return L.join("\n");
}

// ------------------------------------------------------------------------ main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawQuestions = readFileSync(QUESTIONS_FILE);
  const spec = JSON.parse(rawQuestions.toString("utf8"));
  const questionsSha256 = sha256(rawQuestions);

  if (args.rescore) {
    const prev = JSON.parse(readFileSync(resolve(args.rescore), "utf8"));
    if (prev.meta.questionsSha256 !== questionsSha256) {
      console.error("REFUSING to rescore: questions.json has changed since that run.");
      console.error(`  run   : ${prev.meta.questionsSha256}`);
      console.error(`  onDisk: ${questionsSha256}`);
      process.exit(2);
    }
    // Regrades and reclassifies saved transcripts. The rubric comes from the
    // same frozen questions.json, checked by hash above, and the no-op
    // classifier can only ever move a question out of the brain-win column.
    const byId = new Map(spec.questions.map((q) => [q.id, q]));
    for (const r of prev.rows) {
      if (!r.ok) continue;
      r.grade = gradeAnswer(r.answer, byId.get(r.id));
      r.armInfo = classifyRun(r.arm, r.answer, r.toolCalls);
    }
    prev.summary = summarise(prev.rows, spec, prev.meta?.repoMap?.sanitisedText || "");
    prev.meta.rescoredAt = new Date().toISOString();
    writeFileSync(resolve(args.rescore), JSON.stringify(prev, null, 2));
    writeFileSync(resolve(args.rescore).replace(/\.json$/, ".md"), renderMarkdown(prev));
    console.log("rescored in place, no model was called");
    return;
  }

  // ---- checks
  const checks = runChecks(spec);
  console.log(`questions.json sha256 ${questionsSha256}`);
  console.log(`leak check      : ${checks.leaks.length} accepted forms found inside their own question`);
  console.log(`generic check   : ${checks.genericPasses.length} generic or echoed non-answers passed a rubric`);
  console.log(`gold self-test  : ${checks.goldFails.length} gold answers fail their own rubric`);
  if (checks.leaks.length) console.log(JSON.stringify(checks.leaks, null, 2));
  if (checks.genericPasses.length) console.log(JSON.stringify(checks.genericPasses, null, 2));
  if (checks.goldFails.length) console.log(JSON.stringify(checks.goldFails, null, 2));
  if (checks.leaks.length || checks.genericPasses.length || checks.goldFails.length) {
    console.error("\nREFUSING to run. Fix the rubric, never the question.");
    process.exit(2);
  }

  // ---- arms
  const rawMap = readFileSync(REPO_MAP_SOURCE, "utf8");
  const map = sanitiseRepoMap(rawMap);
  const dirs = buildArmDirs(map.text);
  const indexFingerprint = existsSync(INDEX_TSV)
    ? readFileSync(INDEX_TSV, "utf8").slice(0, 200).split(/\r?\n/)[0]
    : "index.tsv missing";

  let picked = spec.questions.filter((q) => !q.excluded);
  if (args.ids) picked = picked.filter((q) => args.ids.some((id) => q.id === id || q.id.startsWith(id + "-") || q.id.startsWith(id)));
  if (!picked.length) throw new Error("no questions selected");

  console.log(`\nrepo map        : ${REPO_MAP_SOURCE}, '${map.removedHeading}' removed (${map.removed.length} chars)`);
  console.log(`arm A cwd       : ${dirs.A}  (CLAUDE.md + ask.py)`);
  console.log(`arm B cwd       : ${dirs.B}  (CLAUDE.md)`);
  console.log(`index           : ${indexFingerprint}`);
  console.log(`plan            : ${picked.length} questions x ${args.arms.join("+")} x ${args.repeats} repeats = ${picked.length * args.arms.length * args.repeats} spawns\n`);

  if (args.checkOnly) {
    console.log("--- ARM A prompt preview ---\n" + buildPrompt("A", picked[0].question));
    console.log("\n--- ARM B prompt preview ---\n" + buildPrompt("B", picked[0].question));
    console.log("\n--- removed from the repo map ---\n" + map.removed);
    return;
  }

  // ---- run
  const rows = [];
  let resolvedModel = null;
  for (let rep = 1; rep <= args.repeats; rep++) {
    for (const q of picked) {
      // Alternate which arm goes first. Whichever runs first pays the cache write for the
      // system prompt and tool definitions, which are byte-identical across arms; running
      // A first every time would hand B a free cache read on every question.
      const order = rep % 2 === 1 ? args.arms : [...args.arms].reverse();
      for (const arm of order) {
        process.stdout.write(`rep ${rep} ${q.id} arm ${arm} ... `);
        const res = await askArm(arm, dirs[arm], buildPrompt(arm, q.question), args.timeoutMs);
        resolvedModel = resolvedModel || res.resolvedModel;
        const grade = res.ok ? gradeAnswer(res.answer, q) : { correct: false, groups: [], citedPath: null, pathCited: false };
        const armInfo = classifyRun(arm, res.answer, res.toolCalls);
        rows.push({
          rep, id: q.id, arm, ok: res.ok, killed: res.killed, exitCode: res.exitCode, stderr: res.stderr,
          answer: res.answer, wallSec: res.wallSec, apiMs: res.apiMs, numTurns: res.numTurns, costUsd: res.costUsd,
          tokens: { input: res.tokens.input, output: res.tokens.output, cacheCreation: res.tokens.cacheCreation, cacheRead: res.tokens.cacheRead },
          toolCalls: res.toolCalls, grade, armInfo,
        });
        console.log(res.ok ? `${grade.correct ? "CORRECT" : "wrong  "}  $${(res.costUsd ?? 0).toFixed(4)}  ${res.wallSec}s` : `SPAWN FAILED (exit ${res.exitCode})`);
      }
    }
  }

  const out = {
    meta: {
      date: new Date().toISOString().slice(0, 10),
      ranAt: new Date().toISOString(),
      comparison: spec.comparison,
      model: "sonnet",
      resolvedModel,
      repeats: args.repeats,
      questionsRun: picked.length,
      questionsTotal: spec.questions.length,
      questionIds: picked.map((q) => q.id),
      questionsSha256,
      indexFingerprint,
      projectsRoot: PROJECTS_ROOT,
      armCwds: dirs,
      cliArgs: cliArgs(),
      repoMap: { source: REPO_MAP_SOURCE, removedHeading: map.removedHeading, removedChars: map.removed.length, removedText: map.removed, sanitisedText: map.text, note: map.note },
      howCorrectnessJudged: spec.grading.method,
      userLevelNote: "C:/Users/zeusa/.claude/CLAUDE.md loads in both arms and cannot be dropped without also dropping the working directory map. Both prompts neutralise it in identical words; every ARM B transcript is scanned for brain tooling and flagged.",
    },
    checks,
    rows,
  };
  out.summary = summarise(rows, spec, map.text);

  const jsonPath = join(HERE, `results-${args.label}.json`);
  const mdPath = join(HERE, `results-${args.label}.md`);
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  writeFileSync(mdPath, renderMarkdown(out));
  console.log(`\nwrote ${jsonPath}\nwrote ${mdPath}\n`);
  console.log(renderMarkdown(out));
}

main().catch((e) => { console.error(e); process.exit(1); });
