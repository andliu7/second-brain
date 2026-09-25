import { timingSafeEqual } from 'node:crypto';
import { chat, generate, generationStatus, providerKey, defaultModels } from './providers.mjs';
const limits = new Map();
export function tokenMatches(actual, expected) { if (typeof actual !== 'string' || typeof expected !== 'string') return false; const a=Buffer.from(actual); const b=Buffer.from(expected); return a.length === b.length && timingSafeEqual(a,b); }
function send(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); }
// Hosts allowed to reach the acting API. localhost always; anything else only when
// BRAIN_ALLOWED_HOSTS names it, so the default stays exactly as closed as before. Used for
// a private Tailscale name, which is why a bare hostname is accepted and a public one is not.
export function allowedHost(host) {
  if (!host) return false;
  const name = String(host).split(':')[0].toLowerCase();
  if (name === 'localhost' || name === '127.0.0.1') return true;
  return (process.env.BRAIN_ALLOWED_HOSTS || '').toLowerCase().split(',')
    .map(h => h.trim()).filter(Boolean).includes(name);
}
export function validateOrigin(req, local) {
  const host = req.headers.host;
  if (!host || (local && !allowedHost(host))) return false;
  // Google sends the browser back to the calendar callback after consent, a cross-site navigation
  // by design; the state check in calendar.mjs is what guards that one route.
  if (req.headers['sec-fetch-site'] === 'cross-site' && String(req.url || '').split('?')[0] !== '/api/calendar/callback') return false;
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
    // Skill runs shell out to claude on this machine, so they exist only locally, never on a hosted deploy.
    if (route === 'tasks' && req.method === 'GET') { if (!local) return send(res,404,{error:'Skill runs are available only when running the app on your computer.'}); const {listTasks} = await import('./runner.mjs'); return send(res,200,{tasks:listTasks()}); }
    // Skills, projects and brain search read this computer's disk fresh on every request, so they are local only too.
    if (['skills','projects','brain'].includes(route) && req.method === 'GET') { if (!local) return send(res,404,{error:'Live data from this computer is available only when running the app on your computer.'}); const live = await import('./live.mjs'); return send(res,200,route === 'skills' ? {skills:await live.listSkills()} : route === 'projects' ? await live.listProjects() : await live.searchBrain(url.searchParams.get('q') || '')); }
    // The Network map is built from this computer's disk and streams files from it, so every graph route is local only.
    if (route.startsWith('graph') && req.method === 'GET') {
      if (!local) return send(res,404,{error:'The Network map is available only when running the app on your computer.'});
      const graph = await import('./graph.mjs'); const id = url.searchParams.get('id') || '';
      if (route === 'graph') return send(res,200,await graph.buildGraph());
      if (route === 'graph/grouped') return send(res,200,await graph.groupedGraph(url.searchParams.get('signature') || ''));
      if (route === 'graph/node') return send(res,200,await graph.nodeDetail(id));
      if (route === 'graph/text') return send(res,200,await graph.textChunk(id, Number(url.searchParams.get('offset') || 0)));
      if (route === 'graph/reads') return send(res,200,graph.log);
      if (route === 'graph/file' || route === 'graph/preview') {
        const file = route === 'graph/file' ? await graph.fileInfo(id) : { path: await graph.previewImage(id), mime: 'image/png' };
        res.writeHead(200, {'Content-Type':file.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
        const { createReadStream } = await import('node:fs'); createReadStream(file.path).on('error', () => res.end()).pipe(res); return;
      }
      return send(res,404,{error:'API route not found.'});
    }
    // Google Calendar uses secrets from this computer's env file and a token under its user profile, so it is local only too.
    if (route.startsWith('calendar') && req.method === 'GET') { if (!local) return send(res,404,{error:'Google Calendar is available only when running the app on your computer.'}); const {handleCalendar} = await import('./calendar.mjs'); return await handleCalendar(route, url, req, res); }
    if (route === 'link-preview' && req.method === 'GET') { if (!local) return send(res,404,{error:'Link previews are available only when running the app on your computer.'}); const {linkPreview} = await import('./link-preview.mjs'); return send(res,200,await linkPreview(url.searchParams.get('url') || '')); }
    if (req.method !== 'POST') return send(res,404,{error:'API route not found.'});
    const body = await readBody(req);
    // Open on device runs explorer.exe on this computer, only ever after a click in the panel.
    if (route === 'graph/open') { if (!local) return send(res,404,{error:'Open on device works only when running the app on your computer.'}); const {openOnDevice} = await import('./graph.mjs'); return send(res,200,await openOnDevice(String(body?.id || ''), Boolean(body?.reveal))); }
    if (route === 'source') { if (!local) return send(res,404,{error:'Local file access is disabled on hosted deployments.'}); const {readSource} = await import('./library.mjs'); return send(res,200,await readSource(body?.id)); }
    if (route === 'calendar/todo') { if (!local) return send(res,404,{error:'Google Calendar is available only when running the app on your computer.'}); const {handleCalendar} = await import('./calendar.mjs'); return await handleCalendar(route, url, req, res, body); }
    if (route === 'run') { if (!local) return send(res,404,{error:'Skill runs are available only when running the app on your computer.'}); const {startRun} = await import('./runner.mjs'); startRun(String(body?.id || '')); return send(res,202,{ok:true}); }
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
