// Project pipelines outside the browser: the workspace rules for the new stage and card fields
// (shared/validate.mjs via shared/pipeline.mjs), the server mirror (server/pipelines.mjs) with HOME pointed
// at a temp folder so nothing lands in the real profile or the repo, and the CLI Claude Code calls
// (scripts/pipeline.mjs) with fetch stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
delete process.env.APP_ACCESS_TOKEN;
const { validateWorkspace } = await import('../shared/validate.mjs');
const { mergeStages, withStatus, statusOf } = await import('../shared/pipeline.mjs');
const { handleApi } = await import('../server/api.mjs');
const { pipelinesFile } = await import('../server/pipelines.mjs');
const { main, parse, setBody } = await import('../scripts/pipeline.mjs');
const repo = fileURLToPath(new URL('../../', import.meta.url));

// ---- the workspace rules ----
const created = '2026-09-12T12:34:56.000Z';
const card = (extra = {}) => ({ id: 'card-1', title: 'Blueberry', notes: '', column: 'todo', checklist: [], attachments: [], ...extra });
function workspace(cards) {
  return { version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [], board: { view: 'board', columns: [{ id: 'todo', name: 'To do' }], cards } };
}
const rejects = (cards, pattern) => assert.throws(() => validateWorkspace(workspace(cards)), pattern);

test('a workspace from before pipelines validates unchanged: no pipeline, stages with only title, done, detail and doneOn', () => {
  const older = workspace([card({ project: true, checklist: [{ id: 's1', title: 'Outline', done: true, doneOn: '2026-09-20' }, { id: 's2', title: 'Draft', done: false, detail: 'notes' }] })]);
  assert.strictEqual(validateWorkspace(older), older);
  const noBoard = workspace([]); delete noBoard.board;
  assert.strictEqual(validateWorkspace(noBoard), noBoard);
});

test('a stage with every pipeline field, and a card with pipeline settings, validate', () => {
  const full = workspace([card({ project: true, pipeline: { enabled: true, layout: 'horizontal', subtitle: 'Unit 3' }, checklist: [
    { id: 's1', title: 'Draft', done: false, status: 'active', progress: 40, startedAt: created, updatedAt: created, attempt: 2, error: 'x', warning: 'y', logs: ['one', 'two'], output: 'out', skippable: true },
    { id: 's2', title: 'Review', done: true, status: 'warning', endedAt: created, doneOn: '2026-09-12' },
  ] })]);
  assert.strictEqual(validateWorkspace(full), full);
});

test('pipeline fields are bounded: status, progress, times, attempt, logs, skippable, the settings', () => {
  const stage = extra => [card({ checklist: [{ id: 's1', title: 'Draft', done: false, ...extra }] })];
  rejects(stage({ status: 'running' }), /checklist\[0\]\.status must be one of: pending, queued, active/);
  rejects(stage({ progress: 101 }), /checklist\[0\]\.progress must be a number from 0 to 100/);
  rejects(stage({ progress: Number.NaN }), /progress must be a number from 0 to 100/);
  rejects(stage({ startedAt: 'yesterday' }), /checklist\[0\]\.startedAt must be an ISO timestamp/);
  rejects(stage({ attempt: 0 }), /checklist\[0\]\.attempt must be a whole number from 1 to 1000/);
  rejects(stage({ logs: Array.from({ length: 201 }, () => 'x') }), /checklist\[0\]\.logs exceeds 200 lines/);
  rejects(stage({ logs: ['x'.repeat(2001)] }), /logs must hold strings of at most 2000 characters/);
  rejects(stage({ output: 'x'.repeat(16385) }), /checklist\[0\]\.output exceeds 16384 characters/);
  rejects(stage({ skippable: 'yes' }), /checklist\[0\]\.skippable must be a boolean/);
  rejects([card({ pipeline: { enabled: 'on', layout: 'vertical' } })], /board\.cards\[0\]\.pipeline\.enabled must be a boolean/);
  rejects([card({ pipeline: { enabled: true, layout: 'grid' } })], /board\.cards\[0\]\.pipeline\.layout must be one of: vertical, horizontal/);
  rejects([card({ pipeline: true })], /board\.cards\[0\]\.pipeline must be an object/);
});

test('status and done stay in step, and done wins when an older view ticked the item without a status', () => {
  const stamp = new Date('2026-09-28T10:00:00.000Z');
  const active = withStatus({ id: 's', title: 'S', done: false }, 'active', stamp);
  assert.deepEqual([active.done, active.startedAt, active.updatedAt], [false, stamp.toISOString(), stamp.toISOString()]);
  for (const status of ['completed', 'warning', 'skipped']) assert.equal(withStatus(active, status, stamp).done, true);
  for (const status of ['failed', 'cancelled', 'paused', 'queued', 'pending']) assert.equal(withStatus(active, status, stamp).done, false);
  assert.equal(withStatus(active, 'failed', stamp).endedAt, stamp.toISOString());
  assert.equal(statusOf({ done: true, status: 'failed' }), 'completed');
  assert.equal(statusOf({ done: false, status: 'completed' }), 'pending');
  assert.equal(statusOf({ done: false, status: 'failed' }), 'failed');
  assert.equal(statusOf({ done: true }), 'completed');
});

test('the merge: newer stamp wins per stage, a stage only the other side has is new if it changed after seen, else deleted', () => {
  const mine = [{ id: 'a', title: 'A mine', updatedAt: '2026-09-28T10:00:00.000Z' }, { id: 'b', title: 'B mine', updatedAt: '2026-09-28T10:05:00.000Z' }];
  const theirs = [{ id: 'a', title: 'A theirs', updatedAt: '2026-09-28T10:01:00.000Z' }, { id: 'b', title: 'B theirs', updatedAt: '2026-09-28T10:04:00.000Z' },
    { id: 'c', title: 'Added by Claude', updatedAt: '2026-09-28T10:03:00.000Z' }, { id: 'd', title: 'Deleted here', updatedAt: '2026-09-28T09:00:00.000Z' }];
  assert.deepEqual(mergeStages(mine, theirs, '2026-09-28T10:02:00.000Z').map(s => s.title), ['A theirs', 'B mine', 'Added by Claude']);
});

// ---- the server mirror ----
async function call(method, route, body, { host = '127.0.0.1:5174', headers = {}, local = true } = {}) {
  const req = { url: '/api/' + route, method, headers: { host, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body };
  const result = {};
  const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(String(value)); } };
  await handleApi(req, res, { local });
  return result;
}
const stamp = minutes => new Date(Date.UTC(2026, 8, 28, 10, minutes)).toISOString();
const push = (stages, seen, extra = {}) => call('PUT', 'pipelines/card-1', { title: 'Blueberry unit 3', layout: 'vertical', stages, seen, ...extra });
const STAGES = [{ id: 's1', title: 'Outline', done: true, status: 'completed', updatedAt: stamp(0) }, { id: 's2', title: 'Draft questions', done: false, status: 'pending', updatedAt: stamp(0) }];

test('the mirror file lives under the user profile, never in the repository', () => {
  assert.equal(pipelinesFile(), path.join(home, '.brain', 'pipelines.json'));
  assert.ok(!path.resolve(pipelinesFile()).startsWith(path.resolve(repo)));
});

test('pipelines are local only and keep the origin and Host checks', async () => {
  process.env.APP_ACCESS_TOKEN = 'hosted-token';
  try { assert.equal((await call('GET', 'pipelines', undefined, { local: false, headers: { authorization: 'Bearer hosted-token' } })).status, 404); }
  finally { delete process.env.APP_ACCESS_TOKEN; }
  assert.equal((await call('GET', 'pipelines', undefined, { host: 'evil.example:5174' })).status, 403);
  assert.equal((await call('GET', 'pipelines', undefined, { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call('PATCH', 'pipelines/card-1/stages/s1', { status: 'active' }, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const empty = await call('GET', 'pipelines');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.pipelines, []);
  assert.ok(Date.parse(empty.body.now));
});

test('a push creates the mirror; GET reads it; PATCH changes status, progress, log, error, warning and output', async () => {
  const pushed = await push(STAGES, '');
  assert.equal(pushed.status, 200);
  assert.ok(fs.existsSync(path.join(home, '.brain', 'pipelines.json')));
  assert.equal((await call('GET', 'pipelines/card-1')).body.pipeline.title, 'Blueberry unit 3');
  const set = await call('PATCH', 'pipelines/card-1/stages/s2', { status: 'active', progress: 40 });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.stage.status, set.body.stage.done, set.body.stage.progress], ['active', false, 40]);
  assert.ok(set.body.stage.startedAt && set.body.stage.updatedAt > stamp(0));
  await call('PATCH', 'pipelines/card-1/stages/s2', { log: 'Lesson 1 drafted' });
  const logged = await call('PATCH', 'pipelines/card-1/stages/s2', { log: ['Lesson 2 drafted', 'Lesson 3 drafted'], warning: 'one source is paywalled', error: 'x' });
  assert.deepEqual(logged.body.stage.logs, ['Lesson 1 drafted', 'Lesson 2 drafted', 'Lesson 3 drafted']);
  assert.equal(logged.body.stage.warning, 'one source is paywalled');
  const cleared = await call('PATCH', 'pipelines/card-1/stages/s2', { error: '', progress: null, output: '60 questions' });
  assert.equal(cleared.body.stage.error, undefined);
  assert.equal(cleared.body.stage.progress, undefined);
  assert.equal(cleared.body.stage.output, '60 questions');
  const done = await call('PATCH', 'pipelines/card-1/stages/s2', { status: 'completed' });
  assert.deepEqual([done.body.stage.done, typeof done.body.stage.doneOn, done.body.pipeline.done], [true, 'string', 2]);
  const list = await call('GET', 'pipelines');
  assert.deepEqual(list.body.pipelines.map(p => [p.cardId, p.done, p.stages.length]), [['card-1', 2, 2]]);
});

test('logs are capped at the newest 200 lines', async () => {
  await call('PATCH', 'pipelines/card-1/stages/s1', { log: Array.from({ length: 200 }, (_, i) => `line ${i}`) });
  const more = await call('PATCH', 'pipelines/card-1/stages/s1', { log: 'the last line' });
  assert.equal(more.body.stage.logs.length, 200);
  assert.equal(more.body.stage.logs.at(-1), 'the last line');
  assert.equal(more.body.stage.logs[0], 'line 1');
});

test('bad input is refused with a reason and changes nothing', async () => {
  const before = fs.readFileSync(pipelinesFile(), 'utf8');
  const cases = [
    [{ status: 'running' }, /status must be one of/], [{ progress: 150 }, /progress must be a number from 0 to 100/], [{ progress: '40' }, /progress must be a number/],
    [{}, /Send at least one of/], [{ title: 'renamed' }, /Unknown field title/], [{ log: 'x'.repeat(2001) }, /log must be a string of at most 2000/], [{ log: [] }, /log must be a line/],
  ];
  for (const [body, pattern] of cases) { const reply = await call('PATCH', 'pipelines/card-1/stages/s2', body); assert.equal(reply.status, 400, JSON.stringify(body)); assert.match(reply.body.error, pattern); }
  assert.equal((await call('PATCH', 'pipelines/card-1/stages/nope', { status: 'active' })).status, 404);
  assert.equal((await call('PATCH', 'pipelines/card-9/stages/s1', { status: 'active' })).status, 404);
  assert.equal((await call('PATCH', 'pipelines/bad%20id/stages/s1', { status: 'active' })).status, 404);
  assert.equal((await call('POST', 'pipelines/card-1/stages', { title: ' ' })).status, 400);
  assert.equal((await push([{ id: 's1', title: 'x', done: false, progress: 101 }], '')).status, 400);
  assert.equal((await push([{ id: 's1', title: 'x', done: false }, { id: 's1', title: 'y', done: false }], '')).status, 400);
  assert.equal((await push(STAGES, '', { layout: 'grid' })).status, 400);
  const notJson = { url: '/api/pipelines/card-1/stages/s1', method: 'PATCH', headers: { host: '127.0.0.1:5174', 'content-type': 'text/plain' }, body: 'status=active' };
  const result = {}; await handleApi(notJson, { writeHead(status) { result.status = status; }, end() {} }, { local: true });
  assert.equal(result.status, 400);
  assert.equal(fs.readFileSync(pipelinesFile(), 'utf8'), before);
});

test('POST adds a stage at the end; the next push keeps it if the app had not seen it, and drops a stage the app deleted', async () => {
  await push(STAGES, '');
  const seen = (await call('GET', 'pipelines/card-1')).body.now;
  const added = await call('POST', 'pipelines/card-1/stages', { title: 'Review', status: 'queued' });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.pipeline.stages.map(s => s.title), ['Outline', 'Draft questions', 'Review']);
  assert.equal(added.body.stage.status, 'queued');
  // The app, which last looked at `seen`, deleted Outline and renamed Draft with an older stamp than the server's copy.
  const merged = await push([{ ...STAGES[1], title: 'Draft (renamed, older)', updatedAt: stamp(0) }], seen);
  assert.deepEqual(merged.body.pipeline.stages.map(s => s.title), ['Draft questions', 'Review']);
});

test('DELETE takes a pipeline out of the mirror', async () => {
  assert.equal((await call('DELETE', 'pipelines/card-1')).status, 200);
  assert.equal((await call('GET', 'pipelines/card-1')).status, 404);
});

// ---- the CLI ----
function stub(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }); const [status, body] = answers(url, init.method); return { ok: status < 400, status, json: async () => body }; };
  return { calls, fetch };
}
const LIST = { pipelines: [{ cardId: 'card-1', title: 'Blueberry unit 3', done: 1, stages: [{ id: 's1', title: 'Outline', done: true }, { id: 's2', title: 'Draft questions', done: false }] }, { cardId: 'card-2', title: 'Clean up', done: 0, stages: [] }] };
async function run(argv, answers = (url, method) => method === 'GET' ? [200, LIST] : [200, { pipeline: { stages: [1, 2, 3] }, stage: { title: 'Draft questions', status: 'active', done: false, progress: 40, logs: ['a'] } }]) {
  const { calls, fetch } = stub(answers), out = [], err = [];
  const code = await main(argv, { fetch, port: 5199, out: line => out.push(line), err: line => err.push(line) });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

test('the CLI parses words and flags', () => {
  assert.deepEqual(parse(['set', 'Blue', 'draft', '--status', 'active', '--progress', '40']), { command: 'set', words: ['Blue', 'draft'], flags: { status: 'active', progress: '40' } });
  assert.deepEqual(setBody({ status: 'active', progress: '40' }), { status: 'active', progress: 40 });
  assert.deepEqual(setBody({ progress: 'none' }), { progress: null });
  assert.throws(() => setBody({ progress: '140' }), /--progress must be a number from 0 to 100/);
  assert.throws(() => setBody({}), /set needs at least one of/);
  assert.throws(() => parse(['set', 'a', 'b', '--status']), /--status needs a value/);
});

test('set, log and add call the right endpoint on 127.0.0.1 and PORT with the right body', async () => {
  const set = await run(['set', 'blueberry', 'draft', '--status', 'active', '--progress', '40']);
  assert.equal(set.code, 0);
  assert.deepEqual(set.calls.map(c => [c.method, c.url]), [['GET', 'http://127.0.0.1:5199/api/pipelines'], ['PATCH', 'http://127.0.0.1:5199/api/pipelines/card-1/stages/s2']]);
  assert.deepEqual(set.calls[1].body, { status: 'active', progress: 40 });
  assert.match(set.out, /Draft questions: active, 40%/);
  const byNumber = await run(['log', 'card-1', '2', 'Lesson 4 drafted']);
  assert.deepEqual([byNumber.calls[1].url, byNumber.calls[1].body], ['http://127.0.0.1:5199/api/pipelines/card-1/stages/s2', { log: 'Lesson 4 drafted' }]);
  const add = await run(['add', 'Clean up', 'Report', '--status', 'queued']);
  assert.deepEqual([add.calls[1].method, add.calls[1].url, add.calls[1].body], ['POST', 'http://127.0.0.1:5199/api/pipelines/card-2/stages', { title: 'Report', status: 'queued' }]);
  const list = await run(['list']);
  assert.match(list.out, /Blueberry unit 3 {2}1 of 2 stages {2}\(card-1\)/);
});

test('the CLI refuses a bad status before any request, and names an unknown or ambiguous project', async () => {
  const bad = await run(['set', 'blueberry', 'draft', '--status', 'running']);
  assert.deepEqual([bad.code, bad.calls.length], [2, 0]);
  assert.match(bad.err, /--status must be one of/);
  const unknown = await run(['show', 'nothing']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /No project matches "nothing"/);
  const ambiguous = await run(['show', 'u']);
  assert.match(ambiguous.err, /matches more than one project: Blueberry unit 3, Clean up/);
  const refused = await run(['set', 'blueberry', 'draft', '--progress', '5'], (url, method) => method === 'GET' ? [200, LIST] : [400, { error: 'progress must be a number from 0 to 100, or null to clear it.' }]);
  assert.deepEqual([refused.code, refused.err], [1, 'progress must be a number from 0 to 100, or null to clear it.']);
  const offline = await main(['list'], { fetch: async () => { throw new Error('ECONNREFUSED'); }, port: 5199, out: () => {}, err: line => assert.match(line, /not running on 127\.0\.0\.1:5199/) });
  assert.equal(offline, 1);
});

test('end to end: the CLI against the real routes, through a fetch that calls the handler', async () => {
  await push(STAGES, '');
  const fetch = async (url, init = {}) => { const u = new URL(url); const reply = await call(init.method, u.pathname.replace(/^\/api\//, ''), init.body ? JSON.parse(init.body) : undefined, { host: u.host }); return { ok: reply.status < 400, status: reply.status, json: async () => reply.body }; };
  const out = [];
  assert.equal(await main(['set', 'Blueberry', 'Draft', '--status', 'active', '--progress', '25'], { fetch, port: 5174, out: line => out.push(line), err: line => assert.fail(line) }), 0);
  assert.equal(await main(['log', 'Blueberry', 'Draft', 'Lesson 1 drafted'], { fetch, port: 5174, out: line => out.push(line), err: line => assert.fail(line) }), 0);
  assert.equal(await main(['add', 'Blueberry', 'Publish'], { fetch, port: 5174, out: line => out.push(line), err: line => assert.fail(line) }), 0);
  assert.equal(await main(['show', 'Blueberry'], { fetch, port: 5174, out: line => out.push(line), err: line => assert.fail(line) }), 0);
  assert.match(out.at(-1), /2\. \[active\] Draft questions {2}\(25%\)/);
  assert.match(out.at(-1), /3\. \[pending\] Publish/);
  const saved = JSON.parse(fs.readFileSync(pipelinesFile(), 'utf8')).pipelines['card-1'].stages[1];
  assert.deepEqual([saved.status, saved.progress, saved.logs], ['active', 25, ['Lesson 1 drafted']]);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
