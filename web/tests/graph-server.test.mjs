// server/graph.mjs against a small tree written to a temp folder: what is excluded, how
// departments, layers and skills are recognised, which links become edges, and the two read
// bounds (8 KB for a summary, 64 KB for a viewer chunk) as the read log records them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildGraph, cacheFileFor, nodeDetail, textChunk, fileInfo, openOnDevice, openPlan, previewImage, thumbsDir, log, SUMMARY_BYTES, CHUNK_BYTES, excludedFile, kindOf } from '../server/graph.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-fixture-'));
const projects = path.join(base, 'Projects'); const skills = path.join(base, 'skills');
const write = (rel, text) => { const file = path.join(base, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
write('Projects/CLAUDE.md', '# Home\n\n| Area | Folders | Index |\n|---|---|---|\n| Chem | `alpha/`, `gamma/` | [A](ALPHA.md) |\n| The OS | `second-brain/` | x |\n');
write('Projects/alpha/README.md', '# Alpha project\n\nThe first paragraph describes alpha.\n\nSee [the doc](docs/b.md) and the Mobbin captures in `docs/reference/mobbin/`. Run /generate for images. Also [[note]] and [[missing-note]].\n');
write('Projects/alpha/docs/b.md', '# B\n\nBack to [README](../README.md).\n');
write('Projects/alpha/docs/reference/mobbin/pic.png', Buffer.from('89504e470d0a1a0a', 'hex'));
write('Projects/alpha/big.txt', Array.from({ length: 3000 }, (_, i) => `line ${i} ${'x'.repeat(60)}`).join('\n') + '\n');
write('Projects/alpha/.env', 'SECRET=1');
write('Projects/alpha/tool.js', 'console.log(1)\n');
write('Projects/alpha/run.bat', '@echo off\n');
// The smallest PDF PyMuPDF opens: one empty 200x100 page, no xref table (it repairs that).
write('Projects/alpha/doc.pdf', '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n');
write('Projects/beta/note.md', '# A note\n');
write('Projects/beta/node_modules/pkg/index.js', 'module.exports = 1');
write('Projects/dashboard/reference/clone/inside.md', '# never walked\n');
write('Projects/Capital One - statement.pdf', '%PDF');
write('Projects/full_ledger_2026.pdf', '%PDF');
write('Projects/second-brain/OS/routines/weekly.md', '# Routine\n\nRuns /generate weekly.\n');
write('Projects/second-brain/OS/memory/decisions.md', '# Decisions\n');
write('skills/generate/SKILL.md', '---\nname: generate\ndescription: Generate images through model APIs.\n---\n\n# /generate\n\n' + 'Body line.\n'.repeat(1200) + '\n## The last heading\n\nThe end.\n');
write('skills/plain/notes.md', '# not a skill\n');
// Descriptions as YAML block scalars, folded (>) and kept (|), the way the brain and humanizer skills write theirs.
write('skills/folded/SKILL.md', '---\nname: folded\ndescription: >\n  Answer a question about the files\n  by querying the index.\n---\n\n# /folded\n\nBody.\n');
write('skills/kept/SKILL.md', '---\nname: kept\ndescription: |\n  Remove signs of AI writing.\n  Based on a guide.\nlicense: MIT\n---\n\n# /kept\n\nBody.\n');

const graph = await buildGraph([projects, skills]);
const named = name => graph.nodes.find(n => n.name === name);
const index = name => graph.nodes.findIndex(n => n.name === name);
const edgesFrom = name => graph.edges.filter(e => e[0] === index(name)).map(e => [graph.nodes[e[1]].name, e[2]]);

test('excluded names and folders never become nodes, and dashboard/reference is one node with nothing inside', () => {
  for (const name of ['.env', 'Capital One - statement.pdf', 'full_ledger_2026.pdf', 'node_modules', 'pkg', 'index.js', 'inside.md', 'clone']) assert.equal(named(name), undefined, name + ' must not be in the map');
  assert.ok(named('reference') && named('reference').kind === 'folder');
  assert.ok(excludedFile('Capital One - anything.pdf') && excludedFile('full_ledger_x.pdf') && excludedFile('.env.local') && !excludedFile('ledger.md'));
  assert.equal(graph.roots[0].count, 11); assert.equal(graph.roots[1].count, 4);
});

test('departments come from the CLAUDE.md table, the skills root is the Skills department, skills are folders holding SKILL.md', () => {
  const depts = graph.nodes.filter(n => n.kind === 'dept').map(n => n.name);
  for (const name of ['Chem', 'The OS', 'Unfiled', 'Skills']) assert.ok(depts.includes(name), name);
  assert.equal(graph.nodes[named('alpha').parent].name, 'Chem');
  assert.equal(graph.nodes[named('beta').parent].name, 'Unfiled');
  assert.equal(named('generate').kind, 'skill'); assert.equal(named('generate').layer, 'skill');
  assert.equal(named('plain').kind, 'folder');
  assert.equal(named('weekly.md').layer, 'routine'); assert.equal(named('decisions.md').layer, 'memory');
  for (const app of graph.nodes.filter(n => n.kind === 'app')) { assert.equal(app.layer, 'app'); assert.ok(app.where && app.group); assert.deepEqual(Object.keys(app).sort(), ['group', 'id', 'kind', 'layer', 'mtime', 'name', 'parent', 'root', 'size', 'where']); }
  assert.ok(graph.nodes.every(n => !('path' in n)), 'absolute paths stay on the server');
});

test('edges come only from links, mentions and skill references read from the files', () => {
  const out = edgesFrom('README.md');
  assert.ok(out.some(([name, type]) => name === 'b.md' && type === 'link'), 'markdown link');
  assert.ok(out.some(([name, type]) => name === 'mobbin' && type === 'mention'), 'folder mention');
  assert.ok(out.some(([name, type]) => name === 'generate' && type === 'skill'), '/skill mention');
  assert.ok(out.some(([name, type]) => name === 'note.md' && type === 'wiki'), 'wikilink by name');
  assert.ok(!out.some(([name]) => name === 'missing-note'), 'a wikilink to nothing is not an edge');
  assert.ok(edgesFrom('b.md').some(([name, type]) => name === 'README.md' && type === 'link'), 'relative link upward');
  assert.ok(edgesFrom('weekly.md').some(([name, type]) => name === 'generate' && type === 'skill'), 'routine to skill');
  assert.ok(graph.edges.every(([a, b]) => a !== b), 'no self edges');
});

test('a node detail reads at most 8 KB, ends on a whole line, and says where the viewer continues', async () => {
  log.reads.length = 0;
  const detail = await nodeDetail(named('big.txt').id);
  assert.equal(log.reads.length, 1); assert.ok(log.reads[0].bytes <= SUMMARY_BYTES, 'read ' + log.reads[0].bytes);
  assert.ok(Buffer.byteLength(detail.excerpt) <= SUMMARY_BYTES); assert.ok(detail.excerpt.endsWith('\n')); assert.ok(detail.next > 0 && detail.next <= SUMMARY_BYTES);
  assert.equal(detail.kind, 'text'); assert.ok(detail.path.endsWith('alpha/big.txt')); assert.equal(detail.root, projects.replaceAll('\\', '/'));
  const readme = await nodeDetail(named('README.md').id);
  assert.equal(readme.summary.title, 'Alpha project'); assert.equal(readme.summary.description, 'The first paragraph describes alpha.');
  assert.equal(readme.next, null, 'a small file is read whole');
  assert.deepEqual(readme.linksOut.map(l => l.name).sort(), ['b.md', 'generate', 'mobbin', 'note.md']);
  assert.deepEqual(readme.linksIn.map(l => l.name), ['b.md']);
  const skill = await nodeDetail(named('generate').id);
  assert.equal(skill.summary.title, 'generate'); assert.equal(skill.summary.description, 'Generate images through model APIs.'); assert.ok(skill.file.endsWith('generate/SKILL.md')); assert.ok(skill.next > 0);
  // A block scalar description is its text, never the bare > or | marker.
  assert.equal((await nodeDetail(named('folded').id)).summary.description, 'Answer a question about the files by querying the index.');
  assert.equal((await nodeDetail(named('kept').id)).summary.description, 'Remove signs of AI writing.\nBased on a guide.');
});

test('the viewer pages through a large text file in chunks of at most 64 KB and never reads it whole', async () => {
  log.reads.length = 0;
  const id = named('big.txt').id; const size = fs.statSync(path.join(projects, 'alpha', 'big.txt')).size;
  let offset = (await nodeDetail(id)).next; let pieces = 0; let total = (await nodeDetail(id)).excerpt.length;
  while (offset !== null) { const chunk = await textChunk(id, offset); assert.ok(chunk.text.length > 0); assert.equal(chunk.offset, offset); assert.ok(chunk.next === null || chunk.text.endsWith('\n')); total += Buffer.byteLength(chunk.text); offset = chunk.next; pieces++; }
  assert.ok(pieces >= 3, 'the file needs several chunks'); assert.equal(total, size, 'the pieces make the whole file');
  for (const read of log.reads) assert.ok(read.bytes <= CHUNK_BYTES, `${read.route} read ${read.bytes}`);
  await assert.rejects(textChunk(named('pic.png').id, 0), /Only text files/);
});

test('files stream only for images and PDFs, Open refuses what is not on the map, and nothing opens on its own', async () => {
  const info = await fileInfo(named('pic.png').id); assert.equal(info.mime, 'image/png'); assert.ok(info.path.endsWith('pic.png'));
  await assert.rejects(fileInfo(named('big.txt').id), /Only images and PDFs/);
  await assert.rejects(openOnDevice('not-a-node'), /not in the map/);
  await assert.rejects(openOnDevice(named('Chem').id), /not a file on disk/);
  assert.equal(log.opens.length, 0);
  assert.equal(kindOf('x.MD'), 'note'); assert.equal(kindOf('x.tsv'), 'text'); assert.equal(kindOf('x.ipynb'), 'code'); assert.equal(kindOf('x.bin'), 'file');
});

test('Open hands a document to its default app but only ever reveals a script or an executable, so nothing on the map can be run from here', () => {
  const win = process.platform === 'win32';
  const picture = openPlan(path.join(projects, 'alpha', 'docs', 'reference', 'mobbin', 'pic.png'));
  assert.equal(picture.reveal, false); assert.equal(picture.runnable, false); if (win) { assert.equal(picture.command, 'explorer.exe'); assert.ok(!picture.args[0].startsWith('/select,')); }
  for (const name of ['tool.js', 'run.bat', 'setup.exe', 'go.cmd', 'x.vbs', 'a.ps1', 'b.py', 'c.sh', 'd.mjs', 'e.msi', 'f.lnk']) {
    const plan = openPlan(path.join(projects, 'alpha', name));
    assert.equal(plan.reveal, true, name + ' must be revealed, never run'); assert.equal(plan.runnable, true);
    if (win) assert.ok(plan.args[0].startsWith('/select,') && plan.args[0].endsWith(name), name + ': ' + plan.args.join(' '));
  }
  const asked = openPlan(path.join(projects, 'alpha', 'README.md'), true);
  assert.equal(asked.reveal, true); assert.equal(asked.runnable, false, 'a plain reveal is not a script fallback');
  assert.equal(log.opens.length, 0, 'planning opens nothing');
});

test('a PDF previews as its first page rendered to a PNG in the gitignored thumbs folder, and text files have no rendered preview', async () => {
  const out = await previewImage(named('doc.pdf').id);
  assert.ok(out.startsWith(thumbsDir), out);
  const head = fs.readFileSync(out).subarray(0, 8);
  assert.equal(head.toString('hex'), '89504e470d0a1a0a', 'a PNG');
  assert.equal(await previewImage(named('doc.pdf').id), out, 'cached by mtime');
  fs.rmSync(out, { force: true });
  await assert.rejects(previewImage(named('big.txt').id), /Only HTML files and PDFs/);
});

test('a rebuild after one note changes re-reads that note only, and the map keeps every other edge', async () => {
  // The first build read every note. Editing one file is the common case (Andrew saves a note,
  // another agent writes a file), so the next cold open must not read the whole tree again.
  write('Projects/beta/note.md', '# A note\n\nNow links to [alpha](../alpha/README.md).\n');
  const real = fsp.readFile; const read = [];
  fsp.readFile = (file, ...rest) => { if (String(file).startsWith(base)) read.push(path.relative(base, String(file)).replaceAll('\\', '/')); return real.call(fsp, file, ...rest); };
  let rebuilt; try { rebuilt = await buildGraph([projects, skills]); } finally { fsp.readFile = real; }
  assert.deepEqual(read, ['Projects/beta/note.md']);
  const from = name => rebuilt.edges.filter(e => e[0] === rebuilt.nodes.findIndex(n => n.name === name)).map(e => [rebuilt.nodes[e[1]].name, e[2]]);
  assert.ok(from('note.md').some(([name, type]) => name === 'README.md' && type === 'link'), 'the new link is an edge');
  assert.ok(from('README.md').some(([name, type]) => name === 'mobbin' && type === 'mention'), 'an unchanged file keeps its edges');
  assert.ok(from('weekly.md').some(([name, type]) => name === 'generate' && type === 'skill'), 'an unchanged routine keeps its skill edge');
  const named2 = (g, e) => `${g.nodes[e[0]].name} > ${g.nodes[e[1]].name} (${e[2]})`; const now = new Set(rebuilt.edges.map(e => named2(rebuilt, e)));
  for (const e of graph.edges) assert.ok(now.has(named2(graph, e)), 'kept: ' + named2(graph, e));
  // A file added elsewhere (an agent writing a screenshot or a plan) moves every node index, and
  // still re-reads nothing but itself: the old notes' links resolve again against the new tree.
  write('Projects/alpha/docs/a.md', '# A\n\nSee [b](b.md).\n'); read.length = 0;
  fsp.readFile = (file, ...rest) => { if (String(file).startsWith(base)) read.push(path.relative(base, String(file)).replaceAll('\\', '/')); return real.call(fsp, file, ...rest); };
  let grown; try { grown = await buildGraph([projects, skills]); } finally { fsp.readFile = real; }
  assert.deepEqual(read, ['Projects/alpha/docs/a.md']);
  const from2 = name => grown.edges.filter(e => e[0] === grown.nodes.findIndex(n => n.name === name)).map(e => [grown.nodes[e[1]].name, e[2]]);
  assert.ok(from2('a.md').some(([name, type]) => name === 'b.md' && type === 'link'), 'the new file links');
  assert.ok(from2('note.md').some(([name, type]) => name === 'README.md' && type === 'link'), 'an older link still resolves after the indexes moved');
  assert.ok(from2('README.md').some(([name, type]) => name === 'mobbin' && type === 'mention') && from2('weekly.md').some(([name, type]) => name === 'generate' && type === 'skill'));
});

// The fixture's own link cache goes with it (it is keyed by roots, so Andrew's is untouched).
test.after(() => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(cacheFileFor([projects, skills]), { force: true }); });
