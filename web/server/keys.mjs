// API keys entered in Settings, kept encrypted on this computer and never sent back to the browser.
//
//   GET    /api/keys                  every provider's status: { set, last4, source, status, checkedAt, message }
//   PUT    /api/keys/:provider        { key }  save it, then verify it
//   DELETE /api/keys/:provider        forget the saved key (a key in .env stays; it is removed there)
//   POST   /api/keys/:provider/verify one cheap, free call to the provider with the key
//
// Why a store of its own rather than writing .env: .env is plain text next to the repository, which is public, and
// one wrong `git add` away from being pushed. The store lives at ~/.brain/keys.dpapi, under the user profile and
// outside every repository, and its bytes are encrypted.
//
// Encryption. On Windows the whole key map is one DPAPI blob, current-user scope: Windows derives the key from this
// user's login secret, so the file is unreadable to other accounts and on another machine, and there is no key file
// for anyone to find. Node has no DPAPI binding, so a child PowerShell calls ProtectedData, and the data goes through
// its stdin, never its command line, which other processes can read. Elsewhere it is AES-256-GCM with a random key
// in keys.aes.key beside the store, mode 600: that only stops casual reading, since anything running as this user
// can read both files (the README says so).
//
// Honest limits, both schemes: any program running as this user can decrypt the store, the same as it could read
// .env; the keys sit decrypted in this server's memory while it runs, because every provider call needs them.
//
// Precedence: the store first, then the environment (.env and GENERATE_ENV_FILE), so the keys he already has keep
// working and a key saved here overrides one there. providers.mjs and health.mjs read keys only through storedKey.
//
// Only the PC itself may change a key, the rule God's Eye View's POWER UP panel follows: a write must come from a
// loopback socket, name a loopback Host, carry no proxy header (Tailscale serve adds X-Forwarded-For and
// Tailscale-User-*) and send a same-origin Origin. The Host alone is not enough, because a tailnet device can send
// any Host it likes. A phone on the tailnet may read the list, read-only and without the last four characters.
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The order Settings lists them in. env is every variable that already meant this provider's key.
export const PROVIDERS = [
  { id: 'claude', env: ['ANTHROPIC_API_KEY'] },
  { id: 'openai', env: ['OPENAI_API_KEY'] },
  { id: 'gemini', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  { id: 'fal', env: ['FAL_KEY'] },
  { id: 'kie', env: ['KIE_API_KEY'] },
  { id: 'usda', env: ['FDC_API_KEY'] },
];
const byId = new Map(PROVIDERS.map(p => [p.id, p]));
export const MAX_KEY = 512;

export const storeFile = () => path.join(os.homedir(), '.brain', 'keys.dpapi');
const aesKeyFile = () => path.join(os.homedir(), '.brain', 'keys.aes.key');

// ---- the two ciphers: protect(bytes) and unprotect(bytes), both async ----

// Fixed extra entropy, so this blob only opens for this app's Unprotect call and not for any other DPAPI
// caller of the same user that happens to be handed the file.
const ENTROPY = "[Text.Encoding]::UTF8.GetBytes('second-brain-keys-v1')";
const psScript = verb => "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
  + '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); '
  + `$out=[System.Security.Cryptography.ProtectedData]::${verb}($data, ${ENTROPY}, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); `
  + '[Console]::Out.Write([Convert]::ToBase64String($out))';
// The script is a constant and the only argument; the secret travels base64 through stdin and back through stdout.
function powershell(verb, bytes) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript(verb)], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    // stderr can hold a .NET message but never the data, which only ever went in through stdin.
    child.on('close', code => code === 0 && out.trim() ? resolve(Buffer.from(out.trim(), 'base64')) : reject(new Error('DPAPI ' + verb + ' failed (exit ' + code + '): ' + err.trim().slice(0, 200))));
    child.stdin.end(bytes.toString('base64'));
  });
}
export const dpapi = { scheme: 'dpapi', protect: bytes => powershell('Protect', bytes), unprotect: bytes => powershell('Unprotect', bytes) };

async function aesKey() {
  try { return await fs.readFile(aesKeyFile()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(aesKeyFile()), { recursive: true });
  const key = randomBytes(32);
  await fs.writeFile(aesKeyFile(), key, { mode: 0o600, flag: 'wx' });
  return key;
}
// Stored as iv (12 bytes), tag (16), ciphertext: GCM's tag makes a tampered or truncated file fail to open.
export const aesGcm = {
  scheme: 'aes-256-gcm',
  async protect(bytes) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await aesKey(), iv); const body = Buffer.concat([cipher.update(bytes), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
  async unprotect(bytes) { const decipher = createDecipheriv('aes-256-gcm', await aesKey(), bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]); },
};

// Looked up on every use, so a test can swap in a fake cipher or a recorded provider answer.
export const deps = { cipher: process.platform === 'win32' ? dpapi : aesGcm, fetch: (...args) => fetch(...args) };

// ---- the store ----

// provider -> { key, savedAt }, the decrypted store. Status is not secret and not saved: it resets to "not
// verified" when the server restarts, and one click on Verify refreshes it.
let saved = new Map();
const status = new Map();
// Set when a store exists but would not open. Saving then would replace it with a store holding one key and
// silently lose the rest, so every write refuses until it is sorted out (the lesson POWER UP's readStore teaches).
let unreadable = false;
// Saves and removes run one at a time, so two quick clicks cannot interleave a read and a write.
let queue = Promise.resolve();
const serial = work => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };

export async function loadKeys() {
  try {
    let text;
    try { text = await fs.readFile(storeFile(), 'utf8'); } catch (error) { if (error.code === 'ENOENT') { saved = new Map(); unreadable = false; return; } throw error; }
    const file = JSON.parse(text);
    if (file.scheme !== deps.cipher.scheme) throw new Error('store scheme ' + file.scheme + ' does not match ' + deps.cipher.scheme);
    const map = JSON.parse((await deps.cipher.unprotect(Buffer.from(file.data, 'base64'))).toString('utf8'));
    saved = new Map(Object.entries(map).filter(([id, entry]) => byId.has(id) && typeof entry?.key === 'string'));
    unreadable = false;
  } catch (error) {
    saved = new Map(); unreadable = true;
    // Logged, never thrown: the server still starts, on .env keys. The reason names the scheme, the exit code or a
    // file error, never a key: the decrypted text is not in any message here.
    process.stderr.write('Key store could not be opened, so saved keys are off and saving is refused: ' + String(error?.message || error).slice(0, 200) + '\n');
  }
}

async function writeStore(map) {
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (!map.size) { await fs.rm(file, { force: true }); return; }
  const data = await deps.cipher.protect(Buffer.from(JSON.stringify(Object.fromEntries(map)), 'utf8'));
  // A fresh temp file renamed over the store: a crash mid-write leaves the old store whole, never half a file.
  const temp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, scheme: deps.cipher.scheme, data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

// What providerKey() and health.mjs read. Synchronous on purpose: the store is already decrypted in memory.
export const storedKey = provider => saved.get(provider)?.key;
export function effectiveKey(provider) {
  const fromStore = storedKey(provider);
  if (fromStore) return { key: fromStore, source: 'store' };
  const name = byId.get(provider)?.env.find(n => process.env[n]);
  return name ? { key: process.env[name], source: 'env' } : { key: undefined, source: null };
}

class HttpError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, code) => { throw new HttpError(message, code); };
const known = provider => byId.has(provider) ? provider : fail('Unknown provider.', 404);

export function checkKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) fail('Paste a key first.');
  if (key.length > MAX_KEY) fail(`That is longer than any provider key (${MAX_KEY} characters at most).`);
  if (!/^[\x21-\x7e]+$/.test(key)) fail('A key has no spaces, line breaks or accented letters. Copy it again from the provider page.');
  return key;
}

export function saveKey(provider, value) {
  known(provider);
  const key = checkKey(value);
  return serial(async () => {
    if (unreadable) fail('The saved key store could not be opened, so nothing was changed. The server log says why.', 500);
    const next = new Map(saved); next.set(provider, { key, savedAt: new Date().toISOString() });
    await writeStore(next);
    // Read back from disk rather than trusting the map just written: a store that does not round trip is a
    // store that will be empty after the next restart, and this is when to find out.
    await loadKeys();
    if (storedKey(provider) !== key) fail('The key was written but did not read back, so it will not survive a restart.', 500);
    status.delete(provider);
  });
}

export function removeKey(provider) {
  known(provider);
  return serial(async () => {
    if (unreadable) fail('The saved key store could not be opened, so nothing was changed. The server log says why.', 500);
    if (!saved.has(provider)) fail('No key for this provider is saved here.', 404);
    const next = new Map(saved); next.delete(provider);
    await writeStore(next);
    await loadKeys();
    status.delete(provider);
  });
}

// The one shape that leaves the server. last4 only for a key long enough that four characters give nothing away.
export function keyStatus(provider, { showLast4 = true } = {}) {
  const { key, source } = effectiveKey(provider);
  if (!key) return { provider, set: false, last4: null, source: null, status: 'none', checkedAt: null, message: 'Not set' };
  const checked = status.get(provider);
  return { provider, set: true, last4: showLast4 && key.length >= 12 ? key.slice(-4) : null, source, status: checked?.status ?? 'yellow', checkedAt: checked?.checkedAt ?? null, message: checked?.message ?? (source === 'env' ? 'From .env, not verified' : 'Saved, not verified') };
}

// ---- verification: one free call per provider, never one that spends tokens or credit ----

// Each is a list or a balance read. Anthropic's models list proves the key, not the balance; the chat's own
// errors already say when credit runs out. USDA takes the key as a header so it never sits in a URL.
const CHECKS = {
  claude: key => ['https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }],
  openai: key => ['https://api.openai.com/v1/models', { Authorization: 'Bearer ' + key }],
  gemini: key => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': key }],
  kie: key => ['https://api.kie.ai/api/v1/chat/credit', { Authorization: 'Bearer ' + key }],
  usda: key => ['https://api.nal.usda.gov/fdc/v1/foods/search?query=apple&pageSize=1', { 'X-Api-Key': key }],
  // fal's only authenticated read (/v1/account/billing) wants an admin key, so an ordinary key would be marked
  // red while working. No check is better than a wrong one.
  fal: null,
};

// HTTP answer -> dot. KIE answers 200 with the real status in the body's code, so that is read first.
export function judge(provider, httpStatus, data) {
  const code = provider === 'kie' && typeof data?.code === 'number' ? data.code : httpStatus;
  if (code >= 200 && code < 300) return { status: 'green', message: provider === 'kie' && typeof data?.data === 'number' ? `Key works, ${data.data} credits left` : 'Key works' };
  // Google answers a bad key with 400 API_KEY_INVALID rather than 401.
  if (code === 401 || code === 403 || (provider === 'gemini' && code === 400)) return { status: 'red', message: `Rejected: the provider says this key is not valid (HTTP ${code})` };
  if (code === 429) return { status: 'yellow', message: 'Rate limited; verify again later' };
  return { status: 'yellow', message: `Could not check: the provider answered HTTP ${code}` };
}

export async function verifyKey(provider) {
  known(provider);
  const { key } = effectiveKey(provider);
  if (!key) fail('There is no key to verify.', 404);
  let result;
  if (!CHECKS[provider]) result = { status: 'yellow', message: 'Saved, not verified: fal has no free check' };
  else {
    const [url, headers] = CHECKS[provider](key);
    try {
      const response = await deps.fetch(url, { headers, signal: AbortSignal.timeout(8000), redirect: 'error' });
      let data = null; try { data = await response.json(); } catch { /* only KIE's body matters */ }
      result = judge(provider, response.status, data);
    } catch (error) {
      // Never error.message: a network error can carry the request, and the request carries the key.
      result = { status: 'yellow', message: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'No answer within 8 seconds; verify again later' : 'Could not reach the provider' };
    }
  }
  // A key changed while this check was out gets no stale verdict.
  if (effectiveKey(provider).key === key) status.set(provider, { ...result, checkedAt: new Date().toISOString() });
  return keyStatus(provider);
}

// ---- the gate ----

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_SOCKETS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name', 'cf-connecting-ip'];
const hostName = host => { const h = String(host || '').toLowerCase(); return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]; };

// True only for a request typed on this PC: loopback socket, loopback Host, no proxy on the way.
export function fromThisPc(req) {
  const headers = req.headers || {};
  if (PROXY_HEADERS.some(name => String(headers[name] || '').trim())) return false;
  return LOOPBACK_SOCKETS.has(String(req.socket?.remoteAddress || '')) && LOOPBACK_HOSTS.has(hostName(headers.host));
}

function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }

// api.mjs has already run validateOrigin and the Host allow-list; this adds the this-PC rule for anything that
// changes a key or sends it anywhere (verify sends it to the provider). body is the parsed JSON for a PUT.
export async function handleKeys(route, req, res, readBody) {
  try {
    const local = fromThisPc(req);
    if (route === 'keys' && req.method === 'GET') return send(res, 200, { readOnly: !local, keys: PROVIDERS.map(p => keyStatus(p.id, { showLast4: local })) });
    const [, provider, action, extra] = route.split('/');
    if (!provider || extra || (action && action !== 'verify')) fail('API route not found.', 404);
    if (!local) fail('Keys can only be changed on the PC itself.', 403);
    // A browser sends Origin on every PUT, DELETE and POST fetch; one without it is a script, not the page.
    if (!req.headers.origin) fail('Keys can only be changed from the Settings page.', 403);
    if (action === 'verify' && req.method === 'POST') return send(res, 200, { key: await verifyKey(provider) });
    if (!action && req.method === 'PUT') {
      const body = await readBody(req);
      await saveKey(provider, body?.key);
      return send(res, 200, { key: await verifyKey(provider) });
    }
    if (!action && req.method === 'DELETE') { await removeKey(provider); return send(res, 200, { key: keyStatus(provider) }); }
    fail('API route not found.', 404);
  } catch (error) {
    // Messages here are all written above; none is built from a key or a provider's reply.
    return send(res, error instanceof HttpError ? error.status : 400, { error: error instanceof HttpError ? error.message : 'The key request could not be completed.' });
  }
}
