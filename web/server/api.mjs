import { timingSafeEqual } from 'node:crypto';
import { chat, generate, generationStatus, providerKey, defaultModels } from './providers.mjs';
const limits = new Map();
export function tokenMatches(actual, expected) { if (typeof actual !== 'string' || typeof expected !== 'string') return false; const a=Buffer.from(actual); const b=Buffer.from(expected); return a.length === b.length && timingSafeEqual(a,b); }
function send(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); }
export function validateOrigin(req, local) {
  const host = req.headers.host;
  if (!host || (local && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin) { try { if (new URL(req.headers.origin).host !== host) return false; } catch { return false; } }
  return true;
}
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('Use a JSON request.');
  if (req.body !== undefined) { const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; if (Buffer.byteLength(JSON.stringify(body)) > 600000) throw new Error('Request exceeds 600 KB.'); return body; }
  let text = ''; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 600000) throw new Error('Request exceeds 600 KB.'); text += chunk.toString(); }
  return JSON.parse(text || '{}');
}
export async function handleApi(req,res,{local=false}={}) {
  if (!validateOrigin(req,local)) return send(res,403,{error:'This request did not come from the workspace origin.'});
  const url = new URL(req.url, 'http://' + req.headers.host);
  const route = url.pathname.replace(/^\/api\/?/, '');
  if (route === 'status' && req.method === 'GET') return send(res,200,{local,providers:Object.fromEntries(['claude','openai','gemini','fal','kie'].map(p => [p,Boolean(providerKey(p))])),authRequired:!local || Boolean(process.env.APP_ACCESS_TOKEN),models:defaultModels});
  const required = !local || Boolean(process.env.APP_ACCESS_TOKEN);
  if (required && !process.env.APP_ACCESS_TOKEN) return send(res,503,{error:'Set APP_ACCESS_TOKEN in your hosted environment before enabling the API.'});
  if (required && !tokenMatches(req.headers.authorization, 'Bearer ' + process.env.APP_ACCESS_TOKEN)) return send(res,401,{error:'Unlock the API in Settings with your workspace access token.'});
  try {
    if (route === 'sources' && req.method === 'GET') { if (!local) return send(res,404,{error:'Local libraries are available only when running the app on your computer.'}); const {listSources} = await import('./library.mjs'); return send(res,200,{sources:await listSources()}); }
    if (req.method !== 'POST') return send(res,404,{error:'API route not found.'});
    const body = await readBody(req);
    if (route === 'source') { if (!local) return send(res,404,{error:'Local file access is disabled on hosted deployments.'}); const {readSource} = await import('./library.mjs'); return send(res,200,await readSource(body?.id)); }
    if (!['chat','generate','generation-status'].includes(route)) return send(res,404,{error:'API route not found.'});
    if (route !== 'generation-status') {
      const key = route; const record = limits.get(key); const time = Date.now();
      if (record && time-record.start<60000 && record.count>=12) return send(res,429,{error:'Please wait a minute before starting another request.'});
      limits.set(key, record && time-record.start<60000 ? {start:record.start,count:record.count+1} : {start:time,count:1});
    }
    const result = route === 'chat' ? await chat(body) : route === 'generate' ? await generate(body) : await generationStatus(body);
    if (!local && Buffer.byteLength(JSON.stringify(result)) > 4000000) return send(res,413,{error:'The generated image is larger than this hosted API can return. Download the completed image from your provider dashboard. Your prompt and job ticket remain in the workspace; do not pay for a second run.'});
    return send(res,200,result);
  } catch (error) { const message = error?.name === 'TimeoutError' ? 'The provider timed out. Check its dashboard before retrying a paid generation.' : error instanceof SyntaxError ? 'Invalid JSON request or provider response.' : String(error?.message || 'Request failed.'); return send(res,400,{error:message}); }
}
