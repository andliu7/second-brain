// The Network model: the graph /api/graph returns (server/graph.mjs), the tree and paths derived
// from it, the deterministic layout every node is drawn at, search, and the local (one node and
// its neighbours) scene. Pure functions, so tests run them without a canvas, plus loadGraph, the
// one request the Network page and the Ctrl+K search share.
import { api } from './api';

export type GraphNode = { id: string; name: string; kind: string; layer: string; parent: number; root: number; size: number; mtime: number; group?: string; where?: string };
export type GraphEdge = [number, number, string];
export type GraphPayload = { roots: { path: string; count: number }[]; nodes: GraphNode[]; edges: GraphEdge[]; built?: string };
export type Model = {
  nodes: GraphNode[]; roots: GraphPayload['roots']; edges: GraphEdge[];
  children: number[][]; count: Int32Array; depth: Int32Array; paths: string[]; byId: Map<string, number>;
  linksIn: number[][]; linksOut: number[][]; tops: number[];
};
// One scene the canvas draws: which model nodes, where, how big, and the lines between them.
export type Scene = { ids: Int32Array; x: Float32Array; y: Float32Array; r: Float32Array; at: Int32Array; edges: GraphEdge[]; contains: Int32Array };

// Layer colours first (the four ARMS layers, skills in Claude orange), then ordinary files by kind, dimmer.
export const COLORS: Record<string, string> = { skill: '#D97757', app: '#4C8FDB', routine: '#E2C34D', memory: '#7FC8A9', dept: '#E9E8E7', folder: '#8B909B', note: '#B7B0D8', code: '#6C7380', text: '#7C828E', image: '#6F8CA8', pdf: '#A08079', html: '#8F8B6A', file: '#5A5F68' };
export const LAYER_NAMES: Record<string, string> = { app: 'Applications', routine: 'Routines', memory: 'Memory', skill: 'Skills' };
export const colorOf = (node: GraphNode) => COLORS[node.layer] || COLORS[node.kind] || COLORS.file;
export const isFolder = (node: GraphNode) => node.kind === 'folder' || node.kind === 'skill' || node.kind === 'dept';

// One build per page load, shared: the Network page and the Ctrl+K search read the same
// promise, so a search from the front door never triggers a second walk of the disk, and
// StrictMode's double mount in development sends one request. reload() asks for a fresh build.
let pending: Promise<GraphPayload> | null = null;
export function loadGraph(reload = false): Promise<GraphPayload> {
  if (reload || !pending) { pending = api<GraphPayload>('graph').catch(error => { pending = null; throw error; }); }
  return pending;
}

export function buildModel(payload: GraphPayload): Model {
  const { nodes, roots, edges } = payload; const n = nodes.length;
  const children: number[][] = nodes.map(() => []); const depth = new Int32Array(n); const count = new Int32Array(n);
  const byId = new Map<string, number>(); const paths = new Array<string>(n).fill(''); const tops: number[] = [];
  nodes.forEach((node, i) => { byId.set(node.id, i); if (node.parent >= 0) children[node.parent].push(i); else tops.push(i); });
  // Parents come before their children in the payload (the walk pushes a folder, then its contents).
  for (let i = 0; i < n; i++) {
    const node = nodes[i]; const parent = node.parent;
    if (parent < 0) continue;
    depth[i] = depth[parent] + 1;
    const root = node.root >= 0 ? roots[node.root]?.path : '';
    if (nodes[parent].kind === 'dept') paths[i] = root ? root + '/' + node.name : ''; else if (paths[parent]) paths[i] = paths[parent] + '/' + node.name;
  }
  for (let i = n - 1; i >= 0; i--) { if (!isFolder(nodes[i])) count[i] = 1; if (nodes[i].parent >= 0) count[nodes[i].parent] += count[i]; }
  const linksIn: number[][] = nodes.map(() => []); const linksOut: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) { if (a >= 0 && b >= 0 && a < n && b < n) { linksOut[a].push(b); linksIn[b].push(a); } }
  return { nodes, roots, edges, children, count, depth, paths, byId, linksIn, linksOut, tops };
}

// Folders are circles packed inside their parent's circle, biggest first along a golden-angle
// spiral, so a department's area grows with the files it holds and a folder's dot sits at the
// centre of its contents. Deterministic: the same tree lays out the same way every load.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const SLACK = 1.35; // area per child beyond its own circle, so siblings do not touch
export function layout(model: Model): Scene {
  const { nodes, children, tops } = model; const n = nodes.length;
  const x = new Float32Array(n), y = new Float32Array(n), r = new Float32Array(n); const ids = new Int32Array(n); const at = new Int32Array(n);
  const local = new Float32Array(n * 2); // each node's offset from its parent's centre
  const pack = (i: number): number => {
    const kids = children[i];
    if (!kids.length) { r[i] = nodes[i].kind === 'dept' ? 14 : 3; return r[i]; }
    const radii = kids.map(k => pack(k)); const order = kids.map((_, j) => j).sort((a, b) => radii[b] - radii[a]);
    // A child bigger than all its siblings together (src/ in a repo, one folder in a chain of
    // folders) sits at the centre and the rest ring it, so nesting adds padding, not a multiple.
    const dominant = radii[order[0]] > order.slice(1).reduce((sum, j) => sum + radii[j], 0);
    let area = Math.PI * (dominant ? radii[order[0]] + 2 : 5) ** 2; let reach = dominant ? radii[order[0]] : 0;
    order.forEach((j, step) => {
      const rc = radii[j]; const d = dominant && step === 0 ? 0 : Math.sqrt((area + Math.PI * rc * rc * SLACK) / Math.PI) - rc * 0.5; const angle = step * GOLDEN;
      local[kids[j] * 2] = Math.cos(angle) * d; local[kids[j] * 2 + 1] = Math.sin(angle) * d;
      if (d > 0) area += Math.PI * rc * rc * SLACK; reach = Math.max(reach, d + rc);
    });
    r[i] = reach + 3; return r[i];
  };
  const topRadii = tops.map(t => pack(t)); const order = tops.map((_, j) => j).sort((a, b) => topRadii[b] - topRadii[a]);
  let area = 0;
  order.forEach((j, step) => { const rc = topRadii[j]; const d = step === 0 ? 0 : Math.sqrt(area / Math.PI) + rc * 0.5; const angle = step * GOLDEN; local[tops[j] * 2] = Math.cos(angle) * d; local[tops[j] * 2 + 1] = Math.sin(angle) * d; area += Math.PI * rc * rc * 1.9; });
  for (let i = 0; i < n; i++) { const p = nodes[i].parent; x[i] = (p >= 0 ? x[p] : 0) + local[i * 2]; y[i] = (p >= 0 ? y[p] : 0) + local[i * 2 + 1]; ids[i] = i; at[i] = i; }
  // Drawn size: a file is a small dot, a folder a little bigger, a department or layer node bigger still.
  const drawn = new Float32Array(n);
  for (let i = 0; i < n; i++) { const node = nodes[i]; drawn[i] = node.kind === 'dept' ? 7 : node.kind === 'app' || node.kind === 'skill' ? 4.5 : node.layer ? 4 : isFolder(node) ? (node.parent >= 0 && nodes[node.parent].kind === 'dept' ? 5 : 3) : 2; }
  const contains = new Int32Array(n); for (let i = 0; i < n; i++) contains[i] = nodes[i].parent;
  return { ids, x, y, r: drawn, at, edges: model.edges, contains };
}

// One node and its neighbours: the node at the centre, its folder and contents on an inner ring,
// what it links to and from on an outer ring.
export function localScene(model: Model, centre: number): Scene {
  const { nodes, children, linksIn, linksOut } = model;
  const inner = [...(nodes[centre].parent >= 0 ? [nodes[centre].parent] : []), ...children[centre].slice(0, 160)];
  const outer = [...new Set([...linksOut[centre], ...linksIn[centre]])].filter(i => !inner.includes(i) && i !== centre);
  const list = [centre, ...inner, ...outer]; const n = list.length;
  const ids = new Int32Array(list); const x = new Float32Array(n), y = new Float32Array(n), r = new Float32Array(n); const at = new Int32Array(nodes.length).fill(-1);
  list.forEach((id, pos) => { at[id] = pos; r[pos] = pos === 0 ? 8 : isFolder(nodes[id]) ? 4.5 : 3; });
  const ring = (items: number[], radius: number, offset: number) => items.forEach((id, k) => { const angle = offset + k * 2 * Math.PI / Math.max(1, items.length); x[at[id]] = Math.cos(angle) * radius; y[at[id]] = Math.sin(angle) * radius; });
  ring(inner, Math.max(90, inner.length * 3.2), -Math.PI / 2); ring(outer, Math.max(190, inner.length * 3.2 + 110, outer.length * 3.6), -Math.PI / 2 + 0.2);
  const edges = model.edges.filter(([a, b]) => at[a] >= 0 && at[b] >= 0 && (a === centre || b === centre)).map(([a, b, t]) => [at[a], at[b], t] as GraphEdge);
  const contains = new Int32Array(n).fill(-1); list.forEach((id, pos) => { const p = nodes[id].parent; if (p >= 0 && at[p] >= 0 && (id === centre || p === centre)) contains[pos] = at[p]; });
  return { ids, x, y, r, at, edges, contains };
}

// Name search for the search box and the tree filter: an exact name first, then a name that
// starts with the query, then one that contains it; among equals the most linked node, then the
// shallowest ("mobbin" is the captures folder with nine links in, not the Mobbin connector). A
// query with a slash matches against the path instead ("blueberry_game/README").
export function searchNodes(model: Model, query: string, limit = 40): number[] {
  const q = query.trim().toLowerCase(); if (!q) return [];
  const scored: [number, number][] = [];
  for (let i = 0; i < model.nodes.length; i++) {
    const name = model.nodes[i].name.toLowerCase();
    if (q.includes('/')) { const path = model.paths[i].toLowerCase(); if (path.includes(q)) scored.push([path.endsWith(q) ? 0 : 1, i]); continue; }
    if (name === q) scored.push([0, i]); else if (name.startsWith(q)) scored.push([1, i]); else if (name.includes(q)) scored.push([2, i]);
  }
  const links = (i: number) => model.linksIn[i].length + model.linksOut[i].length;
  scored.sort((a, b) => a[0] - b[0] || links(b[1]) - links(a[1]) || model.depth[a[1]] - model.depth[b[1]] || model.nodes[a[1]].name.length - model.nodes[b[1]].name.length);
  return scored.slice(0, limit).map(([, i]) => i);
}

export const ancestors = (model: Model, index: number) => { const out: number[] = []; let p = model.nodes[index]?.parent ?? -1; while (p >= 0) { out.push(p); p = model.nodes[p].parent; } return out; };
export const bytes = (value = 0) => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${Math.round(value / 1024)} KB` : `${value} B`;
