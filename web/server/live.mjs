// Live reads of this computer: installed skills, projects, and the second brain.
//
// Nothing here parses git or skill folders itself. OS/build_home.py already gathers all
// of that for HOME.html, so its --json mode is the one source, and second-brain/q.py
// --json answers searches. Both run fresh on every request, so the site never shows a
// copy that has gone stale.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './library.mjs';
import { TASKS } from './runner.mjs';

const buildHome = path.join(projectRoot, 'OS', 'build_home.py');
const brainDir = path.join(projectRoot, 'second-brain');

// An argument list and no shell, so a search query can never be read as a command.
function python(args) {
  const options = { timeout: 60_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } };
  return new Promise(resolve => execFile('python', args, options, (error, stdout, stderr) => resolve({ exit: error ? error.code : 0, stdout, stderr })));
}

async function homeData(args) {
  const { exit, stdout, stderr } = await python([buildHome, '--json', ...args]);
  if (exit !== 0) throw new Error('build_home.py failed: ' + (stderr.trim() || 'exit ' + exit));
  return JSON.parse(stdout);
}

export async function listSkills() {
  // --no-git: skills need none of the git state, and git is the slow part.
  const { skills } = await homeData(['--no-git']);
  return skills.map(skill => {
    const docs = Object.fromEntries(skill.docs);
    // task is the runner.mjs task id when the site can run this skill, otherwise null.
    const task = TASKS.find(item => item.skill === skill.slug);
    // path is the folder under ~/.claude/skills, which for a synced plugin skill is
    // synced/<bucket>/<slug> rather than the slug alone; source says which of the two it is.
    return { name: skill.name, slug: skill.slug, description: skill.desc, skill: docs['SKILL.md'], readme: docs['README.md'] ?? null, files: skill.files, path: skill.path, source: skill.source, task: task ? task.id : null };
  });
}

export async function listProjects() {
  const { repos, courses, blueberry, routines } = await homeData([]);
  // rootPath is the Projects folder on this computer, so a project page can give its full path.
  return { repos, courses, blueberry, routines, rootPath: path.dirname(projectRoot) };
}

export async function searchBrain(query) {
  if (!query.trim()) throw new Error('Type something to search for.');
  if (!fs.existsSync(path.join(brainDir, 'index.tsv'))) return { status: 'not_installed', message: 'The second brain has no index yet. Run python install.py in second-brain/second-brain, in PowerShell.' };
  // "--" ends the options, so a query that starts with a dash is still a query.
  const { exit, stdout, stderr } = await python([path.join(brainDir, 'q.py'), '--json', '--', query]);
  try { return JSON.parse(stdout); } catch { /* q.py prints plain text when it refuses to answer. */ }
  // Exit 1 is "the brain does not have this", exit 2 is "no keywords left": both are answers, not failures.
  if (exit === 1 || exit === 2) return { status: 'no_match', question: query, message: (stdout || stderr).trim() };
  throw new Error((stderr || stdout).trim() || 'q.py failed with exit ' + exit);
}

// Settings' Brain section: how old the index is and what the last benchmarks measured. Aggregate numbers only,
// copied field by field, so nothing else in those files (question text, file paths) reaches the page.
// Files changed since the reindex are not counted: that means walking every root, which takes minutes, and
// the date is what tells him to run idx.py. q.py itself calls an index stale after 7 days.
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
async function readJson(file) { try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return null; } }
export async function brainSummary(dir = brainDir) {
  // idx.py appends "[YYYY-MM-DD HH:MM:SS] reindex | ..." to log.md after each full run; q.py reads the same line.
  let lastFullReindex = null;
  try {
    const lines = (await fs.promises.readFile(path.join(dir, 'log.md'), 'utf8')).split(/\r?\n/).filter(line => line.includes('] reindex |'));
    const stamp = lines.at(-1)?.split('[')[1]?.split(']')[0];
    if (stamp && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)) lastFullReindex = stamp;
  } catch { /* no log yet: no reindex on record */ }
  const speed = await readJson(path.join(dir, 'bench', 'results-speed-summary.json'));
  const arm = value => value && { hitAt1: num(value.hit_at_1), hitAt5: num(value.hit_at_5), n: num(value.n), medianTokens: num(value.median_tokens_to_read), medianMs: num(value.median_ms) };
  const history = await readJson(path.join(dir, 'bench', 'results-history-summary.json'));
  // The studies do not share one shape (simulated sessions count tokens, real runs count billed tokens per run),
  // so each arm keeps whichever of the two it has.
  const studies = Array.isArray(history?.studies) ? history.studies.slice(0, 10).map(study => ({
    study: String(study.study ?? ''), kind: String(study.kind ?? ''),
    arms: Object.entries(study.arms ?? {}).slice(0, 8).map(([name, a]) => ({ name, correct: num(a.correct ?? a.correct_headline), n: num(a.n ?? a.runs), tokens: num(a.tokens ?? a.tokens_median_per_run) })),
  })) : [];
  return {
    index: { lastFullReindex, command: 'python idx.py' },
    speed: speed?.arms ? { built: String(speed.built ?? ''), questions: num(speed.questions), brain: arm(speed.arms.BRAIN), grep: arm(speed.arms.GREP) } : null,
    studies,
  };
}
