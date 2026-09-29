// The flat graph's layout (GraphCanvas2D.tsx): the grouped graph as labelled clusters of rings,
// replacing the free force layout of 2026-09-29 because Andrew wanted it "more grouped": the
// skills in one circle, each project its own cluster, the big category named and the rest quiet.
// Pure and deterministic (no random, no simulation), so tests run it without a canvas and the
// same graph lands the same way every load, and there is nothing left to settle frame by frame.
//
// Three steps:
//   group    every node joins one cluster, read off the tree (see clusterNodes below)
//   rings    a cluster's members sit on rings round its hub: one ring while they fit, else
//            concentric rings filled inside out, each ring's members evenly spaced round the
//            full circle, so every member of a ring is the same distance from the centre
//   pack     cluster centres are placed one at a time, most linked first, each touching the
//            cluster it shares most links with, at the free spot that keeps the whole compact.
//            A greedy pack rather than one big circle because sizes run from 3 to 200 members:
//            on a circle the big ones would push the small ones far apart with a hole between
import { colorOf, type Model } from './network';

export const SPACING = 22; // arc between neighbours on a ring, world units: two of the largest dots never touch
export const MIN_RING = 44; // the first ring's radius, room for the hub dot inside it
export const RING_GAP = 26; // between concentric rings
const SINGLE_MAX = 200; // a single ring grows up to this radius (57 members, room for every skill), then rings nest
const GAP = 34; // between two clusters' outer rings, room for a category label
const MIN_MEMBERS = 6; // a project with fewer folds into its area's cluster
const MIN_SKILL_FILES = 20; // a skill folder with fewer files inside folds into Other skill files
const MIN_AREA = 3; // an area cluster with fewer members folds into Other
const MAX_CLUSTERS = 24; // beyond this the smallest projects fold into their area too
const TRIES = 48; // candidate angles round each placed cluster when packing

export type Cluster = {
  key: string; name: string; color: string;
  hub: number; // the node drawn at the centre (the area, project or dept node), or -1 for a label-only hub
  members: number[]; // ring order, inner ring first
  rings: number[]; // members per ring, inside out
  radii: number[]; // each ring's radius
  radius: number; // the outer ring's radius (MIN_RING for an empty cluster)
  x: number; y: number; // the centre, in world units
};
export type ClusterLayout = { clusters: Cluster[]; clusterOf: Int32Array; x: Float32Array; y: Float32Array };

// The grouping, read off the tree the server builds (server/graph.mjs): a top-level node is an
// area (a department such as Skills, Applications or Chemistry apps), and an area's child folders
// are its projects (blueberry_game, grignard, second-brain). So:
//   an area is the hub of its own cluster, which holds its loose files, its apps, its skill folders
//   a project folder is the hub of a cluster holding everything beneath it
//   what sits inside a skill folder is a cluster of its own ("design-md files"), so the Skills
//     cluster itself is one clean circle of skills, as asked
// Then the small ones fold, so the picture is a couple of dozen named groups, not a hundred:
// a project under MIN_MEMBERS joins its area (its folder becomes one of the area's members), the
// files of a skill under MIN_SKILL_FILES join one "Other skill files" cluster (never the Skills
// circle, which stays skills only), the smallest past MAX_CLUSTERS fold the same way, and an area
// left under MIN_AREA members (one whose projects all became clusters, such as Chemistry apps)
// joins Other.
export function clusterNodes(model: Model): { key: string; name: string; hub: number; members: number[] }[] {
  const { nodes } = model; const n = nodes.length;
  const area = new Int32Array(n), top = new Int32Array(n).fill(-1); // top: the depth-1 ancestor
  for (let i = 0; i < n; i++) { const p = nodes[i].parent; area[i] = p < 0 ? i : area[p]; top[i] = p < 0 ? -1 : nodes[p].parent < 0 ? i : top[p]; }
  const isProject = (i: number) => nodes[i].kind !== 'skill' && model.children[i].length > 0;
  type Group = { key: string; name: string; hub: number; members: number[]; area: number };
  const groups = new Map<string, Group>();
  const get = (key: string, name: string, hub: number, owner: number) => { let g = groups.get(key); if (!g) groups.set(key, g = { key, name, hub, members: [], area: owner }); return g; };
  for (let i = 0; i < n; i++) {
    if (nodes[i].parent < 0) { get('area:' + i, nodes[i].name, i, i); continue; }
    const t = top[i]; const a = area[i];
    if (t === i) { if (isProject(i)) get('project:' + i, nodes[i].name, i, a); else get('area:' + a, nodes[a].name, a, a).members.push(i); continue; }
    if (nodes[t].kind === 'skill') get('skill:' + t, nodes[t].name + ' files', -1, a).members.push(i);
    else get('project:' + t, nodes[t].name, t, a).members.push(i);
  }
  const skill = (g: Group) => g.key.startsWith('skill:');
  const target = (g: Group) => skill(g) ? get('skills-other:' + g.area, 'Other skill files', -1, g.area) : groups.get('area:' + g.area)!;
  const fold = (g: Group, into: Group) => { if (g.hub >= 0) into.members.push(g.hub); into.members.push(...g.members); groups.delete(g.key); };
  const small = () => [...groups.values()].filter(g => !g.key.startsWith('area:'));
  for (const g of small()) if (g.members.length < (skill(g) ? MIN_SKILL_FILES : MIN_MEMBERS)) fold(g, target(g));
  const bySize = small().sort((a, b) => a.members.length - b.members.length || (a.key < b.key ? -1 : 1));
  const areas = [...groups.values()].filter(g => g.key.startsWith('area:'));
  for (let over = groups.size - MAX_CLUSTERS, k = 0; over > 0 && k < bySize.length; over--, k++) fold(bySize[k], target(bySize[k]));
  const other: Group = { key: 'other', name: 'Other', hub: -1, members: [], area: -1 };
  for (const g of areas) if (g.members.length < MIN_AREA) fold(g, other);
  if (other.members.length) groups.set('other', other);
  return [...groups.values()].map(({ key, name, hub, members }) => ({ key, name, hub, members }));
}

// A cluster's rings: how many members each holds and at what radius. One ring while the members
// fit at SPACING on a circle no wider than SINGLE_MAX; past that, rings from MIN_RING outwards,
// each filled to what fits on it before the next begins.
export function ringsFor(count: number): { rings: number[]; radii: number[] } {
  if (!count) return { rings: [], radii: [] };
  const single = count * SPACING / (2 * Math.PI);
  if (single <= SINGLE_MAX) return { rings: [count], radii: [Math.max(MIN_RING, single)] };
  const rings: number[] = [], radii: number[] = [];
  // The outer ring takes what is left, spread evenly round the whole circle, just thinner.
  for (let left = count, r = MIN_RING; left > 0; r += RING_GAP) { const fits = Math.max(1, Math.floor(2 * Math.PI * r / SPACING)); rings.push(Math.min(fits, left)); radii.push(r); left -= fits; }
  return { rings, radii };
}

export function clusterLayout(model: Model): ClusterLayout {
  const { nodes } = model; const n = nodes.length;
  const x = new Float32Array(n), y = new Float32Array(n); const clusterOf = new Int32Array(n).fill(-1);
  const clusters: Cluster[] = clusterNodes(model).map(g => {
    // Ring order: shallowest first, siblings side by side, so the inner ring holds a project's
    // top level and its deeper files sit outside it.
    const members = [...g.members].sort((a, b) => model.depth[a] - model.depth[b] || nodes[a].parent - nodes[b].parent || a - b);
    const colours = new Map<string, number>(); for (const i of members.length ? members : [g.hub]) if (i >= 0) colours.set(colorOf(nodes[i]), (colours.get(colorOf(nodes[i])) || 0) + 1);
    const color = [...colours].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '#E9E8E7';
    const { rings, radii } = ringsFor(members.length);
    return { ...g, members, rings, radii, color, radius: radii.length ? radii[radii.length - 1] : MIN_RING, x: 0, y: 0 };
  });
  clusters.forEach((c, index) => { if (c.hub >= 0) clusterOf[c.hub] = index; for (const i of c.members) clusterOf[i] = index; });
  // How related two clusters are: the links between their members, plus a folder in one holding
  // files in the other (a skill and its files, an area and its projects).
  const count = clusters.length; const links = Array.from({ length: count }, () => new Float64Array(count));
  const relate = (a: number, b: number) => { const p = clusterOf[a], q = clusterOf[b]; if (p >= 0 && q >= 0 && p !== q) { links[p][q]++; links[q][p]++; } };
  for (const [a, b] of model.edges) if (a >= 0 && b >= 0 && a < n && b < n) relate(a, b);
  for (let i = 0; i < n; i++) if (nodes[i].parent >= 0) relate(i, nodes[i].parent);
  // Pack: the biggest first at the origin, then always the unplaced cluster most linked to what is
  // placed (the biggest on a tie), against the placed cluster it is most linked to.
  const reach = (c: Cluster) => c.radius + 12; // the outer ring plus the largest dot
  const placed: number[] = []; const done = new Uint8Array(count);
  const pick = () => { let best = -1, score = -1; for (let c = 0; c < count; c++) { if (done[c]) continue; const s = placed.reduce((sum, p) => sum + links[c][p], 0); if (best < 0 || s > score || (s === score && clusters[c].members.length > clusters[best].members.length)) { best = c; score = s; } } return best; };
  while (placed.length < count) {
    const c = pick(); const me = clusters[c]; done[c] = 1;
    if (placed.length) {
      let anchor = placed[0]; for (const p of placed) if (links[c][p] > links[c][anchor]) anchor = p;
      const free = (px: number, py: number) => placed.every(p => Math.hypot(px - clusters[p].x, py - clusters[p].y) >= reach(clusters[p]) + reach(me) + GAP - 1e-6);
      let bx = 0, by = 0, bestScore = Infinity;
      for (const p of placed) for (let t = 0; t < TRIES; t++) {
        const angle = 2 * Math.PI * t / TRIES; const d = reach(clusters[p]) + reach(me) + GAP;
        const px = clusters[p].x + Math.cos(angle) * d, py = clusters[p].y + Math.sin(angle) * d;
        if (!free(px, py)) continue;
        const score = Math.hypot(px - clusters[anchor].x, py - clusters[anchor].y) + 0.5 * Math.hypot(px, py);
        if (score < bestScore) { bestScore = score; bx = px; by = py; }
      }
      if (bestScore === Infinity) { bx = placed.reduce((m, p) => Math.max(m, clusters[p].x + reach(clusters[p])), 0) + reach(me) + GAP; by = 0; } // nothing free touching: past the right edge
      me.x = bx; me.y = by;
    }
    placed.push(c);
  }
  // Centre the whole on the origin, then set every member on its ring. Each ring starts at the top
  // and the next ring is turned half a step, so the rings read as rings rather than spokes.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of clusters) { x0 = Math.min(x0, c.x - c.radius); x1 = Math.max(x1, c.x + c.radius); y0 = Math.min(y0, c.y - c.radius); y1 = Math.max(y1, c.y + c.radius); }
  const mx = count ? (x0 + x1) / 2 : 0, my = count ? (y0 + y1) / 2 : 0;
  for (const c of clusters) {
    c.x -= mx; c.y -= my; if (c.hub >= 0) { x[c.hub] = c.x; y[c.hub] = c.y; }
    let at = 0;
    c.rings.forEach((size, ring) => {
      const step = 2 * Math.PI / size; const start = -Math.PI / 2 + (ring % 2) * step / 2;
      for (let k = 0; k < size; k++, at++) { const i = c.members[at]; x[i] = c.x + Math.cos(start + k * step) * c.radii[ring]; y[i] = c.y + Math.sin(start + k * step) * c.radii[ring]; }
    });
  }
  return { clusters, clusterOf, x, y };
}
