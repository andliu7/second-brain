import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// An empty skills folder, set before the runner loads, so every task reads as missing
// and no test can ever start a real claude run.
process.env.CLAUDE_SKILLS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'no-skills-'));
const { handleApi } = await import('../server/api.mjs');
const { TASKS, buildCommand, listTasks, startRun } = await import('../server/runner.mjs');

async function apiRequest({ route, method = 'GET', body, local, token }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  const auth = token ? { authorization: 'Bearer ' + token } : {};
  Object.assign(req, { url: '/api/' + route, method, headers: { host: '127.0.0.1:5174', 'content-type': 'application/json', ...auth } });
  const result = {};
  const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(value); } };
  await handleApi(req, res, { local });
  return result;
}

test('skill runs do not exist on a hosted deployment, even for an authorized caller', async () => {
  const token = 'hosted-test-token';
  process.env.APP_ACCESS_TOKEN = token;
  try {
    assert.equal((await apiRequest({ route: 'tasks', local: false, token })).status, 404);
    assert.equal((await apiRequest({ route: 'run', method: 'POST', body: { id: 'clean-up' }, local: false, token })).status, 404);
  } finally {
    delete process.env.APP_ACCESS_TOKEN;
  }
});

test('a task whose skill is not installed is flagged and refused, never run', async () => {
  const listed = await apiRequest({ route: 'tasks', local: true });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.tasks.length >= 2);
  for (const task of listed.body.tasks) assert.equal(task.missing, '/' + TASKS.find(t => t.id === task.id).skill);
  const refused = await apiRequest({ route: 'run', method: 'POST', body: { id: 'clean-up' }, local: true });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /not installed/);
  assert.equal(listTasks().find(t => t.id === 'clean-up').run, null);
});

test('only ids from the fixed list are accepted', () => {
  for (const id of ['', 'rm -rf', '../clean-up', 'generate']) assert.throws(() => startRun(id), /Unknown task/);
});

test('every command is built from the table, with the prompt quoted', () => {
  for (const task of TASKS) {
    // The shell quoting relies on this: a double quote in a prompt would end the argument.
    assert.ok(!task.prompt.includes('"'), `${task.id} prompt contains a double quote`);
    const command = buildCommand(task);
    assert.ok(command.startsWith(`claude -p "${task.prompt}"`));
    assert.ok(command.endsWith('--permission-mode bypassPermissions'));
  }
});
