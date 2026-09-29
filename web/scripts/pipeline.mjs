#!/usr/bin/env node
// Claude Code's handle on the app's project pipelines. It talks to the running app's server (npm run dev)
// at 127.0.0.1 on PORT (default 5175: on this machine the dashboard holds 5174, so Second Brain runs on 5175), which keeps the mirror in
// ~/.brain/pipelines.json (server/pipelines.mjs); the app pulls changes from there every few seconds while
// a Pipeline view is open. Only projects with Pipeline view switched on in the app are listed.
//
//   node scripts/pipeline.mjs list [--json]
//   node scripts/pipeline.mjs show <project> [--json]
//   node scripts/pipeline.mjs set <project> <stage> [--status active] [--progress 40|none] [--error text] [--warning text] [--output text]
//   node scripts/pipeline.mjs log <project> <stage> "text"
//   node scripts/pipeline.mjs add <project> "Stage name" [--status queued]
//
// <project> is the card id or its title (any unique part, case ignored). <stage> is the stage id, its
// number in `show`, or its title (any unique part). Everything the server refuses comes back as its reason.
import { pathToFileURL } from 'node:url';

const STATUSES = ['pending', 'queued', 'active', 'paused', 'completed', 'warning', 'failed', 'skipped', 'cancelled'];
const USAGE = `Usage:
  node scripts/pipeline.mjs list [--json]
  node scripts/pipeline.mjs show <project> [--json]
  node scripts/pipeline.mjs set <project> <stage> [--status ${STATUSES.join('|')}] [--progress 0-100|none] [--error text] [--warning text] [--output text]
  node scripts/pipeline.mjs log <project> <stage> "text"
  node scripts/pipeline.mjs add <project> "Stage name" [--status queued]`;

class UsageError extends Error {}

// Split argv into positional words and --flags (each flag takes the next word as its value, except --json and --help).
export function parse(argv) {
  const words = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' || arg === '--help') flags[arg.slice(2)] = true;
    else if (arg.startsWith('--')) { const key = arg.slice(2); if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value.`); flags[key] = argv[++i]; }
    else words.push(arg);
  }
  return { command: words[0], words: words.slice(1), flags };
}

// The PATCH body `set` sends, checked here first so a typo is caught before the request.
export function setBody(flags) {
  const body = {}, allowed = ['status', 'progress', 'error', 'warning', 'output', 'json'];
  const unknown = Object.keys(flags).find(key => !allowed.includes(key)); if (unknown) throw new UsageError(`Unknown option --${unknown}.`);
  if (flags.status !== undefined) { if (!STATUSES.includes(flags.status)) throw new UsageError(`--status must be one of: ${STATUSES.join(', ')}.`); body.status = flags.status; }
  if (flags.progress !== undefined) {
    if (flags.progress === 'none') body.progress = null;
    else { const value = Number(flags.progress); if (flags.progress.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) throw new UsageError('--progress must be a number from 0 to 100, or none.'); body.progress = value; }
  }
  for (const key of ['error', 'warning', 'output']) if (flags[key] !== undefined) body[key] = flags[key];
  if (!Object.keys(body).length) throw new UsageError('set needs at least one of --status, --progress, --error, --warning, --output.');
  return body;
}

// Pick one item by id, by number (stages), exactly by title, or by a unique part of the title.
function pick(items, query, what, number = false) {
  const q = String(query).toLowerCase();
  const byId = items.find(item => (item.cardId ?? item.id) === query); if (byId) return byId;
  if (number && /^\d+$/.test(query) && items[Number(query) - 1]) return items[Number(query) - 1];
  const exact = items.filter(item => item.title.toLowerCase() === q); if (exact.length === 1) return exact[0];
  const some = items.filter(item => item.title.toLowerCase().includes(q));
  if (some.length === 1) return some[0];
  throw new Error(some.length ? `"${query}" matches more than one ${what}: ${some.map(item => item.title).join(', ')}.` : `No ${what} matches "${query}".`);
}

const statusOf = stage => STATUSES.includes(stage.status) && ['completed', 'warning', 'skipped'].includes(stage.status) === Boolean(stage.done) ? stage.status : stage.done ? 'completed' : 'pending';
function describe(pipeline) {
  const lines = [`${pipeline.title}${pipeline.subtitle ? ` - ${pipeline.subtitle}` : ''}  (${pipeline.cardId})`, `${pipeline.done ?? 0} of ${pipeline.stages.length} stages done`];
  pipeline.stages.forEach((stage, index) => {
    const status = statusOf(stage);
    const extra = [typeof stage.progress === 'number' && (status === 'active' || status === 'paused') ? `${stage.progress}%` : '', stage.attempt > 1 ? `attempt ${stage.attempt}` : '', stage.error ? `error: ${stage.error.split('\n')[0]}` : '', stage.warning ? `warning: ${stage.warning.split('\n')[0]}` : ''].filter(Boolean).join(', ');
    lines.push(`  ${String(index + 1).padStart(2)}. [${status}] ${stage.title}${extra ? `  (${extra})` : ''}  id=${stage.id}`);
  });
  return lines.join('\n');
}

export async function main(argv, { fetch = globalThis.fetch, port = process.env.PORT || 5175, out = text => process.stdout.write(text + '\n'), err = text => process.stderr.write(text + '\n') } = {}) {
  const base = `http://127.0.0.1:${port}/api/pipelines`;
  async function request(method, path = '', body) {
    let res;
    try { res = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new Error(`The app is not running on 127.0.0.1:${port}. Start it with npm run dev in second-brain/web (or set PORT).`); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
    return data;
  }
  const project = async query => pick((await request('GET')).pipelines, query, 'project');
  try {
    const { command, words, flags } = parse(argv);
    if (command === undefined || command === 'help' || flags.help) { out(USAGE); return 0; }
    const need = (count, shape) => { if (words.length !== count) throw new UsageError(`${command} takes ${shape}.`); };
    if (command === 'list') {
      need(0, 'no arguments');
      const { pipelines } = await request('GET');
      if (flags.json) out(JSON.stringify(pipelines, null, 2));
      else out(pipelines.length ? pipelines.map(p => `${p.title}  ${p.done} of ${p.stages.length} stages  (${p.cardId})`).join('\n') : 'No pipelines. Switch on Pipeline view for a project in the app (Board or Projects) with the app running.');
      return 0;
    }
    if (command === 'show') {
      need(1, '<project>');
      const found = await project(words[0]);
      out(flags.json ? JSON.stringify(found, null, 2) : describe(found));
      return 0;
    }
    if (command === 'set' || command === 'log') {
      need(command === 'set' ? 2 : 3, command === 'set' ? '<project> <stage> and options' : '<project> <stage> "text"');
      const body = command === 'set' ? setBody(flags) : { log: words[2] };
      const found = await project(words[0]), stage = pick(found.stages, words[1], 'stage', true);
      const reply = await request('PATCH', `/${encodeURIComponent(found.cardId)}/stages/${encodeURIComponent(stage.id)}`, body);
      out(`${reply.stage.title}: ${statusOf(reply.stage)}${typeof reply.stage.progress === 'number' ? `, ${reply.stage.progress}%` : ''}${command === 'log' ? `, ${reply.stage.logs.length} log lines` : ''}`);
      return 0;
    }
    if (command === 'add') {
      need(2, '<project> "Stage name"');
      if (flags.status !== undefined && !STATUSES.includes(flags.status)) throw new UsageError(`--status must be one of: ${STATUSES.join(', ')}.`);
      const found = await project(words[0]);
      const reply = await request('POST', `/${encodeURIComponent(found.cardId)}/stages`, { title: words[1], ...(flags.status ? { status: flags.status } : {}) });
      out(`Added "${reply.stage.title}" to ${found.title} as stage ${reply.pipeline.stages.length} (id=${reply.stage.id}).`);
      return 0;
    }
    throw new UsageError(`Unknown command ${command}.`);
  } catch (error) {
    err(error instanceof UsageError ? `${error.message}\n${USAGE}` : error.message);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));
