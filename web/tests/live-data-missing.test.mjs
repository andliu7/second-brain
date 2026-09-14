import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// A root with no second-brain folder in it, set before the server loads, so the brain
// reads as not installed. Its own file because the root is fixed when library.mjs loads.
process.env.SECOND_BRAIN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'no-brain-'));
const { handleApi } = await import('../server/api.mjs');

test('brain search says not installed, rather than failing, when there is no index', async () => {
  const req = Readable.from([]);
  Object.assign(req, { url: '/api/brain?q=front%20door', method: 'GET', headers: { host: '127.0.0.1:5174' } });
  const result = {};
  const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(value); } };
  await handleApi(req, res, { local: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'not_installed');
  assert.match(result.body.message, /install\.py/);
});
