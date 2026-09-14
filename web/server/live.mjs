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
    return { name: skill.name, slug: skill.slug, description: skill.desc, skill: docs['SKILL.md'], readme: docs['README.md'] ?? null, files: skill.files, task: task ? task.id : null };
  });
}

export async function listProjects() {
  const { repos, courses, blueberry, routines } = await homeData([]);
  return { repos, courses, blueberry, routines };
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
