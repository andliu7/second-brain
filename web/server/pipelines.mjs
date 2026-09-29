// The pipeline mirror: the channel between the app's project pipelines and Claude Code. The workspace lives
// in the browser's IndexedDB, which no CLI can read, so the app pushes each project that has its Pipeline
// view on to this file and pulls back what changed (src/lib/pipeline-sync.ts). Claude Code reads and
// writes the same file through these routes, by way of scripts/pipeline.mjs.
//
// The file is ~/.brain/pipelines.json, under the user profile and outside the repository on purpose: the
// repository is public, and a pipeline holds project names, notes and logs. It is a mirror, not the record:
// if it is deleted or unreadable it starts empty and the app fills it again on its next push.
//
// Routes, all local only (api.mjs sends a hosted request a 404 before it gets here, after the same origin
// and Host check as every other route):
//   GET    /api/pipelines                                every mirrored pipeline, and the server's clock
//   GET    /api/pipelines/:cardId                        one pipeline
//   PUT    /api/pipelines/:cardId                        the app's push: merged stage by stage (shared/pipeline.mjs)
//   DELETE /api/pipelines/:cardId                        the app turned the view off
//   POST   /api/pipelines/:cardId/stages                 add a stage { title, status? }
//   PATCH  /api/pipelines/:cardId/stages/:stageId        { status?, progress?, log?, error?, warning?, output? }
// Every write stamps updatedAt from one clock that never repeats a value, and every reply carries `now`
// from the same clock, so "changed after I last looked" is a strict comparison with no ties.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LAYOUTS, LIMITS, STATUSES, appendLogs, isDone, mergeStages, stageProblem, withStatus } from '../shared/pipeline.mjs';

export const pipelinesFile = () => path.join(os.homedir(), '.brain', 'pipelines.json');
const MAX_PIPELINES = 500;
const MAX_BODY = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_KEYS = ['id', 'title', 'done', 'detail', 'doneOn', 'status', 'progress', 'startedAt', 'endedAt', 'updatedAt', 'attempt', 'error', 'warning', 'logs', 'output', 'skippable'];
const PATCH_KEYS = ['status', 'progress', 'log', 'error', 'warning', 'output'];

let last = 0;
function clock() { let time = Date.now(); if (time <= last) time = last + 1; last = time; return new Date(time); }
// One request at a time touches the file, so two quick PATCHes from an agent cannot lose each other.
let queue = Promise.resolve();
function locked(work) { const run = queue.then(work, work); queue = run.catch(() => {}); return run; }

async function load() {
  try {
    const data = JSON.parse(await fs.readFile(pipelinesFile(), 'utf8'));
    if (data && typeof data.pipelines === 'object' && data.pipelines !== null && !Array.isArray(data.pipelines)) return data;
  } catch { /* missing or unreadable: the mirror starts empty and the app refills it */ }
  return { version: 1, pipelines: {} };
}
async function save(data) {
  const file = pipelinesFile(), temp = file + '.' + process.pid + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, file);
}

class BadRequest extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new BadRequest(message, status); };
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
// JSON only: a cross-site form cannot send it without a preflight, which is part of why these routes can write.
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('Use a JSON request.');
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let text = '', bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) fail('Request exceeds 2 MB.', 413); text += chunk.toString(); }
  return JSON.parse(text || '{}');
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, field, max, nonempty = false) => { if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) fail(`${field} must be ${nonempty ? 'a non-empty' : 'a'} string of at most ${max} characters.`); return value; };

// A stage as the app sends it: the known fields only, each within the bounds the workspace validator uses.
function cleanStage(value, where) {
  if (!plain(value)) fail(`${where} must be an object.`);
  if (typeof value.id !== 'string' || !ID.test(value.id)) fail(`${where}.id must be letters, digits, - or _.`);
  text(value.title, `${where}.title`, LIMITS.title, true);
  if (typeof value.done !== 'boolean') fail(`${where}.done must be a boolean.`);
  if (value.detail !== undefined) text(value.detail, `${where}.detail`, 1024 * 1024);
  if (value.doneOn !== undefined && !(typeof value.doneOn === 'string' && DAY.test(value.doneOn))) fail(`${where}.doneOn must be YYYY-MM-DD.`);
  const problem = stageProblem(value); if (problem) fail(`${where}.${problem.field} ${problem.reason}.`);
  return Object.fromEntries(STAGE_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

// The changes an agent may make to one stage. Empty text clears a field; progress null clears the bar.
function applyPatch(stage, body, now) {
  if (!plain(body)) fail('Send a JSON object.');
  const keys = Object.keys(body);
  if (!keys.length) fail(`Send at least one of: ${PATCH_KEYS.join(', ')}.`);
  const unknown = keys.find(key => !PATCH_KEYS.includes(key)); if (unknown) fail(`Unknown field ${unknown}. Use: ${PATCH_KEYS.join(', ')}.`);
  let next = { ...stage };
  if (body.status !== undefined) { if (!STATUSES.includes(body.status)) fail(`status must be one of: ${STATUSES.join(', ')}.`); next = withStatus(next, body.status, now); }
  if (body.progress !== undefined) {
    if (body.progress === null) delete next.progress;
    else if (typeof body.progress !== 'number' || !Number.isFinite(body.progress) || body.progress < 0 || body.progress > 100) fail('progress must be a number from 0 to 100, or null to clear it.');
    else next.progress = body.progress;
  }
  for (const [key, max] of [['error', LIMITS.text], ['warning', LIMITS.text], ['output', LIMITS.output]]) {
    if (body[key] === undefined) continue;
    text(body[key], key, max);
    if (body[key]) next[key] = body[key]; else delete next[key];
  }
  if (body.log !== undefined) {
    const lines = Array.isArray(body.log) ? body.log : [body.log];
    if (!lines.length || lines.length > LIMITS.logLines) fail(`log must be a line or up to ${LIMITS.logLines} lines.`);
    lines.forEach(line => text(line, 'log', LIMITS.logLine));
    next = appendLogs(next, lines, now);
  }
  next.updatedAt = now.toISOString();
  return next;
}

const summary = pipeline => ({ ...pipeline, done: pipeline.stages.filter(stage => isDone(stage.status ?? (stage.done ? 'completed' : 'pending'))).length });

export async function handlePipelines(route, req, res) {
  const parts = route.split('/').map(part => { try { return decodeURIComponent(part); } catch { return '\0'; } });
  const [, cardId, sub, stageId] = parts;
  try {
    if (cardId !== undefined && !ID.test(cardId)) fail('That is not a pipeline id.', 404);
    if (stageId !== undefined && !ID.test(stageId)) fail('That is not a stage id.', 404);
    if (parts.length === 1) {
      if (req.method !== 'GET') fail('Use GET.', 405);
      return send(res, 200, await locked(async () => { const now = clock(), data = await load(); return { pipelines: Object.values(data.pipelines).map(summary).sort((a, b) => a.title.localeCompare(b.title)), now: now.toISOString() }; }));
    }
    if (parts.length === 2) {
      const body = ['PUT'].includes(req.method) ? await readBody(req) : undefined;
      const result = await locked(async () => {
        const now = clock(), data = await load(), found = data.pipelines[cardId];
        if (req.method === 'GET') return found ? { status: 200, value: { pipeline: summary(found), now: now.toISOString() } } : { status: 404, value: { error: 'No pipeline with that id. Turn on Pipeline view for the project in the app.', now: now.toISOString() } };
        if (req.method === 'DELETE') { if (found) { delete data.pipelines[cardId]; await save(data); } return { status: 200, value: { ok: true, now: now.toISOString() } }; }
        if (req.method !== 'PUT') fail('Use GET, PUT or DELETE.', 405);
        if (!plain(body)) fail('Send a JSON object.');
        const title = text(body.title, 'title', 1024, true);
        if (!LAYOUTS.includes(body.layout)) fail(`layout must be one of: ${LAYOUTS.join(', ')}.`);
        if (body.subtitle !== undefined && body.subtitle !== null) text(body.subtitle, 'subtitle', LIMITS.subtitle);
        if (body.seen !== undefined && typeof body.seen !== 'string') fail('seen must be a timestamp string.');
        if (!Array.isArray(body.stages) || body.stages.length > LIMITS.stages) fail(`stages must be a list of at most ${LIMITS.stages}.`);
        const stages = body.stages.map((stage, index) => cleanStage(stage, `stages[${index}]`));
        if (new Set(stages.map(stage => stage.id)).size !== stages.length) fail('stages must not repeat an id.');
        if (!found && Object.keys(data.pipelines).length >= MAX_PIPELINES) fail(`The mirror holds at most ${MAX_PIPELINES} pipelines.`);
        const pipeline = { cardId, title, ...(body.subtitle ? { subtitle: body.subtitle } : {}), layout: body.layout, stages: mergeStages(stages, found?.stages ?? [], body.seen || ''), updatedAt: now.toISOString() };
        data.pipelines[cardId] = pipeline; await save(data);
        return { status: 200, value: { pipeline: summary(pipeline), now: clock().toISOString() } };
      });
      return send(res, result.status, result.value);
    }
    if (sub !== 'stages' || parts.length > 4) fail('API route not found.', 404);
    if (parts.length === 3 && req.method !== 'POST') fail('Use POST to add a stage.', 405);
    if (parts.length === 4 && req.method !== 'PATCH') fail('Use PATCH to change a stage.', 405);
    const body = await readBody(req);
    const result = await locked(async () => {
      const now = clock(), data = await load(), pipeline = data.pipelines[cardId];
      if (!pipeline) fail('No pipeline with that id. Turn on Pipeline view for the project in the app.', 404);
      let stage;
      if (parts.length === 3) {
        if (!plain(body)) fail('Send a JSON object.');
        const unknown = Object.keys(body).find(key => key !== 'title' && key !== 'status'); if (unknown) fail(`Unknown field ${unknown}. Use: title, status.`);
        const title = text(typeof body.title === 'string' ? body.title.trim() : body.title, 'title', LIMITS.title, true);
        if (pipeline.stages.length >= LIMITS.stages) fail(`A pipeline holds at most ${LIMITS.stages} stages.`);
        if (body.status !== undefined && !STATUSES.includes(body.status)) fail(`status must be one of: ${STATUSES.join(', ')}.`);
        stage = withStatus({ id: randomUUID(), title, done: false }, body.status ?? 'pending', now);
        pipeline.stages.push(stage);
      } else {
        const index = pipeline.stages.findIndex(item => item.id === stageId);
        if (index < 0) fail('No stage with that id in this pipeline.', 404);
        stage = applyPatch(pipeline.stages[index], body, now);
        pipeline.stages[index] = stage;
      }
      pipeline.updatedAt = now.toISOString();
      await save(data);
      return { status: parts.length === 3 ? 201 : 200, value: { pipeline: summary(pipeline), stage, now: clock().toISOString() } };
    });
    return send(res, result.status, result.value);
  } catch (error) {
    if (error instanceof BadRequest) return send(res, error.status, { error: error.message });
    if (error instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON request.' });
    return send(res, 500, { error: String(error?.message || 'The pipeline mirror could not be read or written.') });
  }
}
