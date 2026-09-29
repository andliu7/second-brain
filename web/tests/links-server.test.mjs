// GET /api/links (server/links.mjs through api.mjs, so the origin check is real too). HOME points at a temp
// folder, so the real ~/.brain/links.json is never read; every URL here is example.com or loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'links-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
delete process.env.APP_ACCESS_TOKEN;
const { linksFile } = await import('../server/links.mjs');
const { handleApi } = await import('../server/api.mjs');

async function call({ host = '127.0.0.1:5174', origin = 'http://' + host, local = true, headers = {} } = {}) {
  const req = { url: '/api/links', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host, ...(origin ? { origin } : {}), ...headers } };
  const result = {};
  await handleApi(req, { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(String(value)); } }, { local });
  return result;
}
function write(value) { fs.mkdirSync(path.dirname(linksFile()), { recursive: true }); fs.writeFileSync(linksFile(), typeof value === 'string' ? value : JSON.stringify(value)); }

test('the file lives under the temp home, never the real profile', () => {
  assert.ok(linksFile().startsWith(home));
});

test('returns the parsed groups, keeping label, url, note and project', async () => {
  write({ note: 'test', groups: [
    { name: 'Sites', links: [{ label: 'Docs', url: 'https://docs.example.com/', note: 'Reference' }, { label: 'Local', url: 'http://127.0.0.1:5180/?setup=1', note: 'This PC only' }] },
    { name: 'Repositories', links: [{ label: 'repo', url: 'https://github.com/example/repo', project: 'grignard/grignard-app-source' }] },
  ] });
  const reply = await call();
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { groups: [
    { name: 'Sites', links: [{ label: 'Docs', url: 'https://docs.example.com/', note: 'Reference' }, { label: 'Local', url: 'http://127.0.0.1:5180/?setup=1', note: 'This PC only' }] },
    { name: 'Repositories', links: [{ label: 'repo', url: 'https://github.com/example/repo', project: 'grignard/grignard-app-source' }] },
  ] });
});

test('rejects javascript: and file: links, keeps the good one, and names what it skipped', async () => {
  write({ groups: [{ name: 'Mixed', links: [
    { label: 'Script', url: 'javascript:alert(1)' },
    { label: 'Disk', url: 'file:///C:/Windows/System32' },
    { label: 'Fine', url: 'https://example.com/' },
  ] }] });
  const reply = await call();
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.groups, [{ name: 'Mixed', links: [{ label: 'Fine', url: 'https://example.com/' }] }]);
  assert.match(reply.body.error, /"Script" is not an http or https link/);
  assert.match(reply.body.error, /"Disk" is not an http or https link/);
});

test('bounds lengths and counts', async () => {
  write({ groups: [{ name: 'Big', links: [
    { label: 'x'.repeat(500), url: 'https://example.com/' },
    ...Array.from({ length: 80 }, (_, i) => ({ label: 'L' + i, url: 'https://example.com/' + i })),
  ] }] });
  const reply = await call();
  assert.equal(reply.body.groups[0].links.length, 60);
  assert.match(reply.body.error, /label is missing or too long/);
  assert.match(reply.body.error, /past the first 60/);
});

test('a missing file is no links and no error', async () => {
  fs.rmSync(linksFile(), { force: true });
  const reply = await call();
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { groups: [] });
});

test('a malformed file is a readable error, never a 500', async () => {
  write('{ "groups": [ not json');
  let reply = await call();
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.groups, []);
  assert.match(reply.body.error, /not valid JSON/);
  write({ groups: 'nope' });
  reply = await call();
  assert.equal(reply.status, 200);
  assert.match(reply.body.error, /needs a "groups" list/);
});

test('a byte order mark, as PowerShell writes, still parses', async () => {
  write('\uFEFF' + JSON.stringify({ groups: [{ name: 'G', links: [{ label: 'A', url: 'https://example.com/' }] }] }));
  const reply = await call();
  assert.equal(reply.body.error, undefined);
  assert.equal(reply.body.groups[0].links[0].label, 'A');
});

test('the same origin checks as every local route: a foreign host or origin is refused, hosted is 404', async () => {
  assert.equal((await call({ host: 'evil.example.com' })).status, 403);
  assert.equal((await call({ origin: 'https://evil.example.com' })).status, 403);
  process.env.APP_ACCESS_TOKEN = 'test-token';
  try { assert.equal((await call({ local: false, headers: { authorization: 'Bearer test-token' } })).status, 404); } finally { delete process.env.APP_ACCESS_TOKEN; }
});
