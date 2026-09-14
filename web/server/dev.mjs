import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
if (process.env.GENERATE_ENV_FILE) dotenv.config({path:process.env.GENERATE_ENV_FILE,override:false,quiet:true});
const {handleApi,validateOrigin} = await import('./api.mjs');
const production = process.argv.includes('--production');
const vite = production ? null : await (await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
const server = http.createServer(async(req,res)=>{
  if (!validateOrigin(req,true)) { res.writeHead(403); return res.end('Forbidden origin'); }
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
server.listen(port,'127.0.0.1',()=>process.stdout.write('Second Brain: http://127.0.0.1:'+port+'\nProgress: http://127.0.0.1:'+port+'/progress.html\n'));
server.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;vite?.close();});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();vite?.close();process.exit(0);});
