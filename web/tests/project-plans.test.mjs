// Project plans on the server (server/project-plans.mjs), with HOME pointed at a temp folder so nothing
// lands in the real profile or the repository. The plans here are made-up fixtures: the real ones are
// private and live only in ~/.brain/project-plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
delete process.env.APP_ACCESS_TOKEN;
const { handleApi } = await import('../server/api.mjs');
const { plansDir } = await import('../server/project-plans.mjs');
const repo = fileURLToPath(new URL('../../', import.meta.url));

async function call(method, route, body, { host = '127.0.0.1:5174', headers = {}, local = true } = {}) {
  const req = { url: '/api/' + route, method, headers: { host, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body };
  const result = {};
  const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(String(value)); } };
  await handleApi(req, res, { local });
  return result;
}
const fixture = (key, name, stages) => ({ key, name, updated: '2026-09-01T10:00:00.000Z', walkthrough: `# ${name}\n\nA **made-up** project.`, extra: { kept: true },
  pipeline: { subtitle: 'Example', layout: 'vertical', stages } });
const file = key => path.join(plansDir(), key + '.json');
const write = plan => { fs.mkdirSync(plansDir(), { recursive: true }); fs.writeFileSync(file(plan.key), JSON.stringify(plan)); };
const read = key => JSON.parse(fs.readFileSync(file(key), 'utf8'));
function reset() {
  fs.rmSync(plansDir(), { recursive: true, force: true });
  write(fixture('example-app', 'Example app', [
    { id: 'scope', title: 'Scope', description: 'x', detail: 'What it is', status: 'completed', doneOn: '2026-09-01' },
    { id: 'build', title: 'Build', detail: 'Write it', status: 'active' },
    { id: 'ship', title: 'Ship', detail: 'Release it', status: 'pending' },
  ]));
  write(fixture('school__demo-course', 'Demo course', [{ id: 'a', title: 'Read', status: 'queued' }]));
}

test('the plans live under the user profile, never in the repository', () => {
  assert.equal(plansDir(), path.join(home, '.brain', 'project-plans'));
  assert.ok(!path.resolve(plansDir()).startsWith(path.resolve(repo)));
});

test('project plans are local only and keep the origin and Host checks', async () => {
  reset();
  process.env.APP_ACCESS_TOKEN = 'hosted-token';
  try { assert.equal((await call('GET', 'project-plans', undefined, { local: false, headers: { authorization: 'Bearer hosted-token' } })).status, 404); }
  finally { delete process.env.APP_ACCESS_TOKEN; }
  assert.equal((await call('GET', 'project-plans', undefined, { host: 'evil.example' })).status, 403);
  assert.equal((await call('PUT', 'project-plans/example-app/stages/ship', { status: 'active' }, { headers: { origin: 'https://evil.example' } })).status, 403);
});

test('the list gives each plan its name, updated, counts by status, and its active and next stages', async () => {
  reset();
  const { status, body } = await call('GET', 'project-plans');
  assert.equal(status, 200);
  // Sorted by name: Demo course, then Example app.
  assert.deepEqual(body.plans.map(plan => plan.key), ['school__demo-course', 'example-app']);
  const app = body.plans.find(plan => plan.key === 'example-app');
  assert.equal(app.name, 'Example app'); assert.equal(app.updated, '2026-09-01T10:00:00.000Z');
  assert.equal(app.total, 3); assert.equal(app.done, 1);
  assert.equal(app.counts.completed, 1); assert.equal(app.counts.active, 1); assert.equal(app.counts.pending, 1); assert.equal(app.counts.failed, 0);
  assert.deepEqual(app.active, ['Build']); assert.equal(app.next, 'Ship');
});

test('a broken plan file is left out of the list and reported when opened', async () => {
  reset();
  fs.writeFileSync(file('broken'), '{ not json');
  const list = await call('GET', 'project-plans');
  assert.equal(list.status, 200); assert.equal(list.body.plans.length, 2);
  const one = await call('GET', 'project-plans/broken');
  assert.equal(one.status, 422); assert.match(one.body.error, /not valid JSON/);
});

test('one plan comes back whole; a project without one answers plan: null', async () => {
  reset();
  const { status, body } = await call('GET', 'project-plans/example-app');
  assert.equal(status, 200);
  assert.match(body.plan.walkthrough, /A \*\*made-up\*\* project/);
  assert.deepEqual(body.plan.pipeline.stages.map(stage => stage.status), ['completed', 'active', 'pending']);
  const missing = await call('GET', 'project-plans/nothing-here');
  assert.equal(missing.status, 200); assert.equal(missing.body.plan, null);
});

test('keys that could leave the plans folder are refused', async () => {
  reset();
  fs.writeFileSync(path.join(home, '.brain', 'secret.json'), JSON.stringify(fixture('secret', 'Secret', [])));
  for (const key of ['..', '...', encodeURIComponent('../secret'), encodeURIComponent('..\\secret'), 'a%2Fb', encodeURIComponent('C:\\x'), '%E0%A4%A']) {
    const reply = await call('GET', 'project-plans/' + key);
    assert.equal(reply.status, 404, key); assert.equal(reply.body.plan, undefined, key);
  }
  assert.equal((await call('PUT', 'project-plans/' + encodeURIComponent('../secret') + '/stages/x', { status: 'active' })).status, 404);
  assert.equal((await call('PUT', 'project-plans/example-app/stages/' + encodeURIComponent('../x'), { status: 'active' })).status, 404);
});

test('PUT changes one stage through the shared rules and writes the file atomically, keeping every other field', async () => {
  reset();
  const { status, body } = await call('PUT', 'project-plans/example-app/stages/ship', { status: 'completed', detail: 'Released', progress: 100, output: 'v1.0' });
  assert.equal(status, 200);
  const ship = body.plan.pipeline.stages.find(stage => stage.id === 'ship');
  assert.equal(ship.status, 'completed'); assert.equal(ship.detail, 'Released'); assert.equal(ship.output, 'v1.0'); assert.equal(ship.progress, 100);
  assert.match(ship.doneOn, /^\d{4}-\d{2}-\d{2}$/); assert.ok(ship.endedAt); assert.equal(ship.done, undefined);
  const disk = read('example-app');
  assert.equal(disk.pipeline.stages[2].status, 'completed');
  assert.deepEqual(disk.extra, { kept: true }); assert.equal(disk.pipeline.stages[0].description, 'x');
  assert.notEqual(disk.updated, '2026-09-01T10:00:00.000Z');
  // No temp file is left beside the plan.
  assert.deepEqual(fs.readdirSync(plansDir()).filter(name => name.endsWith('.tmp')), []);
  // Empty text clears a field; progress null clears the bar.
  const cleared = await call('PUT', 'project-plans/example-app/stages/ship', { output: '', progress: null });
  const after = cleared.body.plan.pipeline.stages.find(stage => stage.id === 'ship');
  assert.equal(after.output, undefined); assert.equal(after.progress, undefined);
});

test('PUT validates: status, progress, output size, unknown fields and a missing stage or plan', async () => {
  reset();
  const before = fs.readFileSync(file('example-app'), 'utf8');
  const bad = async (body, pattern, code = 400, route = 'project-plans/example-app/stages/build') => { const reply = await call('PUT', route, body); assert.equal(reply.status, code, JSON.stringify(body)); assert.match(reply.body.error, pattern); };
  await bad({ status: 'running' }, /status must be one of: pending, queued, active/);
  await bad({ progress: 101 }, /progress must be a number from 0 to 100/);
  await bad({ progress: 'half' }, /progress must be a number from 0 to 100/);
  await bad({ output: 'x'.repeat(16385) }, /output must be a string of at most 16384/);
  await bad({ detail: 5 }, /detail must be a string/);
  await bad({ title: 'Renamed' }, /Unknown field title/);
  await bad({}, /Send at least one of/);
  await bad({ status: 'active' }, /No stage with that id/, 404, 'project-plans/example-app/stages/nope');
  await bad({ status: 'active' }, /No plan for that project yet/, 404, 'project-plans/nothing-here/stages/a');
  assert.equal(fs.readFileSync(file('example-app'), 'utf8'), before);
  const notJson = await call('PUT', 'project-plans/example-app/stages/build', undefined);
  assert.equal(notJson.status, 400);
});

test('POST adds a stage at the end, pending unless a status is given', async () => {
  reset();
  const { status, body } = await call('POST', 'project-plans/example-app/stages', { title: '  Write docs  ' });
  assert.equal(status, 201);
  assert.equal(body.stage.title, 'Write docs'); assert.equal(body.stage.status, 'pending');
  assert.deepEqual(read('example-app').pipeline.stages.map(stage => stage.title), ['Scope', 'Build', 'Ship', 'Write docs']);
  assert.equal((await call('POST', 'project-plans/example-app/stages', { title: ' ' })).status, 400);
  assert.equal((await call('POST', 'project-plans/example-app/stages', { title: 'X', status: 'nope' })).status, 400);
});
