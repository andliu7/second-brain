// Google Calendar for the app's Today view: it reads events and adds a todo as one. Node built-ins only.
//
// This repo is public, so nothing secret lives in its tree. The OAuth client id and secret
// come from the env file the server loads (GENERATE_ENV_FILE) and the refresh token is written
// under the user profile at ~/.brain/google-calendar-token.json. No token is ever logged or put
// in a URL; the access token lives in memory only, until it expires.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read and write of events. Changing this scope means the user consents again: a refresh token only
// carries the scope it was granted with, so disconnect and connect after editing it.
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const states = new Map(); // state -> expiry; one per consent redirect, spent by the callback that carries it
let access = null;        // {token, expires}: the cached access token

// The env override exists for the tests, so a simulated callback never touches the real file.
export const tokenFile = () => process.env.BRAIN_CALENDAR_TOKEN_FILE || path.join(os.homedir(), '.brain', 'google-calendar-token.json');
const client = () => ({ id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET });
// The callback is built from the Host header, which allowedHost has already validated, so one
// client serves the app both at 127.0.0.1 and at its Tailscale name.
export const redirectUri = host => 'http://' + host + '/api/calendar/callback';
export const redirectUris = () => ['127.0.0.1', ...(process.env.BRAIN_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)].map(h => redirectUri(h + ':' + (process.env.PORT || 5174)));

function missingReason() {
  if (client().id && client().secret) return null;
  const envFile = process.env.GENERATE_ENV_FILE || fileURLToPath(new URL('../.env', import.meta.url));
  return 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not in ' + envFile + '; create an OAuth client at console.cloud.google.com, type Web application, and register both redirect URIs ' + redirectUris().join(' and ') + ', then restart the server';
}
function readToken() { try { return JSON.parse(fs.readFileSync(tokenFile(), 'utf8')); } catch { return null; } }
function writeToken(value) { const file = tokenFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); }

async function google(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), redirect: 'error' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const detail = data.error_description || data.error?.message || (typeof data.error === 'string' ? data.error : ''); throw new Error('Google answered HTTP ' + res.status + (detail ? ': ' + detail : '')); }
  return data;
}
const tokenRequest = params => google(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client().id, client_secret: client().secret, ...params }).toString() });
const cacheAccess = data => { access = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 }; };

async function accessToken() {
  if (access && access.expires > Date.now() + 60000) return access.token;
  const stored = readToken();
  if (!stored?.refresh_token) throw new Error('not connected yet');
  cacheAccess(await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token }));
  return access.token;
}
const calendar = async (route, params = {}) => google(API + route + '?' + new URLSearchParams(params), { headers: { Authorization: 'Bearer ' + await accessToken() } });

export function mapEvents(items) {
  return (items || []).filter(e => e.status !== 'cancelled').map(e => ({ id: e.id, title: e.summary || '(no title)', start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '', allDay: Boolean(e.start?.date), location: e.location || '', link: e.htmlLink || '' }));
}
async function listEvents(days) {
  const now = new Date();
  const data = await calendar('/calendars/primary/events', { timeMin: now.toISOString(), timeMax: new Date(now.getTime() + days * 86400000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  return { events: mapEvents(data.items) };
}
// The todo body, checked strictly: either {error} in plain words or the fields the event is built from.
function parseTodo(body) {
  const { title, date, time, minutes = 30 } = body || {};
  if (typeof title !== 'string' || !title.trim()) return { error: 'a todo needs a title' };
  const day = Date.parse(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== date) return { error: 'date must be a real day as YYYY-MM-DD' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'time must be HH:MM, 24 hour' };
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { error: 'minutes must be a whole number from 5 to 480' };
  return { title: title.trim(), date, time, minutes };
}
// One event on the primary calendar, in this machine's zone by name so Google handles the offset and
// daylight saving. The end is wall clock arithmetic, done in UTC so no offset is ever computed here.
async function createTodo({ title, date, time, minutes }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  const end = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutes * 60000).toISOString().slice(0, 19);
  const event = { summary: title, start: { dateTime: date + 'T' + time + ':00', timeZone }, end: { dateTime: end, timeZone }, extendedProperties: { private: { brainTodo: 'true' } } };
  const data = await google(API + '/calendars/primary/events', { method: 'POST', headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  return { ok: true, eventId: data.id, link: data.htmlLink || '' };
}

function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }
function page(res, status, text) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); }

// body is the parsed JSON of a POST; the GET routes never receive one.
export async function handleCalendar(route, url, req, res, body) {
  const reason = missingReason();
  if (route === 'calendar/status') {
    const stored = reason ? null : readToken();
    return json(res, 200, stored?.refresh_token ? { connected: true, ...(stored.email ? { email: stored.email } : {}) } : { connected: false, reason: reason || 'not connected yet' });
  }
  if (reason) return json(res, 503, { error: reason });
  const host = req.headers.host;
  if (route === 'calendar/connect') {
    for (const [s, t] of states) if (t < Date.now()) states.delete(s);
    const state = randomBytes(16).toString('hex'); states.set(state, Date.now() + 600000);
    return redirect(res, CONSENT_URL + '?' + new URLSearchParams({ client_id: client().id, redirect_uri: redirectUri(host), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state }));
  }
  if (route === 'calendar/callback') {
    const state = url.searchParams.get('state'); const expiry = states.get(state); states.delete(state);
    if (!expiry || expiry < Date.now()) return page(res, 400, 'Google Calendar: this sign-in was not started by this server, or it took longer than ten minutes. Go back to the app and connect again.');
    if (url.searchParams.get('error')) return page(res, 400, 'Google Calendar: Google reported ' + url.searchParams.get('error') + '. Go back to the app and connect again.');
    try {
      const data = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirectUri(host) });
      if (!data.refresh_token) throw new Error('Google did not return a refresh token. Remove this app at myaccount.google.com/permissions, then connect again.');
      cacheAccess(data);
      // The primary calendar's id is the account email; it is the only identity this scope can read.
      let email; try { email = (await calendar('/calendars/primary')).id; } catch { /* the connection still works without it */ }
      writeToken({ refresh_token: data.refresh_token, ...(email ? { email } : {}) });
      return redirect(res, '/');
    } catch (error) { return page(res, 400, 'Google Calendar: ' + error.message); }
  }
  if (route === 'calendar/events') { const days = Math.min(60, Math.max(1, Math.floor(Number(url.searchParams.get('days'))) || 14)); return json(res, 200, await listEvents(days)); }
  if (route === 'calendar/todo') { const todo = parseTodo(body); return todo.error ? json(res, 400, { error: todo.error }) : json(res, 200, await createTodo(todo)); }
  if (route === 'calendar/disconnect') { fs.rmSync(tokenFile(), { force: true }); access = null; return json(res, 200, { connected: false }); }
  return json(res, 404, { error: 'API route not found.' });
}
