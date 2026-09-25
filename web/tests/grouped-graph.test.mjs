// The grouped graph the home page draws (server/graph.mjs groupGraph): images, code, text, PDFs
// and other files fold into one node per (folder, kind) that lists its members; notes, skills,
// layered files and applications stay individual; a folder with nothing individual beneath it
// collapses into its parent's groups. Checked on a fixture graph shaped like /api/graph, then on
// the real roots of this computer: under 1,500 nodes, and every member accounted for once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, groupGraph } from '../server/graph.mjs';

const node = (id, name, kind, parent, extra = {}) => ({ id, name, kind, layer: extra.layer || '', parent, root: extra.root ?? 0, size: extra.size || 0, mtime: extra.mtime || 0 });
const fixture = {
  roots: [{ path: 'C:/Users/andrew/Downloads/Projects', count: 11 }, { path: 'C:/Users/andrew/.claude/skills', count: 2 }],
  nodes: [
    node('dept1', 'Chemistry apps', 'dept', -1, { layer: 'dept' }),       // 0
    node('alpha', 'blueberry_game', 'folder', 0),                         // 1
    node('readme', 'README.md', 'note', 1, { size: 300 }),                // 2
    node('docs', 'docs', 'folder', 1),                                    // 3  nothing individual beneath: collapses
    node('ref', 'reference', 'folder', 3),                                // 4  collapses
    node('a', 'a.png', 'image', 4, { size: 10, mtime: 5 }),               // 5
    node('b', 'b.png', 'image', 4, { size: 20, mtime: 9 }),               // 6
    node('shots', 'shots', 'folder', 4),                                  // 7  collapses
    node('c', 'c.png', 'image', 7, { size: 30 }),                         // 8
    node('vite', 'vite.config.js', 'code', 1),                            // 9
    node('main', 'main.ts', 'code', 1),                                   // 10
    node('tsv', 'index.tsv', 'text', 1, { layer: 'memory' }),             // 11 layered: individual
    node('src', 'src', 'folder', 1),                                      // 12 kept: notes.md lives here
    node('app', 'app.tsx', 'code', 12),                                   // 13
    node('notes', 'notes.md', 'note', 12),                                // 14
    node('dept2', 'Skills', 'dept', -1, { layer: 'dept', root: 1 }),     // 15
    node('gen', 'generate', 'skill', 15, { layer: 'skill', root: 1 }),    // 16
    node('skillmd', 'SKILL.md', 'note', 16, { root: 1 }),                 // 17
    node('run', 'run.py', 'code', 16, { root: 1 }),                       // 18
  ],
  edges: [[2, 4, 'mention'], [2, 16, 'skill'], [17, 5, 'link'], [14, 13, 'link'], [5, 6, 'link'], [2, 3, 'link']],
};

const kinds = ['image', 'code', 'file', 'text', 'pdf'];
// Every group holds only files of its kind, each folded file sits in exactly one group, and the
// members of a kind add up to that kind's ungrouped files.
function checkMembers(full, grouped) {
  const ids = new Map(full.nodes.map(n => [n.id, n])); const seen = new Set();
  for (const group of grouped.nodes.filter(n => n.members)) {
    assert.ok(kinds.includes(group.kind), group.name); assert.ok(group.members.length >= 1, group.name);
    for (const id of group.members) { const member = ids.get(id); assert.ok(member, 'member exists: ' + id); assert.equal(member.kind, group.kind, group.name); assert.equal(member.layer, '', 'a layered file is never folded: ' + member.name); assert.ok(!seen.has(id), 'folded once: ' + id); seen.add(id); }
  }
  for (const kind of kinds) {
    const folded = grouped.nodes.filter(n => n.members && n.kind === kind).reduce((sum, n) => sum + n.members.length, 0);
    const original = full.nodes.filter(n => n.kind === kind && !n.layer).length;
    assert.equal(folded, original, `${kind}: ${folded} members in groups, ${original} in the full graph`);
  }
  const individual = n => !n.members && !['folder', 'dept'].includes(n.kind);
  assert.deepEqual(grouped.nodes.filter(individual).map(n => n.id).sort(), full.nodes.filter(n => !kinds.includes(n.kind) || n.layer).filter(n => !['folder', 'dept'].includes(n.kind)).map(n => n.id).sort(), 'notes, skills, layered files and applications stay individual');
  grouped.nodes.forEach((n, i) => { assert.ok(n.parent < i, 'parents come before children: ' + n.name); if (n.parent >= 0) assert.ok(['folder', 'skill', 'dept'].includes(grouped.nodes[n.parent].kind), 'a parent is a container: ' + n.name); });
  for (const [a, b] of grouped.edges) { assert.ok(a !== b, 'no self edge'); assert.ok(a >= 0 && b >= 0 && a < grouped.nodes.length && b < grouped.nodes.length); }
  assert.equal(new Set(grouped.edges.map(([a, b]) => a + '>' + b)).size, grouped.edges.length, 'one edge per pair');
}

test('folds files by folder and kind, names the group by the folder its members share, and keeps the rest individual', () => {
  const grouped = groupGraph(fixture);
  const named = name => grouped.nodes.find(n => n.name === name);
  checkMembers(fixture, grouped);
  const images = named('blueberry_game/docs/reference · 3 images');
  assert.ok(images, grouped.nodes.map(n => n.name).join(' | ')); assert.deepEqual(images.members, ['a', 'b', 'c']); assert.equal(images.kind, 'image'); assert.equal(images.size, 60); assert.equal(images.mtime, 9);
  assert.equal(grouped.nodes[images.parent].name, 'blueberry_game', 'the group hangs from the nearest kept folder');
  assert.deepEqual(named('blueberry_game · 2 code files').members, ['vite', 'main']);
  assert.deepEqual(named('blueberry_game/src · 1 code file').members, ['app']);
  assert.deepEqual(named('generate · 1 code file').members, ['run']);
  for (const gone of ['docs', 'reference', 'shots', 'a.png', 'vite.config.js', 'run.py']) assert.equal(named(gone), undefined, gone + ' is folded away');
  for (const kept of ['README.md', 'index.tsv', 'src', 'notes.md', 'generate', 'SKILL.md', 'Chemistry apps', 'Skills']) assert.ok(named(kept), kept + ' stays');
  assert.equal(grouped.nodes.length, 13);
  // Edges land on the group a file or a collapsed folder became, once per pair.
  const at = name => grouped.nodes.findIndex(n => n.name === name);
  const edge = (a, b) => grouped.edges.find(e => e[0] === at(a) && e[1] === at(b));
  assert.equal(edge('README.md', 'blueberry_game/docs/reference · 3 images')?.[2], 'mention', 'a mention of a collapsed folder reaches its images');
  assert.equal(edge('README.md', 'generate')?.[2], 'skill');
  assert.equal(edge('SKILL.md', 'blueberry_game/docs/reference · 3 images')?.[2], 'link');
  assert.equal(edge('notes.md', 'blueberry_game/src · 1 code file')?.[2], 'link');
  assert.equal(grouped.edges.length, 4, 'a link between two images of one group is gone, and docs and reference are one target');
});

test('the real roots fold to fewer than 1,500 nodes with every grouped file accounted for once', async () => {
  const full = await buildGraph(); const grouped = groupGraph(full);
  console.log(`grouped graph: ${grouped.nodes.length} nodes and ${grouped.edges.length} edges from ${full.nodes.length} nodes and ${full.edges.length} edges`);
  assert.ok(grouped.nodes.length < 1500, `${grouped.nodes.length} nodes`);
  assert.ok(grouped.nodes.length > 0);
  checkMembers(full, grouped);
});
