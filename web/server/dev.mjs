import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
if (process.env.GENERATE_ENV_FILE) dotenv.config({path:process.env.GENERATE_ENV_FILE,override:false,quiet:true});
const {handleApi,validateOrigin,allowedHost} = await import('./api.mjs');
const production = process.argv.includes('--production');
// Vite runs its own DNS-rebinding host check, so a name we allow above still has to be
// allowed here or the page 403s while the API answers. Same env var, one source of truth.
const extraHosts = (process.env.BRAIN_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
const vite = production ? null : await (await import('vite')).createServer({root,server:{middlewareMode:true,allowedHosts:extraHosts},appType:'spa'});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
const server = http.createServer(async(req,res)=>{
  // The API keeps the full origin check, since an API request can act. Pages only need the
  // Host check (it stops DNS rebinding): a cross-site check here blocked every link into
  // the app from another page, HOME.html included, and protected nothing.
  const pageHostOk = allowedHost(req.headers.host);
  const allowed = (req.url||'').startsWith('/api/') ? validateOrigin(req,true) : pageHostOk;
  if (!allowed) { res.writeHead(403); return res.end('Forbidden origin'); }
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
  if ((req.url||'').startsWith('/api/')) return handleApi(req,res,{local:true});
  if (vite) return vite.middlewares(req,res);
  const url = new URL(req.url,'http://127.0.0.1');
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/,''); }
  catch { res.writeHead(400); return res.end('Invalid URL encoding'); }
  const directory=path.resolve(root,'dist');
  let file=path.resolve(directory,relative || 'index.html');
  if (!file.startsWith(directory + path.sep)) {res.writeHead(403);return res.end('Forbidden');}
  try { if (!(await fs.stat(file)).isFile()) file=path.join(directory,'index.html'); } catch {file=path.join(directory,'index.html');}
  try {const bytes=await fs.readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(500);res.end('Run npm run build first.');}
});
const port=Number(process.env.PORT||5174);
// Default stays 127.0.0.1: this machine only, which is what every existing command expects.
// HOST=<a Tailscale IP> binds the tailnet interface INSTEAD, so the phone and iPad can reach
// it by name from anywhere while devices on the local Wi-Fi still cannot. Never bind 0.0.0.0
// here: this API runs skills and opens files, and it has no login.
const host=process.env.HOST||'127.0.0.1';
const shown=process.env.BRAIN_PUBLIC_NAME||host;
server.listen(port,host,()=>process.stdout.write('Second Brain: http://'+shown+':'+port+'\nProgress: http://'+shown+':'+port+'/progress.html\n'));
server.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;vite?.close();});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();vite?.close();process.exit(0);});
