// The key store and its routes outside the browser (server/keys.mjs through api.mjs, so the origin check is real
// too). HOME points at a temp folder, so no store ever lands in the real profile. Every key here is a made-up
// string; fetch is stubbed, so no provider is ever called. The cipher is a fake by default, so the tests say what
// the store does with bytes; one Windows-only test runs real DPAPI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
delete process.env.APP_ACCESS_TOKEN;
for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAL_KEY', 'KIE_API_KEY', 'FDC_API_KEY']) delete process.env[name];
process.env.BRAIN_ALLOWED_HOSTS = 'brain.tailnet-test.ts.net';
const keys = await import('../server/keys.mjs');
const { providerKey } = await import('../server/providers.mjs');
const { usdaKey } = await import('../server/health.mjs');
const { handleApi } = await import('../server/api.mjs');
const { brainSummary } = await import('../server/live.mjs');

// Reversible and obviously not encryption: it only has to prove the store never writes the plaintext and reads
// back what it wrote.
const fake = { scheme: 'fake', protect: async bytes => Buffer.from(bytes.map(b => b ^ 0x5a)), unprotect: async bytes => Buffer.from(bytes.map(b => b ^ 0x5a)) };
keys.deps.cipher = fake;
const calls = [];
const answer = (status, body = {}) => async (url, options) => { calls.push({ url: String(url), options }); return { status, json: async () => body }; };
keys.deps.fetch = answer(200);

const FAKE_KEY = 'sk-test-' + 'x'.repeat(30) + 'WXYZ';
const onDisk = () => fs.readFileSync(keys.storeFile(), 'utf8');

async function call(route, { method = 'GET', body, host = '127.0.0.1:5174', remote = '127.0.0.1', origin = 'http://' + host, headers = {}, local = true } = {}) {
  const req = { url: '/api/' + route, method, socket: { remoteAddress: remote }, headers: { host, 'content-type': 'application/json', ...(origin ? { origin } : {}), ...headers }, ...(body !== undefined ? { body } : {}) };
  const result = {};
  await handleApi(req, { writeHead(status) { result.status = status; }, end(value) { result.text = String(value); result.body = JSON.parse(result.text); } }, { local });
  return result;
}
async function reset() { fs.rmSync(keys.storeFile(), { force: true }); await keys.loadKeys(); keys.deps.cipher = fake; keys.deps.fetch = answer(200); calls.length = 0; }

test('the store round trips through its cipher and never writes the key in plain text', async () => {
  await reset();
  await keys.saveKey('claude', FAKE_KEY);
  assert.ok(!onDisk().includes(FAKE_KEY), 'plaintext key on disk');
  assert.equal(JSON.parse(onDisk()).scheme, 'fake');
  await keys.loadKeys();
  assert.equal(keys.storedKey('claude'), FAKE_KEY);
  await keys.removeKey('claude');
  assert.equal(keys.storedKey('claude'), undefined);
  assert.ok(!fs.existsSync(keys.storeFile()), 'an empty store is deleted, not left holding nothing');
});

test('a store that will not open refuses every save rather than overwriting it', async () => {
  await reset();
  await keys.saveKey('openai', FAKE_KEY);
  keys.deps.cipher = { ...fake, unprotect: async () => { throw new Error('cannot open'); } };
  const original = process.stderr.write; process.stderr.write = () => true;
  try { await keys.loadKeys(); } finally { process.stderr.write = original; }
  const before = onDisk();
  await assert.rejects(keys.saveKey('claude', FAKE_KEY), /could not be opened/);
  assert.equal(onDisk(), before);
});

test('real DPAPI round trips on Windows, with no key in the file', { skip: process.platform !== 'win32' && 'DPAPI exists only on Windows' }, async () => {
  await reset();
  keys.deps.cipher = keys.dpapi;
  try {
    await keys.saveKey('usda', FAKE_KEY);
    const file = JSON.parse(onDisk());
    assert.equal(file.scheme, 'dpapi');
    assert.ok(!onDisk().includes(FAKE_KEY) && !Buffer.from(file.data, 'base64').toString('latin1').includes(FAKE_KEY));
    await keys.loadKeys();
    assert.equal(keys.storedKey('usda'), FAKE_KEY);
  } finally { keys.deps.cipher = fake; fs.rmSync(keys.storeFile(), { force: true }); await keys.loadKeys(); }
});

test('the AES fallback round trips and its key file sits beside the store', async () => {
  await reset();
  keys.deps.cipher = keys.aesGcm;
  try {
    await keys.saveKey('fal', FAKE_KEY);
    assert.ok(!onDisk().includes(FAKE_KEY));
    await keys.loadKeys();
    assert.equal(keys.storedKey('fal'), FAKE_KEY);
    assert.ok(fs.existsSync(path.join(home, '.brain', 'keys.aes.key')));
  } finally { keys.deps.cipher = fake; fs.rmSync(keys.storeFile(), { force: true }); await keys.loadKeys(); }
});

test('the routes never return a key, only its last four characters', async () => {
  await reset();
  const saved = await call('keys/openai', { method: 'PUT', body: { key: FAKE_KEY } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.key, { provider: 'openai', set: true, last4: 'WXYZ', source: 'store', status: 'green', checkedAt: saved.body.key.checkedAt, message: 'Key works' });
  const listed = await call('keys');
  const verified = await call('keys/openai/verify', { method: 'POST' });
  const removed = await call('keys/openai', { method: 'DELETE' });
  for (const response of [saved, listed, verified, removed]) {
    assert.ok(!response.text.includes(FAKE_KEY.slice(0, 12)) && !response.text.includes(FAKE_KEY), 'a response carried the key');
  }
  assert.equal(listed.body.readOnly, false);
  assert.deepEqual(listed.body.keys.map(k => k.provider), ['claude', 'openai', 'gemini', 'fal', 'kie', 'usda']);
  assert.deepEqual(Object.keys(listed.body.keys[1]).sort(), ['checkedAt', 'last4', 'message', 'provider', 'set', 'source', 'status']);
  assert.equal(removed.body.key.set, false);
});

test('only the PC itself may change a key: tailnet Host, tailnet socket, proxy headers and a missing Origin are refused', async () => {
  await reset();
  const tailnet = 'brain.tailnet-test.ts.net:5174';
  const refused = [
    await call('keys/claude', { method: 'PUT', body: { key: FAKE_KEY }, host: tailnet, remote: '100.64.1.2' }),
    // A tailnet device can claim any Host; the socket still gives it away.
    await call('keys/claude', { method: 'PUT', body: { key: FAKE_KEY }, remote: '100.64.1.2' }),
    await call('keys/claude', { method: 'PUT', body: { key: FAKE_KEY }, headers: { 'x-forwarded-for': '100.64.1.2' } }),
    await call('keys/claude', { method: 'PUT', body: { key: FAKE_KEY }, headers: { 'tailscale-user-login': 'someone@example.com' } }),
    await call('keys/claude', { method: 'PUT', body: { key: FAKE_KEY }, origin: null }),
    await call('keys/claude/verify', { method: 'POST', host: tailnet, remote: '100.64.1.2' }),
    await call('keys/claude', { method: 'DELETE', host: tailnet, remote: '100.64.1.2' }),
  ];
  assert.deepEqual(refused.map(r => r.status), [403, 403, 403, 403, 403, 403, 403]);
  assert.equal(keys.storedKey('claude'), undefined);
  assert.ok(!fs.existsSync(keys.storeFile()));
  // A foreign Host fails api.mjs's own check before keys.mjs is reached.
  assert.equal((await call('keys', { host: 'evil.example:5174' })).status, 403);
  // Hosted deployments have no key routes at all.
  process.env.APP_ACCESS_TOKEN = 'hosted-test-token';
  try { assert.equal((await call('keys', { local: false, headers: { authorization: 'Bearer hosted-test-token' } })).status, 404); } finally { delete process.env.APP_ACCESS_TOKEN; }
});

test('a tailnet device reads the list read-only, without the last four characters', async () => {
  await reset();
  await keys.saveKey('kie', FAKE_KEY);
  const listed = await call('keys', { host: 'brain.tailnet-test.ts.net:5174', remote: '100.64.1.2' });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.readOnly, true);
  const kie = listed.body.keys.find(k => k.provider === 'kie');
  assert.equal(kie.set, true);
  assert.equal(kie.last4, null);
});

test('empty, oversized and garbled keys are rejected and nothing is saved', async () => {
  await reset();
  for (const key of ['', '   ', undefined, 42, 'a'.repeat(keys.MAX_KEY + 1), 'has a space', 'line\nbreak']) {
    const response = await call('keys/claude', { method: 'PUT', body: { key } });
    assert.equal(response.status, 400, JSON.stringify(key)?.slice(0, 20));
  }
  assert.equal((await call('keys/claude', { method: 'PUT', body: { key: 'a'.repeat(keys.MAX_KEY) } })).status, 200, 'the longest allowed key saves');
  assert.equal((await call('keys/nobody', { method: 'PUT', body: { key: FAKE_KEY } })).status, 404);
});

test('a saved key wins over the environment, and removing it falls back to the environment', async () => {
  await reset();
  const envKey = 'env-test-' + 'y'.repeat(20) + 'ENVK';
  process.env.OPENAI_API_KEY = envKey; process.env.FDC_API_KEY = envKey;
  try {
    assert.equal(providerKey('openai'), envKey);
    assert.equal(keys.keyStatus('openai').source, 'env');
    assert.equal(keys.keyStatus('openai').message, 'From .env, not verified');
    await keys.saveKey('openai', FAKE_KEY); await keys.saveKey('usda', FAKE_KEY);
    assert.equal(providerKey('openai'), FAKE_KEY);
    assert.equal(usdaKey(), FAKE_KEY);
    assert.equal(keys.keyStatus('openai').source, 'store');
    // An env key cannot be removed here, only a saved one.
    await keys.removeKey('openai');
    assert.equal(providerKey('openai'), envKey);
    assert.equal(keys.keyStatus('openai').source, 'env');
    await assert.rejects(keys.removeKey('openai'), /No key/);
  } finally { delete process.env.OPENAI_API_KEY; delete process.env.FDC_API_KEY; }
  assert.equal(usdaKey(), FAKE_KEY);
});

test('verify maps 200 to green, 401 to red and a timeout to yellow, with a timeout signal on the call', async () => {
  await reset();
  await keys.saveKey('claude', FAKE_KEY);
  keys.deps.fetch = answer(200);
  assert.equal((await keys.verifyKey('claude')).status, 'green');
  assert.equal(calls.at(-1).url, 'https://api.anthropic.com/v1/models?limit=1');
  assert.equal(calls.at(-1).options.headers['x-api-key'], FAKE_KEY);
  assert.ok(calls.at(-1).options.signal instanceof AbortSignal);
  keys.deps.fetch = answer(401);
  const red = await keys.verifyKey('claude');
  assert.equal(red.status, 'red');
  assert.match(red.message, /not valid/);
  keys.deps.fetch = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  const slow = await keys.verifyKey('claude');
  assert.equal(slow.status, 'yellow');
  assert.match(slow.message, /8 seconds/);
  keys.deps.fetch = answer(429);
  assert.equal((await keys.verifyKey('claude')).status, 'yellow');
  keys.deps.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND with ' + FAKE_KEY); };
  const offline = await keys.verifyKey('claude');
  assert.equal(offline.status, 'yellow');
  assert.ok(!offline.message.includes(FAKE_KEY), 'a network error message leaked into the status');
});

test('verify reads KIE\'s status from its body, Google\'s 400 as a bad key, and never calls fal', async () => {
  await reset();
  await keys.saveKey('kie', FAKE_KEY); await keys.saveKey('gemini', FAKE_KEY); await keys.saveKey('fal', FAKE_KEY); await keys.saveKey('usda', FAKE_KEY);
  keys.deps.fetch = answer(200, { code: 200, msg: 'success', data: 42 });
  assert.deepEqual([(await keys.verifyKey('kie')).status, (await keys.verifyKey('kie')).message], ['green', 'Key works, 42 credits left']);
  keys.deps.fetch = answer(200, { code: 401, msg: 'unauthorized' });
  assert.equal((await keys.verifyKey('kie')).status, 'red');
  keys.deps.fetch = answer(400, { error: { status: 'INVALID_ARGUMENT' } });
  assert.equal((await keys.verifyKey('gemini')).status, 'red');
  keys.deps.fetch = answer(200);
  await keys.verifyKey('usda');
  assert.ok(!calls.at(-1).url.includes(FAKE_KEY), 'the USDA key went into a URL');
  calls.length = 0;
  const fal = await keys.verifyKey('fal');
  assert.deepEqual([fal.status, calls.length], ['yellow', 0]);
  assert.match(fal.message, /not verified/);
});

test('the brain summary carries only aggregate numbers, read from the files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-summary-'));
  fs.mkdirSync(path.join(dir, 'bench'));
  fs.writeFileSync(path.join(dir, 'log.md'), '## [2026-09-01 10:00:00] reindex | 10 files\n## [2026-09-13 21:20:45] reindex | 12 files\n## [2026-09-20 08:00:00] ingest | note\n');
  fs.writeFileSync(path.join(dir, 'bench', 'results-speed-summary.json'), JSON.stringify({ built: '2026-09-29T12:33:05', questions: 12, secret_question: 'where is my key file', arms: { BRAIN: { n: 12, hit_at_1: 5, hit_at_5: 6, median_tokens_to_read: 754, median_ms: 649.9, top: ['C:/private/path'] }, GREP: { n: 12, hit_at_1: 0, hit_at_5: 3, median_tokens_to_read: 48335, median_ms: 531.1 } } }));
  fs.writeFileSync(path.join(dir, 'bench', 'results-history-summary.json'), JSON.stringify({ studies: [{ study: 'hard suite', kind: 'simulated', arms: { BRAIN: { tokens: 12145, correct: 26, n: 27 } } }] }));
  const summary = await brainSummary(dir);
  assert.deepEqual(summary, {
    index: { lastFullReindex: '2026-09-13 21:20:45', command: 'python idx.py' },
    speed: { built: '2026-09-29T12:33:05', questions: 12, brain: { hitAt1: 5, hitAt5: 6, n: 12, medianTokens: 754, medianMs: 649.9 }, grep: { hitAt1: 0, hitAt5: 3, n: 12, medianTokens: 48335, medianMs: 531.1 } },
    studies: [{ study: 'hard suite', kind: 'simulated', arms: [{ name: 'BRAIN', correct: 26, n: 27, tokens: 12145 }] }],
  });
  const empty = await brainSummary(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-empty-')));
  assert.deepEqual(empty, { index: { lastFullReindex: null, command: 'python idx.py' }, speed: null, studies: [] });
  process.env.APP_ACCESS_TOKEN = 'hosted-test-token';
  try { assert.equal((await call('brain/summary', { local: false, headers: { authorization: 'Bearer hosted-test-token' } })).status, 404); } finally { delete process.env.APP_ACCESS_TOKEN; }
});
