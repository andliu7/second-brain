// Project plans: one private file per project with its walkthrough (markdown) and its delivery pipeline
// (the same stage shape and nine statuses as the Board's Pipeline view, shared/pipeline.mjs). The Projects
// page shows them (src/ProjectPlan.tsx) and andliu.ai reads a summary of them (src/lib/project-plans.ts).
//
// The files are ~/.brain/project-plans/<key>.json, under the user profile and outside the repository on
// purpose: the repository is public and a plan is private. <key> is the project's folder under Projects/
// with / replaced by __ (grignard/grignard-app-source becomes grignard__grignard-app-source). An agent
// writes them; this file only reads them and changes single stages, and it keeps every field it does not
// know about, so a richer plan written later survives an edit made here.
//
// Routes, all local only (api.mjs answers a hosted request 404 before it gets here, after the same origin
// and Host check as every other route):
//   GET  /api/project-plans                          every plan's summary: name, updated, counts by status
//   GET  /api/project-plans/:key                     one plan, or { plan: null } when there is none yet
//   PUT  /api/project-plans/:key/stages/:id          change one stage { status?, detail?, progress?, output? }
//   POST /api/project-plans/:key/stages              add a stage { title, status?, detail? }
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS, STATUSES, isDone, stageProblem, withStatus } from '../shared/pipeline.mjs';

export const plansDir = () => path.join(os.homedir(), '.brain', 'project-plans');
// A key names a file, so it is letters, digits, dot, dash and underscore only, and never all dots: that
// keeps every key inside plansDir (no slash, no "..").
const KEY = /^(?!\.+$)[A-Za-z0-9._-]{1,200}$/;
const STAGE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_FILE = 2 * 1024 * 1024, MAX_BODY = 64 * 1024, MAX_PLANS = 500, MAX_DETAIL = 64 * 1024;
const PUT_KEYS = ['status', 'detail', 'progress', 'output'];

// One write at a time, so two quick saves from the page cannot lose each other.
let queue = Promise.resolve();
function locked(work) { const run = queue.then(work, work); queue = run.catch(() => {}); return run; }

class BadRequest extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new BadRequest(message, status); };
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
// JSON only, like the other writing routes: a cross-site form cannot send it without a preflight.
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('Use a JSON request.');
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let text = '', bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) fail('Request exceeds 64 KB.', 413); text += chunk.toString(); }
  return JSON.parse(text || '{}');
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, field, max, nonempty = false) => { if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) fail(`${field} must be ${nonempty ? 'a non-empty' : 'a'} string of at most ${max} characters.`); return value; };
const statusOf = stage => STATUSES.includes(stage.status) ? stage.status : 'pending';

// The file as written, untouched, or null when it is missing. A file that is too big or not a plan is an
// error rather than null, so a broken plan is reported instead of being overwritten by an edit.
async function readRaw(key) {
  const file = path.join(plansDir(), key + '.json');
  let stat; try { stat = await fs.stat(file); } catch { return null; }
  if (stat.size > MAX_FILE) fail(`${key}.json is larger than 2 MB.`, 422);
  let raw; try { raw = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail(`${key}.json is not valid JSON.`, 422); }
  if (!plain(raw) || !plain(raw.pipeline) || !Array.isArray(raw.pipeline.stages)) fail(`${key}.json has no pipeline.stages list.`, 422);
  return raw;
}
// Temp file and rename: a reader (the page, an agent) sees the old plan or the new one, never half of one.
async function writeRaw(key, raw) {
  const file = path.join(plansDir(), key + '.json'), temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(plansDir(), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(raw, null, 2));
  try { await fs.rename(temp, file); } catch (error) { await fs.rm(temp, { force: true }); throw error; }
}

// What the page and the chat read: the known fields, each with a safe default, so the UI needs no guards.
function view(raw, key) {
  const stages = raw.pipeline.stages.filter(stage => plain(stage) && typeof stage.id === 'string' && typeof stage.title === 'string').map(stage => ({ ...stage, status: statusOf(stage) }));
  return { key, name: typeof raw.name === 'string' && raw.name ? raw.name : key, updated: typeof raw.updated === 'string' ? raw.updated : '',
    walkthrough: typeof raw.walkthrough === 'string' ? raw.walkthrough : '',
    pipeline: { subtitle: typeof raw.pipeline.subtitle === 'string' ? raw.pipeline.subtitle : '', layout: raw.pipeline.layout === 'horizontal' ? 'horizontal' : 'vertical', stages } };
}
// The list row: counts by status, and the titles of the stages running and the one up next, which is
// what the chat summary needs, so it does not fetch every plan in full.
function summary(plan) {
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const stage of plan.pipeline.stages) counts[stage.status] += 1;
  const stages = plan.pipeline.stages;
  return { key: plan.key, name: plan.name, updated: plan.updated, total: stages.length, done: stages.filter(stage => isDone(stage.status)).length, counts,
    active: stages.filter(stage => stage.status === 'active').map(stage => stage.title),
    next: stages.find(stage => stage.status === 'queued' || stage.status === 'pending')?.title ?? '' };
}

async function listPlans() {
  let names; try { names = await fs.readdir(plansDir()); } catch { return []; }
  const keys = names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(key => KEY.test(key)).slice(0, MAX_PLANS);
  const plans = [];
  // A broken file is left out of the list rather than failing it; opening that project shows the reason.
  for (const key of keys) { try { const raw = await readRaw(key); if (raw) plans.push(summary(view(raw, key))); } catch { /* skipped */ } }
  return plans.sort((a, b) => a.name.localeCompare(b.name));
}

// One stage changed: the status through withStatus (shared/pipeline.mjs), so its clock fields and doneOn
// follow the same rules as the Board's pipelines. Empty text clears a field; progress null clears the bar.
function changeStage(stage, body, now) {
  if (!plain(body)) fail('Send a JSON object.');
  const keys = Object.keys(body);
  if (!keys.length) fail(`Send at least one of: ${PUT_KEYS.join(', ')}.`);
  const unknown = keys.find(key => !PUT_KEYS.includes(key)); if (unknown) fail(`Unknown field ${unknown}. Use: ${PUT_KEYS.join(', ')}.`);
  let next = { ...stage };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) fail(`status must be one of: ${STATUSES.join(', ')}.`);
    // withStatus reads `done` to tell a first finish from a repeat; plans store the status alone.
    next = withStatus({ ...next, done: isDone(statusOf(next)) }, body.status, now); delete next.done;
  }
  if (body.progress === null) delete next.progress; else if (body.progress !== undefined) next.progress = body.progress;
  if (body.detail !== undefined) text(body.detail, 'detail', MAX_DETAIL);
  if (body.output !== undefined) text(body.output, 'output', LIMITS.output);
  for (const key of ['detail', 'output']) if (body[key] !== undefined) { if (body[key]) next[key] = body[key]; else delete next[key]; }
  next.updatedAt = now.toISOString();
  const problem = stageProblem(next); if (problem) fail(`${problem.field} ${problem.reason}.`);
  return next;
}

export async function handleProjectPlans(route, req, res) {
  const parts = route.split('/').map(part => { try { return decodeURIComponent(part); } catch { return '\0'; } });
  const [, key, sub, stageId] = parts;
  try {
    if (key !== undefined && !KEY.test(key)) fail('That is not a project plan key.', 404);
    if (parts.length === 1) { if (req.method !== 'GET') fail('Use GET.', 405); return send(res, 200, { plans: await listPlans() }); }
    if (parts.length === 2) {
      if (req.method !== 'GET') fail('Use GET.', 405);
      const raw = await readRaw(key);
      return send(res, 200, { plan: raw ? view(raw, key) : null });
    }
    if (sub !== 'stages' || parts.length > 4) fail('API route not found.', 404);
    if (parts.length === 4 && !STAGE_ID.test(stageId)) fail('That is not a stage id.', 404);
    if (parts.length === 3 && req.method !== 'POST') fail('Use POST to add a stage.', 405);
    if (parts.length === 4 && req.method !== 'PUT') fail('Use PUT to change a stage.', 405);
    const body = await readBody(req);
    const result = await locked(async () => {
      const raw = await readRaw(key), now = new Date();
      if (!raw) fail('No plan for that project yet.', 404);
      const stages = raw.pipeline.stages;
      let stage;
      if (parts.length === 3) {
        if (!plain(body)) fail('Send a JSON object.');
        const unknown = Object.keys(body).find(field => !['title', 'status', 'detail'].includes(field)); if (unknown) fail(`Unknown field ${unknown}. Use: title, status, detail.`);
        const title = text(typeof body.title === 'string' ? body.title.trim() : body.title, 'title', LIMITS.title, true);
        if (body.status !== undefined && !STATUSES.includes(body.status)) fail(`status must be one of: ${STATUSES.join(', ')}.`);
        if (body.detail !== undefined) text(body.detail, 'detail', MAX_DETAIL);
        if (stages.length >= LIMITS.stages) fail(`A pipeline holds at most ${LIMITS.stages} stages.`);
        stage = withStatus({ id: randomUUID(), title, done: false, ...(body.detail ? { detail: body.detail } : {}) }, body.status ?? 'pending', now); delete stage.done;
        stages.push(stage);
      } else {
        const index = stages.findIndex(item => plain(item) && item.id === stageId);
        if (index < 0) fail('No stage with that id in this plan.', 404);
        stage = changeStage(stages[index], body, now);
        stages[index] = stage;
      }
      raw.updated = now.toISOString();
      await writeRaw(key, raw);
      return { status: parts.length === 3 ? 201 : 200, value: { plan: view(raw, key), stage } };
    });
    return send(res, result.status, result.value);
  } catch (error) {
    if (error instanceof BadRequest) return send(res, error.status, { error: error.message });
    if (error instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON request.' });
    return send(res, 500, { error: String(error?.message || 'The project plan could not be read or written.') });
  }
}
