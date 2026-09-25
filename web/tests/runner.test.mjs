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
const { TASKS, buildCommand, listTasks, readEvent, splitLines, startRun } = await import('../server/runner.mjs');

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
    // One JSON event per line as the run goes, so the page can stream its output
    assert.ok(command.includes('--output-format stream-json --verbose'));
  }
});

// P2b: the page streams a run's output and shows its closing summary as Takeaways. These are the
// shapes `claude -p --output-format stream-json --verbose` prints; the credits text is Claude Code's own.
test('stream-json lines become readable output, and the final result becomes the summary', () => {
  const run = { summary: null, error: false };
  const lines = [];
  const events = splitLines(line => lines.push(line));
  for (const chunk of ['{"type":"system","subtype":"init","model":"claude-opus-5"}\n{"type":"assis', 'tant","message":{"content":[{"type":"text","text":"Checking hooks."},{"type":"tool_use","name":"Bash","input":{"command":"claude doctor","description":"Run the health check"}}]}}\r\n', '{"type":"user","message":{"content":[{"type":"tool_result","content":"all good"}]}}\n{"type":"result","subtype":"success","is_error":false,"result":"## Findings\\n\\n- Settings: clean"}']) events.push(chunk);
  events.end();
  assert.equal(lines.length, 4); // a line cut across two chunks arrives whole, and the last line without a newline arrives at end()
  const output = lines.map(line => readEvent(line, run)).join('');
  assert.equal(output, 'Checking hooks.\n> Bash: Run the health check\n');
  assert.equal(run.summary, '## Findings\n\n- Settings: clean');
  assert.equal(run.error, false);
});

test('an error result marks the run failed and keeps its message; a line that is not JSON is logged as it is', () => {
  const run = { summary: null, error: false };
  const credits = "You're out of usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";
  assert.equal(readEvent(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: credits }] } }), run), credits + '\n');
  assert.equal(readEvent(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: credits }), run), '');
  assert.equal(run.summary, credits);
  assert.equal(run.error, true);
  assert.equal(readEvent("'claude' is not recognized as an internal or external command,", run), "'claude' is not recognized as an internal or external command,\n");
});
