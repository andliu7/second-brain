// Network: every file under the configured roots as a map, built from disk on request.
//
// Local only, and the repo learns nothing: the roots come from second-brain/graph-roots.json
// (gitignored, falls back to ~/Downloads/Projects and ~/.claude/skills), the built graph and
// hover thumbnails are cached under second-brain/.cache/graph/ (gitignored), and nothing
// here writes anywhere git tracks. tests/graph-privacy.test.mjs holds that line.
//
// Reads are bounded: the panel summary reads at most 8 KB of a text file, the viewer pages
// through text in 64 KB chunks, binaries are streamed only for images and PDFs, and every
// read is logged in `log` so a check can prove the bounds held.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { projectRoot } from './library.mjs';

const brainDir = path.join(projectRoot, 'second-brain');
export const rootsFile = path.join(brainDir, 'graph-roots.json');
export const cacheDir = path.join(brainDir, '.cache', 'graph');
export const thumbsDir = path.join(cacheDir, 'thumbs');
// Every path this module writes. The privacy guard test checks each one is gitignored.
export const writtenPaths = () => [rootsFile, cacheDir, thumbsDir];

export const SUMMARY_BYTES = 8 * 1024;
export const CHUNK_BYTES = 64 * 1024;
const FILE_LIMIT = 50 * 1024 * 1024;
const LINK_SCAN_LIMIT = 512 * 1024;
const BARE_MENTION_LIMIT = 25;

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', '.cache']);
// dashboard/reference holds cloned repos: one node for the folder, never its contents.
const NO_DESCENT = ['dashboard/reference'];
// Never read, never shown: env files and the financial exports at the root of Projects.
export const excludedFile = name => /^\.env/i.test(name) || /^Capital One - .*\.pdf$/i.test(name) || /^full_ledger_.*\.pdf$/i.test(name);

const KINDS = [
  ['note', /\.(md|markdown)$/i], ['image', /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i], ['pdf', /\.pdf$/i], ['html', /\.html?$/i],
  ['code', /\.(py|js|mjs|cjs|ts|tsx|jsx|css|scss|json|jsonc|ya?ml|toml|sh|ps1|cmd|bat|java|c|cpp|h|hpp|rs|go|sql|ipynb|xml|svelte|vue|env\.example)$/i],
  ['text', /\.(txt|tsv|csv|log|ini|cfg|conf|lock|gitignore|npmrc|editorconfig)$/i],
];
export const kindOf = name => (KINDS.find(([, re]) => re.test(name)) || ['file'])[0];
export const isTextKind = kind => ['note', 'code', 'text', 'html'].includes(kind);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.pdf': 'application/pdf' };

// The read log: what a check reads to prove the 8 KB and 64 KB bounds, and that Open only ever
// followed a request. Kept short and in memory only.
export const log = { reads: [], opens: [] };
const record = (list, entry) => { list.push({ ...entry, at: new Date().toISOString() }); if (list.length > 500) list.shift(); };

const slash = p => p.replaceAll('\\', '/');
const short = p => createHash('sha1').update(slash(p).toLowerCase()).digest('hex').slice(0, 12);

export function readRoots() {
  const defaults = [path.join(os.homedir(), 'Downloads', 'Projects'), path.join(os.homedir(), '.claude', 'skills')];
  try {
    const parsed = JSON.parse(fs.readFileSync(rootsFile, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.roots;
    if (Array.isArray(list) && list.length) return list.map(p => path.resolve(String(p)));
  } catch { /* no config, or unreadable: the two defaults */ }
  return defaults;
}

// Departments are the areas of <root>/CLAUDE.md's "Where things live" table: the first cell is
// the area, the backticked folders in the second cell say which top-level folders belong to it.
// A root without that table is one department named after the root.
function readDepartments(root) {
  const byFolder = new Map(); const names = [];
  let text = ''; try { text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { return { names, byFolder }; }
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^\|\s*Area\s*\|\s*Folders\s*\|/i.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith('|')) { inTable = false; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2 || /^-+$/.test(cells[0])) continue;
    const index = names.push(cells[0]) - 1;
    for (const m of cells[1].matchAll(/`([^`]+)`/g)) byFolder.set(m[1].replace(/\/$/, '').split('/')[0].toLowerCase(), index);
  }
  return { names, byFolder };
}

function walk(root, rootIndex, nodes, options) {
  const rootDepts = readDepartments(root);
  const isSkillsRoot = path.basename(root).toLowerCase() === 'skills';
  const deptFor = new Map(); // department name -> node index, created on first use
  const department = name => {
    if (!deptFor.has(name)) deptFor.set(name, nodes.push({ id: short('dept:' + rootIndex + ':' + name), name, kind: 'dept', layer: 'dept', parent: -1, root: rootIndex, size: 0, mtime: 0 }) - 1);
    return deptFor.get(name);
  };
  if (isSkillsRoot) department('Skills'); else for (const name of rootDepts.names) department(name);
  const deptOf = entryName => isSkillsRoot ? department('Skills') : rootDepts.byFolder.has(entryName.toLowerCase()) ? department(rootDepts.names[rootDepts.byFolder.get(entryName.toLowerCase())]) : department(rootDepts.names.length ? 'Unfiled' : path.basename(root));
  let count = 0;
  // Synchronous on purpose: 12,000 stats through the async thread pool took anywhere from 2.5 s
  // to 18 s on this machine while other work ran (measured 2026-09-17), and the same walk done
  // synchronously stayed at 2 to 3.7 s. One cold open builds the map once, so the pause is
  // worth the predictable load time.
  function visit(dir, parent, rel) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name); const childRel = rel ? rel + '/' + entry.name : entry.name;
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const skill = isSkillsRoot && !rel && fs.existsSync(path.join(full, 'SKILL.md'));
        const index = nodes.push({ id: short(full), name: entry.name, kind: skill ? 'skill' : 'folder', layer: skill ? 'skill' : '', parent: rel ? parent : deptOf(entry.name), root: rootIndex, size: 0, mtime: Math.round(stat.mtimeMs), path: full }) - 1;
        if (!NO_DESCENT.includes(childRel.toLowerCase())) visit(full, index, childRel);
        continue;
      }
      if (!stat.isFile() || excludedFile(entry.name)) continue;
      const kind = kindOf(entry.name); count++;
      nodes.push({ id: short(full), name: entry.name, kind, layer: layerOf(childRel), parent: rel ? parent : deptOf(entry.name), root: rootIndex, size: stat.size, mtime: Math.round(stat.mtimeMs), path: full });
    }
  }
  visit(root, -1, '');
  options.counts.push(count);
}

// The ARMS layers a file can belong to by where it lives. Skills and applications are set elsewhere.
// Two more for the home page's key: a router is a CLAUDE.md or one of the all-caps area indexes at
// the root of Projects (CHEMISTRY.md, SCHOOL.md), a plan is a PLAN.md or STATUS.md wherever it sits.
function layerOf(rel) {
  if (/(^|\/)OS\/routines\/[^/]+$/.test(rel)) return 'routine';
  if (/(^|\/)OS\/memory\/[^/]+$/.test(rel) || /(^|\/)OS\/MEMORY\.md$/.test(rel) || /second-brain\/memories\/[^/]+$/.test(rel) || /second-brain\/index\.tsv$/.test(rel)) return 'memory';
  if (/(^|\/)CLAUDE\.md$/.test(rel) || /^[A-Z]+\.md$/.test(rel)) return 'router';
  if (/(^|\/)[\w-]*(PLAN|STATUS)\.md$/.test(rel)) return 'plan';
  return '';
}

// Applications: what Claude Code on this machine is connected to, read from its config files.
// MCP servers and the claude.ai connectors from ~/.claude.json, CLI tools found on PATH. Only
// the names and where they are configured are kept: never a command line, env or token.
const CLI_TOOLS = ['git', 'node', 'python', 'claude', 'gh', 'supabase', 'docker'];
const ALIASES = { 'Google Drive': ['google drive'], 'Google Calendar': ['google calendar'], 'Atlassian Rovo': ['atlassian', 'jira', 'confluence'], 'Claude Docs': ['claude docs'], 'Claude in Chrome': ['claude-in-chrome', 'claude in chrome'], claude: ['claude -p', 'claude code'] };
let cliCache = null;
function readApps() {
  const apps = []; const seen = new Set();
  const add = (name, group, where) => { const key = name.toLowerCase(); if (seen.has(key)) return; seen.add(key); apps.push({ name, group, where }); };
  const home = os.homedir(); const claudeJson = path.join(home, '.claude.json');
  try {
    const config = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
    for (const name of Object.keys(config.mcpServers || {})) add(name, 'MCP server', '~/.claude.json mcpServers');
    for (const [project, value] of Object.entries(config.projects || {})) for (const name of Object.keys(value?.mcpServers || {})) add(name, 'MCP server', `~/.claude.json projects[${slash(project)}].mcpServers`);
    if (config.claudeInChromeDefaultEnabled || config.cachedChromeExtensionInstalled) add('Claude in Chrome', 'MCP server', '~/.claude.json claudeInChromeDefaultEnabled');
    for (const name of config.claudeAiMcpEverConnected || []) add(String(name).replace(/^claude\.ai\s+/, ''), 'claude.ai connector', '~/.claude.json claudeAiMcpEverConnected');
  } catch { /* no Claude Code config on this machine */ }
  for (const file of [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')]) {
    try { const settings = JSON.parse(fs.readFileSync(file, 'utf8')); for (const name of settings.enabledMcpjsonServers || []) add(name, 'MCP server', '~/.claude/' + path.basename(file) + ' enabledMcpjsonServers'); } catch { /* absent */ }
  }
  if (!cliCache) cliCache = CLI_TOOLS.map(tool => { try { const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [tool], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).split(/\r?\n/)[0].trim(); return found ? { name: tool, group: 'CLI tool', where: 'on PATH: ' + slash(found) } : null; } catch { return null; } }).filter(Boolean);
  for (const tool of cliCache) add(tool.name, tool.group, tool.where);
  return apps;
}
const aliasesOf = app => (ALIASES[app.name] || [app.name.toLowerCase()]).map(alias => new RegExp('(^|[^\\w-])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'i'));

// Edges only from real links read from notes: markdown links, [[wikilinks]], path and unique
// folder-name mentions, /skill mentions, and application names inside skills and departments.
//
// Each file's findings are cached by its size and mtime as the strings its text holds (link
// targets, wikilink names, path mentions, /skill, folder and application names), and resolved
// against the current tree on every build. So editing one note re-reads that note only, and a
// file added or removed elsewhere re-reads nothing; only a folder or application renamed (the
// names the bare-word and app matches were made against) re-reads the whole tree. `cache` is
// the previous build's {namesKey, files}; the result carries the next one.
async function extractEdges(nodes, roots, cache = null) {
  // One edge per pair, keeping the most specific type when a file both links to and mentions
  // something. A mention of a folder the file already lives in says nothing, so it is dropped.
  const RANK = { link: 0, wiki: 1, skill: 2, app: 3, mention: 4 }; const found = new Map();
  const within = (a, b) => { let p = nodes[a].parent; while (p >= 0) { if (p === b) return true; p = nodes[p].parent; } return false; };
  const edge = (a, b, type) => { if (a === b || a < 0 || b < 0) return; if (type === 'mention' && within(a, b)) return; const key = a + '>' + b; const have = found.get(key); if (have === undefined || RANK[type] < RANK[have]) found.set(key, type); };
  const byPath = new Map(); const byFolderName = new Map(); const byBase = new Map(); const skills = new Map();
  const claim = (map, key, index) => map.set(key, map.has(key) ? -1 : index);
  const pathOf = i => nodes[i].path ? slash(nodes[i].path).toLowerCase() : '';
  nodes.forEach((node, i) => {
    if (!node.path) return;
    byPath.set(pathOf(i), i);
    if (node.kind === 'skill') skills.set(node.name.toLowerCase(), i);
    if (node.kind === 'folder' || node.kind === 'skill') { if (node.name.length >= 5 && !/\s/.test(node.name)) claim(byFolderName, node.name.toLowerCase(), i); }
    else claim(byBase, node.name.replace(/\.[^.]+$/, '').toLowerCase(), i);
  });
  const topOf = i => { let j = i; while (nodes[j].parent >= 0 && nodes[nodes[j].parent].kind !== 'dept') j = nodes[j].parent; return j; };
  const resolve = (fromDir, target, bases) => {
    const clean = target.split(/[#?]/)[0].trim().replace(/^<|>$/g, '');
    if (!clean || /^[a-z]+:/i.test(clean)) return -1;
    let decoded = clean; try { decoded = decodeURIComponent(clean); } catch { /* keep as written */ }
    for (const base of [fromDir, ...bases]) { const hit = byPath.get(slash(path.resolve(base, decoded)).toLowerCase().replace(/\/$/, '')); if (hit !== undefined) return hit; }
    return -1;
  };
  const apps = nodes.map((n, i) => n.kind === 'app' ? i : -1).filter(i => i >= 0).map(i => ({ index: i, patterns: aliasesOf(nodes[i]) }));
  const deptMentions = new Map(); // dept index -> Set of app indexes
  const bareWords = new Map(); // folder index -> Set of files that use its name as a plain word
  const appByName = new Map(apps.map(app => [nodes[app.index].name, app.index]));
  const namesKey = createHash('sha1').update([...byFolderName.keys()].sort().join('\n') + '\n' + [...appByName.keys()].sort().join('\n')).digest('hex');
  const reuse = cache && cache.namesKey === namesKey && cache.files ? cache.files : {}; const files = {};
  // One file's findings as strings: what its text links to, mentions and names. Nothing here
  // depends on the rest of the tree except the folder and application names (namesKey).
  const scan = text => {
    const out = { links: [], wikis: [], mentions: [], skills: [], words: [], apps: [] };
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.links.push(m[1]);
    for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) out.links.push(m[1]);
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.wikis.push(m[1].trim());
    for (const m of text.matchAll(/(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]*)/g)) out.mentions.push(m[1]);
    for (const m of text.matchAll(/[`"]([^`"\n]*\/[^`"\n]*)[`"]/g)) out.mentions.push(m[1]);
    for (const m of text.matchAll(/(?:^|[\s`"'(])\/([a-z][\w-]+)/g)) out.skills.push(m[1].toLowerCase());
    const words = new Set(); for (const m of text.matchAll(/[A-Za-z][\w-]{4,}/g)) { const word = m[0].toLowerCase(); if (byFolderName.has(word)) words.add(word); } out.words = [...words];
    for (const app of apps) if (app.patterns.some(re => re.test(text))) out.apps.push(nodes[app.index].name);
    for (const key of ['links', 'wikis', 'mentions', 'skills']) out[key] = [...new Set(out[key])];
    return out;
  };
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.path || !['note', 'text'].includes(node.kind) || node.size > LINK_SCAN_LIMIT) continue;
    const file = slash(node.path); const key = node.size + '|' + node.mtime; let found = reuse[file]?.key === key ? reuse[file] : null;
    if (!found) { let text; try { text = await fsp.readFile(node.path, 'utf8'); } catch { continue; } found = { key, ...scan(text) }; }
    files[file] = found;
    // The findings resolved against the tree as it is now.
    const dir = path.dirname(node.path); const top = topOf(i); const bases = [roots[node.root], nodes[top].path || roots[node.root]];
    for (const target of found.links) edge(i, resolve(dir, target, bases), 'link');
    for (const name of found.wikis) {
      let hit = name.includes('/') ? resolve(dir, /\.\w+$/.test(name) ? name : name + '.md', bases) : -1;
      if (hit < 0) { const base = byBase.get(name.replace(/\.md$/i, '').toLowerCase()); if (base !== undefined && base >= 0) hit = base; }
      edge(i, hit, 'wiki');
    }
    for (const target of found.mentions) edge(i, resolve(dir, target, bases), 'mention');
    for (const name of found.skills) { const hit = skills.get(name); if (hit !== undefined) edge(i, hit, 'skill'); }
    for (const word of found.words) { const hit = byFolderName.get(word); if (hit !== undefined && hit >= 0 && hit !== i) { if (!bareWords.has(hit)) bareWords.set(hit, new Set()); bareWords.get(hit).add(i); } }
    if (found.apps.length) {
      const owner = node.kind === 'note' && nodes[top].kind === 'skill' ? top : -1;
      const dept = (() => { let j = i; while (j >= 0 && nodes[j].kind !== 'dept') j = nodes[j].parent; return j; })();
      for (const name of found.apps) { const app = appByName.get(name); if (app === undefined) continue; if (owner >= 0) edge(app, owner, 'app'); else if (dept >= 0) { if (!deptMentions.has(dept)) deptMentions.set(dept, new Set()); deptMentions.get(dept).add(app); } }
    }
  }
  // A bare folder name is a mention when it is rare: a name that turns up in more files than
  // this is vocabulary ("Button", "output", "generate" the verb), not a reference to the folder.
  for (const [target, sources] of bareWords) if (sources.size <= BARE_MENTION_LIMIT) for (const source of sources) edge(source, target, 'mention');
  for (const [dept, set] of deptMentions) for (const app of set) edge(app, dept, 'app');
  return { edges: [...found].map(([key, type]) => [...key.split('>').map(Number), type]), namesKey, files };
}

let memory = { signature: '', graph: null };
// One cache file per set of roots, so a test building its own tree never replaces Andrew's.
export const cacheFileFor = roots => path.join(cacheDir, `graph-${short(roots.map(slash).join('|'))}.json`);
// The map for the configured roots (a test passes its own). Cached in memory and on disk by a
// signature over every path, size and mtime, so an unchanged tree never re-reads its links,
// and a changed one re-reads only the files that changed (extractEdges).
export async function buildGraph(roots = readRoots()) {
  const nodes = []; const options = { counts: [] };
  for (let r = 0; r < roots.length; r++) walk(roots[r], r, nodes, options);
  const apps = readApps();
  if (apps.length) {
    const hub = nodes.push({ id: short('dept:apps'), name: 'Applications', kind: 'dept', layer: 'dept', parent: -1, root: -1, size: 0, mtime: 0 }) - 1;
    for (const app of apps) nodes.push({ id: short('app:' + app.name), name: app.name, kind: 'app', layer: 'app', parent: hub, root: -1, size: 0, mtime: 0, group: app.group, where: app.where });
  }
  const signature = createHash('sha1').update(nodes.map(n => (n.path || n.name) + '|' + n.size + '|' + n.mtime).join('\n')).digest('hex');
  if (memory.signature === signature) return memory.graph;
  const cacheFile = cacheFileFor(roots);
  let cached = null; try { cached = JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch { /* no cache yet */ }
  let edges = cached?.signature === signature ? cached.edges : null;
  if (!edges) {
    const result = await extractEdges(nodes, roots, cached); edges = result.edges;
    try { await fsp.mkdir(cacheDir, { recursive: true }); await fsp.writeFile(cacheFile, JSON.stringify({ signature, namesKey: result.namesKey, files: result.files, edges })); } catch { /* the cache is a convenience */ }
  }
  const graph = { roots: roots.map((p, i) => ({ path: slash(p), count: options.counts[i] || 0 })), signature, nodes: nodes.map(({ path: _path, ...node }) => node), edges, built: new Date().toISOString() };
  memory = { signature, graph, nodes, edges, roots };
  return graph;
}

// The home page's map: the same graph with the bulk folded away. Images, code, text, PDFs and
// other files become one node per (folder, kind) carrying its member ids, named like
// "blueberry_game/docs/reference · 5,829 images". Notes, skills, routines, memory, plans,
// routers and applications stay individual. A folder whose subtree holds nothing individual
// collapses into its parent's groups, so a tree of 12,000 files reads as a few hundred nodes.
// Pure over the public graph, so a test can run it on a fixture and on the real build alike.
const GROUPED = new Set(['image', 'code', 'file', 'text', 'pdf']);
const GROUP_LABEL = { image: ['image', 'images'], code: ['code file', 'code files'], file: ['file', 'files'], text: ['text file', 'text files'], pdf: ['PDF', 'PDFs'] };
export function groupGraph(graph) {
  const { nodes, edges, roots } = graph; const n = nodes.length;
  const container = i => ['folder', 'skill', 'dept'].includes(nodes[i].kind);
  const groupable = i => GROUPED.has(nodes[i].kind) && !nodes[i].layer;
  // A container is kept when anything individual lives anywhere beneath it.
  const keep = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (nodes[i].kind === 'dept') keep[i] = 1;
    else if (!container(i) && !groupable(i)) { for (let p = nodes[i].parent; p >= 0 && !keep[p]; p = nodes[p].parent) keep[p] = 1; }
  }
  const anchorOf = i => { let p = nodes[i].parent; while (p >= 0 && !keep[p]) p = nodes[p].parent; return p; };
  const rel = i => { const parts = []; for (let j = i; j >= 0 && nodes[j].kind !== 'dept'; j = nodes[j].parent) parts.unshift(nodes[j].name); return parts.join('/'); };
  const out = []; const at = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) { if (keep[i] || (!container(i) && !groupable(i))) { at[i] = out.push({ ...nodes[i], parent: nodes[i].parent >= 0 ? at[nodes[i].parent] : -1 }) - 1; } }
  // One group per (anchor, kind). Its name is the deepest folder every member shares.
  const groups = new Map(); const folderGroups = new Map(); // collapsed folder index -> Map(group key -> count)
  const ancestors = i => { const chain = []; for (let p = i; p >= 0; p = nodes[p].parent) chain.unshift(p); return chain; };
  for (let i = 0; i < n; i++) {
    if (!groupable(i)) continue;
    const anchor = anchorOf(i); const key = anchor + '|' + nodes[i].kind;
    let group = groups.get(key);
    if (!group) { group = { anchor, kind: nodes[i].kind, members: [], size: 0, mtime: 0, common: ancestors(nodes[i].parent), root: nodes[i].root }; groups.set(key, group); }
    else { const chain = ancestors(nodes[i].parent); let same = 0; while (same < group.common.length && same < chain.length && group.common[same] === chain[same]) same++; group.common.length = same; }
    group.members.push(nodes[i].id); group.size += nodes[i].size; group.mtime = Math.max(group.mtime, nodes[i].mtime);
    for (let p = nodes[i].parent; p >= 0 && p !== anchor; p = nodes[p].parent) { if (!folderGroups.has(p)) folderGroups.set(p, new Map()); const counts = folderGroups.get(p); counts.set(key, (counts.get(key) || 0) + 1); }
  }
  const groupAt = new Map();
  for (const [key, group] of groups) {
    const deepest = group.common[group.common.length - 1]; const where = nodes[deepest].kind === 'dept' ? path.basename(roots[group.root]?.path || '') : rel(deepest);
    const count = group.members.length; const label = GROUP_LABEL[group.kind][count === 1 ? 0 : 1];
    groupAt.set(key, out.push({ id: short('group:' + nodes[group.anchor].id + ':' + group.kind), name: `${where} · ${count.toLocaleString('en-US')} ${label}`, kind: group.kind, layer: '', parent: at[group.anchor], root: group.root, size: group.size, mtime: group.mtime, members: group.members }) - 1);
  }
  // Where an old index landed: itself, its group, or for a collapsed folder its largest group.
  const target = i => {
    if (at[i] >= 0) return at[i];
    if (groupable(i)) return groupAt.get(anchorOf(i) + '|' + nodes[i].kind);
    const counts = folderGroups.get(i); if (!counts) return at[anchorOf(i)];
    let best = null, most = 0; for (const [key, count] of counts) if (count > most) { most = count; best = key; }
    return groupAt.get(best);
  };
  const seen = new Set(); const kept = [];
  for (const [a, b, type] of edges) { const ta = target(a), tb = target(b); if (ta === undefined || tb === undefined || ta === tb || ta < 0 || tb < 0) continue; const key = ta + '>' + tb; if (seen.has(key)) continue; seen.add(key); kept.push([ta, tb, type]); }
  return { roots, signature: graph.signature, built: graph.built, nodes: out, edges: kept };
}
// The grouped graph for the build the client already holds: the signature it sends is compared
// with the one in memory, so the second request never walks the disk again. Any other
// signature (a cold server, a tree that changed) builds afresh.
export async function groupedGraph(signature = '') {
  const graph = signature && memory.signature === signature ? memory.graph : await buildGraph();
  return groupGraph(graph);
}

async function nodeAt(id) {
  if (!memory.graph) await buildGraph();
  const index = memory.nodes.findIndex(n => n.id === id);
  if (index < 0) throw new Error('That node is not in the map. Reload the Network page.');
  return { index, node: memory.nodes[index] };
}
const publicNode = (nodes, i) => ({ id: nodes[i].id, name: nodes[i].name, kind: nodes[i].kind, layer: nodes[i].layer });

// The first 8 KB at most, cut back to the last full line when the file goes on. `next` is the byte
// offset the viewer continues from with textChunk, or null when the whole file was read.
async function readHead(file, size, limit) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(limit, size)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    let end = bytesRead;
    if (bytesRead < size) { const nl = buffer.lastIndexOf(10, bytesRead - 1); if (nl > 0) end = nl + 1; else end = utf8Boundary(buffer, bytesRead); }
    return { text: buffer.toString('utf8', 0, end), bytes: bytesRead, next: end < size ? end : null };
  } finally { await handle.close(); }
}
// Backs up over a UTF-8 sequence cut in half, so a chunk never ends in a broken character.
function utf8Boundary(buffer, end) {
  if (end === 0 || buffer[end - 1] < 0x80) return end;
  let lead = end - 1; while (lead > 0 && (buffer[lead] & 0xc0) === 0x80) lead--;
  const byte = buffer[lead]; const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
  return end - lead >= need ? end : lead;
}

// Frontmatter name and description, the first heading and the first paragraph, from the head only.
// A description written as a YAML block scalar (`description: >` or `|`, as the brain and
// humanizer skills do) is the indented lines that follow, folded into one paragraph.
function summarize(text) {
  const out = {}; let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length); const lines = fm[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(name|title|description):\s*(.*)$/.exec(lines[i].trim()); if (!m) continue;
      const key = m[1] === 'name' ? 'title' : m[1]; if (out[key]) continue;
      let value = m[2].trim();
      if (/^[>|][+-]?$/.test(value)) { const block = []; while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) block.push(lines[++i].trim()); value = block.join(value.startsWith('|') ? '\n' : ' '); }
      out[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  const heading = /^#{1,6}\s+(.+)$/m.exec(body); if (heading && !out.title) out.title = heading[1].trim();
  if (!out.description) { const para = body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !/^#|^---|^\||^```|^!\[|^</.test(p)); if (para) out.description = para.replace(/\s+/g, ' ').slice(0, 300); }
  return out;
}

export async function nodeDetail(id) {
  const { index, node } = await nodeAt(id); const { nodes, edges, roots } = memory;
  const out = { ...publicNode(nodes, index), path: node.path ? slash(node.path) : null, root: node.root >= 0 ? roots[node.root] && slash(roots[node.root]) : null, size: node.size, mtime: node.mtime, summary: {}, excerpt: null, next: null, linksIn: [], linksOut: [], children: [], group: node.group || null, where: node.where || null };
  for (const [a, b, type] of edges) { if (a === index) out.linksOut.push({ ...publicNode(nodes, b), type }); else if (b === index) out.linksIn.push({ ...publicNode(nodes, a), type }); }
  if (node.kind === 'folder' || node.kind === 'skill' || node.kind === 'dept') for (let i = 0; i < nodes.length; i++) if (nodes[i].parent === index) out.children.push(publicNode(nodes, i));
  // A skill reads as its SKILL.md; the viewer then loads the rest of that file on its own.
  const file = node.kind === 'skill' ? path.join(node.path, 'SKILL.md') : node.path;
  if (file && (isTextKind(node.kind) || node.kind === 'skill')) {
    const size = node.kind === 'skill' ? (await fsp.stat(file)).size : node.size;
    if (node.kind === 'skill') { out.file = slash(file); out.size = size; }
    const head = await readHead(file, size, SUMMARY_BYTES);
    record(log.reads, { id, name: node.name, bytes: head.bytes, route: 'node' });
    out.summary = summarize(head.text); out.excerpt = head.text; out.next = head.next;
  }
  return out;
}

// One 64 KB chunk of a text file from `offset`, ending at a full line where it can.
export async function textChunk(id, offset = 0) {
  const { node } = await nodeAt(id);
  const file = node.kind === 'skill' ? path.join(node.path, 'SKILL.md') : node.path;
  if (!file || !(isTextKind(node.kind) || node.kind === 'skill')) throw new Error('Only text files page through the viewer.');
  const size = (await fsp.stat(file)).size; const start = Math.max(0, Math.min(Number(offset) || 0, size));
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, size - start)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    record(log.reads, { id, name: node.name, bytes: bytesRead, route: 'text', offset: start });
    let end = bytesRead; if (start + bytesRead < size) { const nl = buffer.lastIndexOf(10, bytesRead - 1); end = nl > 0 ? nl + 1 : utf8Boundary(buffer, bytesRead); }
    return { text: buffer.toString('utf8', 0, end), offset: start, next: start + end < size ? start + end : null, size };
  } finally { await handle.close(); }
}

// Where an image or PDF is streamed from. The caller sends the bytes; this only says which.
export async function fileInfo(id) {
  const { node } = await nodeAt(id);
  if (!node.path || !['image', 'pdf'].includes(node.kind)) throw new Error('Only images and PDFs are served as files.');
  if (node.size > FILE_LIMIT) throw new Error('This file is larger than the 50 MB viewer limit. Use Open on device.');
  record(log.reads, { id, name: node.name, bytes: node.size, route: 'file' });
  return { path: node.path, mime: MIME[path.extname(node.name).toLowerCase()] || 'application/octet-stream', size: node.size };
}

// A preview image of an HTML file (a headless Chrome screenshot) or a PDF (its first page,
// rendered by the PyMuPDF that ships with this machine's Python), made on first hover and
// cached under the gitignored thumbs folder, keyed by the file's mtime.
export const chromePath = () => process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const PDF_PAGE = 'import sys, pymupdf\ndoc = pymupdf.open(sys.argv[1])\ndoc[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(sys.argv[2])\n';
export async function previewImage(id) {
  const { node } = await nodeAt(id);
  if (!node.path || !['html', 'pdf'].includes(node.kind)) throw new Error('Only HTML files and PDFs have a rendered preview.');
  const out = path.join(thumbsDir, `${id}-${node.mtime}.png`);
  if (fs.existsSync(out)) return out;
  await fsp.mkdir(thumbsDir, { recursive: true });
  const [command, args, missing] = node.kind === 'pdf'
    ? [process.env.PYTHON || 'python', ['-c', PDF_PAGE, node.path, out], 'Python with PyMuPDF is needed to render a PDF page.']
    : [chromePath(), ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--window-size=960,600', '--screenshot=' + out, 'file:///' + slash(node.path)], 'No browser found to render a preview.'];
  if (node.kind === 'html' && !fs.existsSync(command)) throw new Error(missing);
  await new Promise((resolve, reject) => execFile(command, args, { timeout: 20000, windowsHide: true }, error => error && !fs.existsSync(out) ? reject(new Error(error.code === 'ENOENT' ? missing : 'The preview could not be rendered.')) : resolve()));
  record(log.reads, { id, name: node.name, bytes: node.kind === 'pdf' ? node.size : 0, route: 'preview' });
  return out;
}

// Open the real file on this computer, or reveal it in Explorer. explorer.exe with a file path
// hands it to the default app; /select, opens its folder with the file highlighted. The path is
// an argument, never a shell string, and only nodes on the map (so never an excluded file) open.
//
// A script or an executable is never handed to its default app, because on Windows that runs
// it (.js goes to Windows Script Host, .bat and .exe run directly): those are revealed instead,
// and the reply says so. openPlan is pure so the test can prove it without spawning anything.
export const RUNNABLE = /\.(js|mjs|cjs|jse|vbs|vbe|wsf|wsh|hta|bat|cmd|com|exe|msi|msp|scr|pif|lnk|reg|ps1|psm1|py|pyw|sh|jar)$/i;
export function openPlan(file, reveal = false) {
  const target = path.resolve(file); const runnable = !reveal && RUNNABLE.test(target); reveal = reveal || runnable;
  const args = process.platform === 'win32' ? [reveal ? '/select,' + target : target] : process.platform === 'darwin' && reveal ? ['-R', target] : [target];
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return { command, args, reveal, runnable };
}
export async function openOnDevice(id, reveal = false) {
  const { node } = await nodeAt(id);
  if (!node.path) throw new Error('This node is not a file on disk.');
  const plan = openPlan(node.path, reveal);
  const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {}); child.unref();
  record(log.opens, { id, name: node.name, ...plan });
  return { ok: true, ...plan };
}
