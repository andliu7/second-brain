// server/calendar.mjs without Google: every fetch is a stub, the token file is a temp path,
// and the last test walks the repo tree to prove the refresh token never landed in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-token-'));
process.env.BRAIN_CALENDAR_TOKEN_FILE = path.join(tokenDir, 'google-calendar-token.json');
delete process.env.GOOGLE_OAUTH_CLIENT_ID; delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.APP_ACCESS_TOKEN; delete process.env.PORT;
process.env.BRAIN_ALLOWED_HOSTS = 'brain.tail1234.ts.net';
const { handleApi } = await import('../server/api.mjs');
const { tokenFile, redirectUris } = await import('../server/calendar.mjs');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const REFRESH = 'refresh-token-SECRET-1/abc';
const ACCESS = 'access-token-SECRET-2';
const CALLBACKS = ['http://127.0.0.1:5174/api/calendar/callback', 'http://brain.tail1234.ts.net:5174/api/calendar/callback'];

async function call(method, route, body, { host = '127.0.0.1:5174', headers = {}, local = true } = {}) {
  // readBody in api.mjs takes a parsed body straight off the request when the content type is JSON.
  const req = { url: '/api/' + route, method, headers: { host, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body };
  const result = { headers: {} };
  const res = { writeHead(status, h) { result.status = status; Object.assign(result.headers, h || {}); }, end(value) { result.text = value === undefined ? '' : String(value); try { result.body = JSON.parse(result.text); } catch { /* a redirect or a plain page */ } } };
  await handleApi(req, res, { local });
  return result;
}
const get = (route, options) => call('GET', route, undefined, options);
const post = (route, body, options) => call('POST', route, body, options);
const TODO = { title: 'Review CMSC423 notes', date: '2026-09-25', time: '14:30', minutes: 45 };
// Every call to Google in a test goes through this record; a call nobody expected fails the test.
const calls = [];
function stubFetch(answer) { globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); const data = answer(String(url), init); return { ok: true, status: 200, json: async () => data }; }; }
stubFetch(url => assert.fail('unexpected fetch ' + url));

test('the calendar does not exist on a hosted deployment, even for an authorized caller', async () => {
  process.env.APP_ACCESS_TOKEN = 'hosted-test-token';
  try {
    for (const route of ['calendar/status', 'calendar/connect', 'calendar/events']) assert.equal((await get(route, { local: false, headers: { authorization: 'Bearer hosted-test-token' } })).status, 404);
    assert.equal((await post('calendar/todo', TODO, { local: false, headers: { authorization: 'Bearer hosted-test-token' } })).status, 404);
  } finally { delete process.env.APP_ACCESS_TOKEN; }
});

test('without the OAuth client in the env, status says so in plain words, with both callback URIs, and nothing else runs', async () => {
  const status = await get('calendar/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.connected, false);
  assert.match(status.body.reason, /GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not in .*\.env/);
  for (const uri of CALLBACKS) assert.ok(status.body.reason.includes(uri), uri);
  assert.deepEqual(redirectUris(), CALLBACKS);
  for (const route of ['calendar/connect', 'calendar/events', 'calendar/disconnect']) assert.equal((await get(route)).status, 503);
  assert.equal(calls.length, 0);
});

test('the default token file is under the user profile, outside the repo', () => {
  const saved = process.env.BRAIN_CALENDAR_TOKEN_FILE; delete process.env.BRAIN_CALENDAR_TOKEN_FILE;
  try {
    const file = path.resolve(tokenFile());
    assert.equal(file, path.join(os.homedir(), '.brain', 'google-calendar-token.json'));
    assert.ok(!file.startsWith(path.resolve(repo) + path.sep), file);
  } finally { process.env.BRAIN_CALENDAR_TOKEN_FILE = saved; }
});

let state;
test('connect redirects to Google consent, for events read and write, offline, with a state, and a callback built from the Host header', async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-SECRET-3';
  assert.deepEqual((await get('calendar/status')).body, { connected: false, reason: 'not connected yet' });
  const local = await get('calendar/connect');
  assert.equal(local.status, 302);
  const consent = new URL(local.headers.Location);
  assert.equal(consent.origin + consent.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(consent.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(consent.searchParams.get('access_type'), 'offline');
  assert.equal(consent.searchParams.get('prompt'), 'consent');
  assert.equal(consent.searchParams.get('response_type'), 'code');
  assert.equal(consent.searchParams.get('client_id'), 'client-id.apps.googleusercontent.com');
  assert.equal(consent.searchParams.get('redirect_uri'), CALLBACKS[0]);
  assert.ok(!local.headers.Location.includes('SECRET'));
  state = consent.searchParams.get('state');
  assert.match(state, /^[0-9a-f]{32}$/);
  const tailnet = await get('calendar/connect', { host: 'brain.tail1234.ts.net:5174' });
  const second = new URL(tailnet.headers.Location);
  assert.equal(second.searchParams.get('redirect_uri'), CALLBACKS[1]);
  assert.notEqual(second.searchParams.get('state'), state);
  assert.equal(calls.length, 0);
});

test('the callback rejects a missing, wrong or spent state before touching Google', async () => {
  for (const query of ['', 'code=abc', 'code=abc&state=' + 'f'.repeat(32)]) {
    const result = await get('calendar/callback?' + query);
    assert.equal(result.status, 400);
    assert.equal(result.headers['Content-Type'], 'text/plain; charset=utf-8');
    assert.match(result.text, /not started by this server/);
  }
  assert.equal(calls.length, 0);
  assert.ok(!fs.existsSync(tokenFile()));
});

test('the callback exchanges the code over HTTPS, stores the refresh token outside the repo, then sends the browser to the app', async () => {
  stubFetch((url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      assert.equal(init.method, 'POST');
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'the-code');
      assert.equal(form.get('client_id'), 'client-id.apps.googleusercontent.com');
      assert.equal(form.get('client_secret'), 'client-SECRET-3');
      assert.equal(form.get('redirect_uri'), CALLBACKS[0]);
      return { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, token_type: 'Bearer' };
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary?')) { assert.equal(init.headers.Authorization, 'Bearer ' + ACCESS); return { id: 'zeus@example.com', summary: 'zeus@example.com' }; }
    assert.fail('unexpected fetch ' + url);
  });
  // The browser arrives from accounts.google.com, so this is the one cross-site API request that must pass.
  const result = await get('calendar/callback?code=the-code&state=' + state, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(result.status, 302, result.text);
  assert.equal(result.headers.Location, '/');
  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(!call.url.includes('SECRET'), 'a secret in a URL: ' + call.url);
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenFile(), 'utf8')), { refresh_token: REFRESH, email: 'zeus@example.com' });
  assert.deepEqual((await get('calendar/status')).body, { connected: true, email: 'zeus@example.com' });
  // The state was spent by that callback: replaying it is refused.
  assert.equal((await get('calendar/callback?code=the-code&state=' + state)).status, 400);
  // Every other API request is still origin checked.
  assert.equal((await get('calendar/events', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('events come from the primary calendar with the cached access token, mapped to the contract shape', async () => {
  calls.length = 0;
  const fixture = { items: [
    { id: 'e1', status: 'confirmed', summary: 'CMSC423 lecture', location: 'IRB 0324', htmlLink: 'https://www.google.com/calendar/event?eid=e1', start: { dateTime: '2026-09-25T10:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-09-25T11:15:00-04:00' } },
    { id: 'e2', status: 'confirmed', summary: 'Rosh Hashanah', start: { date: '2026-09-26' }, end: { date: '2026-09-27' } },
    { id: 'e3', status: 'confirmed', start: { dateTime: '2026-09-28T09:00:00Z' }, end: { dateTime: '2026-09-28T09:30:00Z' } },
    { id: 'e4', status: 'cancelled', summary: 'Gone', start: { dateTime: '2026-09-29T09:00:00Z' }, end: { dateTime: '2026-09-29T09:30:00Z' } },
  ] };
  stubFetch((url, init) => { assert.ok(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?'), url); assert.equal(init.headers.Authorization, 'Bearer ' + ACCESS); return fixture; });
  const before = Date.now();
  const result = await get('calendar/events');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { events: [
    { id: 'e1', title: 'CMSC423 lecture', start: '2026-09-25T10:00:00-04:00', end: '2026-09-25T11:15:00-04:00', allDay: false, location: 'IRB 0324', link: 'https://www.google.com/calendar/event?eid=e1' },
    { id: 'e2', title: 'Rosh Hashanah', start: '2026-09-26', end: '2026-09-27', allDay: true, location: '', link: '' },
    { id: 'e3', title: '(no title)', start: '2026-09-28T09:00:00Z', end: '2026-09-28T09:30:00Z', allDay: false, location: '', link: '' },
  ] });
  // One call, to the events endpoint: the access token from the callback is still fresh, so no refresh.
  assert.equal(calls.length, 1);
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get('singleEvents'), 'true');
  assert.equal(query.get('orderBy'), 'startTime');
  const span = (Date.parse(query.get('timeMax')) - Date.parse(query.get('timeMin'))) / 86400000;
  assert.equal(span, 14);
  assert.ok(Date.parse(query.get('timeMin')) >= before - 1000);
  for (const days of ['500', '-3', 'abc']) {
    calls.length = 0;
    await get('calendar/events?days=' + days);
    const q = new URL(calls[0].url).searchParams;
    assert.equal((Date.parse(q.get('timeMax')) - Date.parse(q.get('timeMin'))) / 86400000, days === '500' ? 60 : days === '-3' ? 1 : 14, 'days=' + days);
  }
});

test('a todo becomes one event on the primary calendar, in the zone of this machine by name, tagged as its own', async () => {
  calls.length = 0;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.ok(zone, 'the machine has an IANA zone name');
  const sent = [];
  stubFetch((url, init) => {
    assert.equal(url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer ' + ACCESS);
    assert.equal(init.headers['Content-Type'], 'application/json');
    sent.push(JSON.parse(init.body));
    return { id: 'todo-' + sent.length, htmlLink: 'https://www.google.com/calendar/event?eid=todo' + sent.length, status: 'confirmed' };
  });
  const result = await post('calendar/todo', TODO);
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(result.body, { ok: true, eventId: 'todo-1', link: 'https://www.google.com/calendar/event?eid=todo1' });
  assert.deepEqual(sent[0], { summary: 'Review CMSC423 notes', start: { dateTime: '2026-09-25T14:30:00', timeZone: zone }, end: { dateTime: '2026-09-25T15:15:00', timeZone: zone }, extendedProperties: { private: { brainTodo: 'true' } } });
  // minutes defaults to 30, the title is trimmed, and an end past midnight rolls to the next day.
  assert.equal((await post('calendar/todo', { title: '  Sleep  ', date: '2026-12-31', time: '23:50' })).status, 200);
  assert.equal(sent[1].summary, 'Sleep');
  assert.deepEqual(sent[1].start, { dateTime: '2026-12-31T23:50:00', timeZone: zone });
  assert.deepEqual(sent[1].end, { dateTime: '2027-01-01T00:20:00', timeZone: zone });
  assert.equal(calls.length, 2);
});

test('a bad todo body is refused in plain words before Google is called', async () => {
  calls.length = 0;
  stubFetch(url => assert.fail('unexpected fetch ' + url));
  const bad = [
    [{}, /title/], [{ ...TODO, title: '' }, /title/], [{ ...TODO, title: '   ' }, /title/], [{ ...TODO, title: 42 }, /title/],
    [{ ...TODO, date: undefined }, /date/], [{ ...TODO, date: '2026/09/25' }, /date/], [{ ...TODO, date: '2026-02-30' }, /date/], [{ ...TODO, date: '2026-13-01' }, /date/], [{ ...TODO, date: '26-09-25' }, /date/],
    [{ ...TODO, time: undefined }, /time/], [{ ...TODO, time: '9:00' }, /time/], [{ ...TODO, time: '24:00' }, /time/], [{ ...TODO, time: '14:60' }, /time/], [{ ...TODO, time: '2:30 pm' }, /time/],
    [{ ...TODO, minutes: 4 }, /minutes/], [{ ...TODO, minutes: 481 }, /minutes/], [{ ...TODO, minutes: 30.5 }, /minutes/], [{ ...TODO, minutes: '30' }, /minutes/], [{ ...TODO, minutes: null }, /minutes/],
  ];
  for (const [body, message] of bad) {
    const result = await post('calendar/todo', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.match(result.body.error, message, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('nothing in the repo tree contains the refresh token or the client secret', () => {
  const skip = new Set(['node_modules', '.git', 'dist']);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => skip.has(entry.name) ? [] : entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const files = walk(repo);
  assert.ok(files.length > 100, 'walked ' + files.length + ' files');
  // The test file itself spells the fixtures, so it is the one file allowed to name them.
  const self = fileURLToPath(import.meta.url);
  for (const file of files) {
    if (file === self) continue;
    let text; try { text = fs.readFileSync(file, 'latin1'); } catch { continue; }
    assert.ok(!text.includes(REFRESH) && !text.includes('SECRET-2') && !text.includes('SECRET-3'), 'a secret leaked into ' + file);
  }
});

test('disconnect deletes the token file and status returns to not connected', async () => {
  assert.deepEqual((await get('calendar/disconnect')).body, { connected: false });
  assert.ok(!fs.existsSync(tokenFile()));
  assert.deepEqual((await get('calendar/status')).body, { connected: false, reason: 'not connected yet' });
  stubFetch(url => assert.fail('unexpected fetch ' + url));
  const events = await get('calendar/events');
  assert.equal(events.status, 400);
  assert.equal(events.body.error, 'not connected yet');
  calls.length = 0;
  const todo = await post('calendar/todo', TODO);
  assert.equal(todo.status, 400);
  assert.equal(todo.body.error, 'not connected yet');
  assert.equal(calls.length, 0);
});
