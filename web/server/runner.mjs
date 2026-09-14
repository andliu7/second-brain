// Runs a fixed list of maintenance skills through `claude -p`, on this computer only.
//
// The browser sends a task id, never a command: every command line is built here from
// TASKS. That list is deliberately short and holds only skills that need no input,
// because a headless run has nobody to answer a question or approve a change.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectRoot } from './library.mjs';

const skillsRoot = path.resolve(process.env.CLAUDE_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills'));
// Runs start in Downloads/Projects, the parent of this repo, so Projects/CLAUDE.md loads.
const workingDirectory = path.resolve(projectRoot, '..');
const OUTPUT_LIMIT = 200_000;

export const TASKS = [
  {
    id: 'clean-up',
    label: 'Clean up',
    skill: 'clean-up',
    prompt: '/clean-up',
    model: 'fable',
    effort: 'xhigh',
    blurb: 'Kills stray headless browsers and drivers, frees temp, reports disk.',
  },
  {
    id: 'doctor-plus',
    label: 'Doctor plus',
    skill: 'doctor-plus',
    prompt: '/doctor-plus. This is a headless run with nobody to approve fixes: print the findings table and change nothing.',
    model: 'claude-opus-5',
    effort: null,
    blurb: 'Claude Code health check plus a context audit. Reports only, changes nothing.',
  },
];

// id -> { status: 'running' | 'done' | 'failed', started, finished, exit, output }
const runs = new Map();

export function missingSkill(task) {
  return fs.existsSync(path.join(skillsRoot, task.skill, 'SKILL.md')) ? null : '/' + task.skill;
}

export function buildCommand(task) {
  // A string, not an argument list: on Windows `claude` is a .cmd shim that only a
  // shell can start, and a shell needs the prompt quoted. Prompts here never contain
  // a double quote, which is what keeps this quoting safe.
  const parts = ['claude', '-p', `"${task.prompt}"`];
  if (task.model) parts.push('--model', task.model);
  if (task.effort) parts.push('--effort', task.effort);
  parts.push('--permission-mode', 'bypassPermissions');
  return parts.join(' ');
}

export function listTasks() {
  return TASKS.map(task => ({
    id: task.id,
    label: task.label,
    blurb: task.blurb,
    command: buildCommand(task),
    missing: missingSkill(task),
    run: runs.get(task.id) || null,
  }));
}

export function startRun(id) {
  const task = TASKS.find(item => item.id === id);
  if (!task) throw new Error('Unknown task.');
  const missing = missingSkill(task);
  if (missing) throw new Error(`${missing} is not installed on this computer.`);
  if (runs.get(id)?.status === 'running') throw new Error('Already running.');

  const run = { status: 'running', started: new Date().toISOString(), finished: null, exit: null, output: '' };
  runs.set(id, run);
  const append = chunk => { run.output = (run.output + chunk.toString()).slice(-OUTPUT_LIMIT); };
  const child = spawn(buildCommand(task), { cwd: workingDirectory, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const finish = (exit, note = '') => {
    if (run.finished) return;
    if (note) append(note);
    run.exit = exit;
    run.status = exit === 0 ? 'done' : 'failed';
    run.finished = new Date().toISOString();
  };
  child.on('error', error => finish(-1, `\nCould not start claude: ${error.message}\n`));
  child.on('close', code => finish(code ?? -1));
  return run;
}
