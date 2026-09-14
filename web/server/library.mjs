import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const projectRoot = path.resolve(process.env.SECOND_BRAIN_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const records = new Map();
const extensions = new Set(['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const mimeTypes = { '.md': 'text/markdown', '.txt': 'text/plain', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function isWithin(root, candidate) { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
export async function confinedFile(root, target) {
  const actualRoot = await fs.realpath(root);
  const actual = await fs.realpath(target);
  if (!isWithin(actualRoot, actual)) throw new Error('File is outside its allowed library.');
  const stat = await fs.stat(actual);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('This file exceeds the 20 MB local preview limit.');
  return { actual, stat };
}
export async function listSources() {
  records.clear();
  async function visit(root, directory, kind, depth = 0) {
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (records.size >= 2000) return;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (depth < 5) await visit(root, full, kind, depth + 1); continue; }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const { stat } = await confinedFile(root, full);
        const relative = path.relative(root, full).replaceAll(path.sep, '/');
        const id = createHash('sha256').update(kind + ':' + full).digest('hex').slice(0, 24);
        records.set(id, { id, name: entry.name, kind, path: relative, size: stat.size, updated: stat.mtime.toISOString(), root, full });
      } catch { /* Oversize or inaccessible files are not exposed. */ }
    }
  }
  // Deliberately bounded: documentation, memories and routines; never env files, logs or app source.
  for (const folder of ['OS/memory', 'OS/routines', 'second-brain/memories']) await visit(projectRoot, path.join(projectRoot, folder), 'file');
  let entries; try { entries = await fs.readdir(projectRoot, {withFileTypes: true}); } catch { entries = []; }
  for (const entry of entries) {
    if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
    const full = path.join(projectRoot, entry.name);
    try { const { stat } = await confinedFile(projectRoot, full); const id = createHash('sha256').update('file:' + full).digest('hex').slice(0,24); records.set(id, {id,name:entry.name,kind:'file',path:entry.name,size:stat.size,updated:stat.mtime.toISOString(),root:projectRoot,full}); } catch {}
  }
  return [...records.values()].map(({ root, full, ...record }) => record).sort((a,b) => a.name.localeCompare(b.name));
}
export async function readSource(id) {
  if (!records.size) await listSources();
  const record = records.get(id);
  if (!record) throw new Error('Source not found. Refresh your local library.');
  const { actual, stat } = await confinedFile(record.root, record.full);
  const bytes = await fs.readFile(actual);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('File exceeds the local preview limit.');
  const ext = path.extname(actual).toLowerCase();
  const mime = mimeTypes[ext] || 'application/octet-stream';
  const text = ext === '.md' || ext === '.txt';
  return { id: record.id, name: record.name, kind: record.kind, path: record.path, content: text ? bytes.toString('utf8') : '', ...(text ? {} : { data: 'data:' + mime + ';base64,' + bytes.toString('base64') }), mime, size: stat.size, updated: stat.mtime.toISOString() };
}

