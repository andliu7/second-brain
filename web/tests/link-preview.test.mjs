// server/link-preview.mjs against a fixture server on 127.0.0.1, never the internet. The fixture is
// loopback, which the route refuses, so the module is called with allowLocal for the fetch cases and
// without it for the refusal case; the route itself is exercised through handleApi at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { linkPreview, isPrivateAddress, MAX_BYTES } from '../server/link-preview.mjs';

delete process.env.APP_ACCESS_TOKEN;
const { handleApi } = await import('../server/api.mjs');

const page = '<html><head><title>Fallback title</title><meta property="og:title" content="A &amp; B Kettle"><meta content="/img/kettle.jpg" property="og:image"><meta property="og:site_name" content="Kettle Shop"></head><body>hi</body></html>';
const plain = '<html><head><title>  Just a\n title </title></head><body></body></html>';
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  res.on('error', () => {});
  if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  if (req.url === '/plain') return res.writeHead(200, { 'content-type': 'text/html' }).end(plain);
  if (req.url === '/redirect') return res.writeHead(302, { location: '/page' }).end();
  if (req.url === '/hop1') return res.writeHead(301, { location: '/hop2' }).end();
  if (req.url === '/hop2') return res.writeHead(301, { location: '/hop3' }).end();
  if (req.url === '/hop3') return res.writeHead(301, { location: '/page' }).end();
  if (req.url === '/late') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html><head>' + ' '.repeat(MAX_BYTES + 1024)); return res.end('<title>Too late</title></head></html>'); }
  if (req.url === '/early') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html><head><title>Early</title>'); res.write(' '.repeat(MAX_BYTES * 4)); return res.end('</head></html>'); }
  res.writeHead(404, { 'content-type': 'text/html' }).end('<title>Missing</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const local = url => linkPreview(url, { allowLocal: true });
test.after(() => server.close());

test('a normal page: og tags win, entities decode, the image resolves against the page', async () => {
  assert.deepEqual(await local(base + '/page'), { title: 'A & B Kettle', image: base + '/img/kettle.jpg', site: 'Kettle Shop' });
});

test('a redirect is followed, and more than two are not', async () => {
  assert.deepEqual(await local(base + '/redirect'), { title: 'A & B Kettle', image: base + '/img/kettle.jpg', site: 'Kettle Shop' });
  assert.deepEqual(await local(base + '/hop1'), { error: 'That link redirects too many times.' });
  assert.ok(!hits.includes('/page') || hits.filter(h => h === '/page').length === 2, 'the third hop is never requested');
});

test('a page with no og tags falls back to <title> and the hostname', async () => {
  assert.deepEqual(await local(base + '/plain'), { title: 'Just a title', image: '', site: '127.0.0.1' });
  assert.deepEqual(await local(base + '/missing'), { error: 'The page answered HTTP 404.' });
});

test('only the first 256 KB are read', async () => {
  assert.deepEqual(await local(base + '/late'), { title: '', image: '', site: '127.0.0.1' });
  const started = Date.now();
  assert.deepEqual(await local(base + '/early'), { title: 'Early', image: '', site: '127.0.0.1' });
  assert.ok(Date.now() - started < 5000);
});

test('private, loopback and non-http addresses are refused without a fetch', async () => {
  const before = hits.length;
  for (const url of [base + '/page', 'http://localhost/x', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://0.0.0.0/']) {
    assert.deepEqual(await linkPreview(url), { error: 'Private and local addresses cannot be previewed.' }, url);
  }
  assert.deepEqual(await linkPreview('ftp://example.com/'), { error: 'Only http and https links can be previewed.' });
  assert.deepEqual(await linkPreview('file:///etc/passwd'), { error: 'Only http and https links can be previewed.' });
  assert.deepEqual(await linkPreview('not a url'), { error: 'That is not a valid link.' });
  assert.deepEqual(await linkPreview(''), { error: 'That is not a valid link.' });
  assert.equal(hits.length, before);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('100.64.0.1'), true);
});

test('the route is local only and never allows loopback', async () => {
  async function get(route, opts = {}) {
    const result = {};
    const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(value); } };
    await handleApi({ url: '/api/' + route, method: 'GET', headers: { host: '127.0.0.1:5174' } }, res, { local: true, ...opts });
    return result;
  }
  const hosted = await get('link-preview?url=' + encodeURIComponent(base + '/page'), { local: false });
  assert.equal(hosted.status, 503);
  const refused = await get('link-preview?url=' + encodeURIComponent(base + '/page'));
  assert.equal(refused.status, 200);
  assert.deepEqual(refused.body, { error: 'Private and local addresses cannot be previewed.' });
  assert.deepEqual((await get('link-preview')).body, { error: 'That is not a valid link.' });
});
