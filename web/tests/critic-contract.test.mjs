import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { handleApi, tokenMatches, validateOrigin } from '../server/api.mjs';
import { generate, signJob, verifyJob, generationStatus, chat } from '../server/providers.mjs';
import { confinedFile, isWithin } from '../server/library.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
async function withEnvironment(values, run) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
  try { return await run(); } finally {
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}
async function withFetch(fetch, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}
async function apiRequest({ route = 'chat', method = 'POST', headers = {}, body = {}, local = false, raw } = {}) {
  const req = Readable.from([Buffer.from(raw ?? JSON.stringify(body))]);
  Object.assign(req, { url: '/api/' + route, method, headers: { host: 'workspace.example', 'content-type': 'application/json', ...headers } });
  const result = {};
  const res = { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(value) { result.body = JSON.parse(value); } };
  await handleApi(req, res, { local });
  return result;
}

test('Gemini images parse the current model_output steps response, not retired outputs', async () => {
  // Current REST contract: https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026
  let calls = 0;
  await withEnvironment({ GEMINI_API_KEY: 'critic-mock-key' }, () => withFetch(async (url, options) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'critic-mock-key');
    return new Response(JSON.stringify({ id: 'fixture', status: 'completed', steps: [
      { type: 'thought', summary: [{ type: 'text', text: 'Image plan' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Here is the image.' }, { type: 'image', mime_type: 'image/png', data: png }] },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const result = await generate({ provider: 'gemini', prompt: 'A test garden', aspect: '1:1' });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.images, ['data:image/png;base64,' + png]);
  }));
  assert.equal(calls, 1);
});

test('local origin validation denies forged hosts and browser cross-origin requests', () => {
  const check = headers => validateOrigin({ headers }, true);
  assert.equal(check({ host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174' }), true);
  assert.equal(check({ host: 'localhost:5174' }), true);
  for (const headers of [
    {}, { host: 'attacker.example' }, { host: 'localhost.attacker.example' },
    { host: 'localhost:5174', origin: 'http://attacker.example' },
    { host: 'localhost:5174', origin: 'http://localhost:5175' },
    { host: 'localhost:5174', origin: 'null' },
    { host: 'localhost:5174', 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(check(headers), false, JSON.stringify(headers));
  assert.equal(tokenMatches('Bearer abc', 'Bearer abc'), true);
  assert.equal(tokenMatches('Bearer abc', 'Bearer abd'), false);
  assert.equal(tokenMatches(undefined, 'Bearer abc'), false);
});

test('hosted mutations and local library reads require configured authorization', async () => {
  await withFetch(() => { throw new Error('External fetch forbidden in this test'); }, async () => {
    await withEnvironment({ APP_ACCESS_TOKEN: undefined }, async () => assert.equal((await apiRequest()).status, 503));
    await withEnvironment({ APP_ACCESS_TOKEN: 'critic-test-token' }, async () => {
      assert.equal((await apiRequest()).status, 401);
      assert.equal((await apiRequest({ headers: { authorization: 'Bearer wrong' } })).status, 401);
      assert.equal((await apiRequest({ route: 'sources', method: 'GET', headers: { authorization: 'Bearer critic-test-token' } })).status, 404);
      assert.equal((await apiRequest({ route: 'source', headers: { authorization: 'Bearer critic-test-token' }, body: { id: '../../secret' } })).status, 404);
      assert.equal((await apiRequest({ route: 'sources', method: 'GET', local: true, headers: { host: 'localhost:5174' } })).status, 401);
    });
  });
});

test('invalid JSON, body size, and unsupported requests fail before provider access', async () => {
  await withEnvironment({ APP_ACCESS_TOKEN: 'critic-test-token' }, () => withFetch(() => {
    throw new Error('External fetch forbidden in this test');
  }, async () => {
    const headers = { authorization: 'Bearer critic-test-token' };
    assert.equal((await apiRequest({ headers, raw: '{broken' })).status, 400);
    assert.equal((await apiRequest({ headers, raw: JSON.stringify({ value: 'x'.repeat(600001) }) })).status, 400);
    assert.equal((await apiRequest({ headers: { ...headers, 'content-type': 'text/plain' } })).status, 400);
    const invalid = await apiRequest({ headers, body: { provider: 'unknown', model: 'irrelevant', messages: [] } });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /supported chat provider/);
  }));
});

test('generation tickets reject tampering and a different provider before fetching', async () => {
  await withEnvironment({ APP_ACCESS_TOKEN: 'critic-test-token' }, () => withFetch(() => {
    throw new Error('External fetch forbidden in this test');
  }, async () => {
    const ticket = signJob({ provider: 'fal', model: 'fixture', statusURL: 'https://queue.fal.run/fal-ai/flux/requests/id/status' });
    assert.equal(verifyJob(ticket).provider, 'fal');
    assert.throws(() => verifyJob(ticket + 'x'), /Invalid generation ticket/);
    await assert.rejects(generationStatus({ provider: 'kie', job: ticket }), /different provider/);
    await assert.rejects(generationStatus({ provider: 'fal', job: 'forged' }), /Invalid generation ticket/);
  }));
});

test('chat preserves selected model and explicitly attached context at provider boundary', async () => {
  await withEnvironment({ ANTHROPIC_API_KEY: 'critic-mock-key' }, () => withFetch(async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'configured-test-model');
    assert.match(request.system, /Named reference/);
    assert.match(request.system, /Known fixture fact/);
    assert.match(request.system, /no shell, browser, or autonomous tools/);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Fixture reply' }] }), { status: 200 });
  }, async () => {
    const response = await chat({ provider: 'claude', model: 'configured-test-model', messages: [{ role: 'user', content: 'Use my reference' }], context: [{ name: 'Named reference', kind: 'file', content: 'Known fixture fact' }] });
    assert.equal(response.text, 'Fixture reply');
    assert.equal(response.model, 'configured-test-model');
  }));
});

test('local file confinement rejects traversal, sibling paths, directories, and oversized files', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'second-brain-critic-contract-'));
  const root = path.join(temporary, 'allowed');
  const sibling = path.join(temporary, 'allowed-elsewhere');
  try {
    await fs.mkdir(root);
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(root, 'ok.md'), '# fixture');
    await fs.writeFile(path.join(sibling, 'outside.md'), '# outside');
    assert.equal(isWithin(root, path.join(root, 'ok.md')), true);
    assert.equal(isWithin(root, path.join(sibling, 'outside.md')), false);
    assert.equal((await confinedFile(root, path.join(root, 'ok.md'))).stat.size, 9);
    await assert.rejects(confinedFile(root, path.join(root, '../allowed-elsewhere/outside.md')), /outside its allowed library/);
    await assert.rejects(confinedFile(root, root), /local preview limit/);
    const large = await fs.open(path.join(root, 'large.bin'), 'w');
    await large.truncate(20 * 1024 * 1024 + 1);
    await large.close();
    await assert.rejects(confinedFile(root, path.join(root, 'large.bin')), /local preview limit/);
    const link = path.join(root, 'escape');
    await fs.symlink(sibling, link, 'junction');
    await assert.rejects(confinedFile(root, path.join(link, 'outside.md')), /outside its allowed library/);
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('second-brain-critic-contract-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
