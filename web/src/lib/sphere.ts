// The home page's globe, as pure functions so tests run them without a canvas: where every node
// sits on the unit sphere (sphereLayout), the rotation the pointer and the clock apply to it
// (turn, spin, toFront), the load-in progress (intro) and the messages that travel its edges
// (Messages). SphereCanvas.tsx projects the result to the screen each frame.
import { colorOf, type GraphEdge, type Model } from './network';

export type Mat = Float64Array; // a 3x3 rotation, row-major
export const identity = (): Mat => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export function multiply(a: Mat, b: Mat): Mat {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}
// Rodrigues' formula: the rotation of `angle` about the unit axis (x, y, z).
export function axisAngle(x: number, y: number, z: number, angle: number): Mat {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return new Float64Array([t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]);
}
// A drag of (dx, dy) screen pixels orbits the sphere about the screen's own axes: sideways about
// the vertical one, up and down about the horizontal one. The layout itself is never touched.
export const turn = (rot: Mat, dx: number, dy: number): Mat => multiply(multiply(axisAngle(0, 1, 0, dx), axisAngle(1, 0, 0, dy)), rot);
// The slow turntable: one full turn every 90 seconds about the screen's vertical axis.
export const TURN_MS = 90000;
export const spin = (rot: Mat, dt: number): Mat => multiply(axisAngle(0, 1, 0, 2 * Math.PI * dt / TURN_MS), rot);
export const apply = (rot: Mat, x: number, y: number, z: number): [number, number, number] => [rot[0] * x + rot[1] * y + rot[2] * z, rot[3] * x + rot[4] * y + rot[5] * z, rot[6] * x + rot[7] * y + rot[8] * z];
// The axis and angle that bring node i to the front (0, 0, 1) from where the rotation has it now,
// so a pick from the tree or the viewer can be animated there.
export function toFront(rot: Mat, pos: Float32Array, i: number): { axis: [number, number, number]; angle: number } {
  const [x, y, z] = apply(rot, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const angle = Math.acos(Math.max(-1, Math.min(1, z))); const len = Math.hypot(y, -x);
  return { axis: len < 1e-6 ? [0, 1, 0] : [y / len, -x / len, 0], angle };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
// n points spread evenly over the sphere: the lattice every node sits on, and the patch centres.
export function fibonacci(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) { const y = n === 1 ? 0 : 1 - 2 * (i + 0.5) / n; const r = Math.sqrt(Math.max(0, 1 - y * y)); const phi = i * GOLDEN; out.push([r * Math.cos(phi), y, r * Math.sin(phi)]); }
  return out;
}

export type SphereLayout = { pos: Float32Array; scatter: Float32Array; mid: Float32Array };
type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const unit = (x: number, y: number, z: number, fallback: Vec): Vec => { const l = Math.hypot(x, y, z); return l < 1e-9 ? fallback : [x / l, y / l, z / l]; };

// Every node takes its own point of one Fibonacci lattice over the whole sphere, so the globe is
// an evenly filled ball with a round silhouette (2026-09-28, "make the whole thing more circular").
// Since 2026-09-29 ("keep the nodes close to each other by color/reference") the lattice is shared
// out by colour rather than by department, in two steps:
//   patches  each colour (colorOf, so the key's rows) claims one contiguous patch of the lattice,
//            its size in proportion to how many nodes wear that colour (patches below)
//   order    inside its patch, nodes that link sit next to each other: a breadth-first walk over
//            the links lays them out from the patch centre, then a few rounds of relaxation move
//            each node to the free point of its patch nearest the middle of what it links to
// Linked nodes of two colours are pulled toward the shared edge of their patches by the same
// relaxation. Deterministic (every tie breaks on index) and run once per layout, never per frame.
// scatter is where each node starts on a cold open, well outside the sphere, before it flies in.
// mid holds, per edge, the lifted midpoint of its great-circle arc (arcMid below).
const RELAX = 6;
export function sphereLayout(model: Model): SphereLayout {
  const { nodes, edges } = model; const n = nodes.length;
  const pos = new Float32Array(n * 3); const scatter = new Float32Array(n * 3); const mid = new Float32Array(edges.length * 3);
  if (!n) return { pos, scatter, mid };
  const near: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) if (a >= 0 && b >= 0 && a < n && b < n && a !== b) { near[a].push(b); near[b].push(a); }
  // The colour groups, biggest first (a tie on the colour's own name), so the order never depends on the payload's.
  const byColour = new Map<string, number[]>();
  nodes.forEach((node, i) => { const c = colorOf(node); const list = byColour.get(c); if (list) list.push(i); else byColour.set(c, [i]); });
  const groups = [...byColour.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([, list]) => list);
  const groupOf = new Int32Array(n); groups.forEach((list, j) => { for (const i of list) groupOf[i] = j; });
  const lattice = fibonacci(n); const { owner, centres } = patches(lattice, groups.map(list => list.length));
  const flat = Float64Array.from(lattice.flat()); // the lattice as one flat array, for the relaxation's inner loop
  const at = (i: number): Vec => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const put = (i: number, p: Vec) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; };
  const points = groups.map((_, j) => lattice.map((_, k) => k).filter(k => owner[k] === j));
  // The first pass: a breadth-first walk over the links inside the colour, hubs first, laid onto
  // the patch's points from its centre outward, so a node's neighbours land a ring or so away.
  groups.forEach((list, j) => {
    const c = centres[j]; const pts = [...points[j]].sort((a, b) => dot(lattice[b], c) - dot(lattice[a], c) || a - b);
    const byDegree = [...list].sort((a, b) => near[b].length - near[a].length || a - b);
    const seen = new Set<number>(); const order: number[] = [];
    for (const start of byDegree) {
      if (seen.has(start)) continue; seen.add(start); const queue = [start];
      for (let head = 0; head < queue.length; head++) { const i = queue[head]; order.push(i); for (const q of [...near[i]].sort((a, b) => near[b].length - near[a].length || a - b)) if (groupOf[q] === j && !seen.has(q)) { seen.add(q); queue.push(q); } }
    }
    order.forEach((i, m) => put(i, lattice[pts[m]]));
  });
  // Relaxation: each node aims for the middle of itself and what it links to (a file with no links
  // aims for its folder, when the folder wears the same colour), and hubs choose first.
  for (let round = 0; round < RELAX; round++) groups.forEach((list, j) => {
    const target = new Map<number, Vec>();
    for (const i of list) {
      const own = at(i); let x = own[0], y = own[1], z = own[2];
      const pull = near[i].length ? near[i] : nodes[i].parent >= 0 && groupOf[nodes[i].parent] === j ? [nodes[i].parent] : [];
      for (const q of pull) { x += pos[q * 3]; y += pos[q * 3 + 1]; z += pos[q * 3 + 2]; }
      target.set(i, unit(x, y, z, own));
    }
    const pts = points[j]; const free = pts.map(() => true);
    for (const i of [...list].sort((a, b) => near[b].length - near[a].length || a - b)) {
      const t = target.get(i)!; let best = -1, bestDot = -Infinity;
      for (let m = 0; m < pts.length; m++) { if (!free[m]) continue; const k = pts[m] * 3; const d = flat[k] * t[0] + flat[k + 1] * t[1] + flat[k + 2] * t[2]; if (d > bestDot) { bestDot = d; best = m; } } // the largest dot is the smallest angle, without an acos per pair
      free[best] = false; put(i, lattice[pts[best]]);
    }
  });
  for (let i = 0; i < n; i++) { const h = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1; const far = 2.2 + h(1); for (let a = 0; a < 3; a++) scatter[i * 3 + a] = pos[i * 3 + a] * far + (h(2 + a) - 0.5) * 1.2; }
  edges.forEach(([a, b], e) => { if (a < 0 || b < 0 || a >= n || b >= n) return; const m = arcMid(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]); mid[e * 3] = m[0]; mid[e * 3 + 1] = m[1]; mid[e * 3 + 2] = m[2]; });
  return { pos, scatter, mid };
}

// Shares the lattice out into one patch per group, sizes[j] points each. The centres start evenly
// spread (a Fibonacci sphere of their own) and each point goes to the group it is nearest in units
// of that group's own reach, the angular radius of a cap holding its share of the sphere, so a big
// group reaches further than a small one (a weighted Voronoi split). Points are handed out nearest
// first until each group is full, then every centre moves to the middle of its patch and the split
// is redone (Lloyd's method), which pulls the patches round and contiguous.
const LLOYD = 6;
export function patches(lattice: Vec[], sizes: number[]): { owner: Int32Array; centres: Vec[] } {
  const total = lattice.length; let centres: Vec[] = fibonacci(sizes.length); const owner = new Int32Array(total);
  const reach = sizes.map(s => Math.max(0.05, Math.acos(Math.max(-1, 1 - 2 * s / total))));
  for (let round = 0; ; round++) {
    const pairs: [number, number, number][] = [];
    lattice.forEach((p, k) => centres.forEach((c, j) => { if (sizes[j]) pairs.push([angle(p, c) / reach[j], k, j]); }));
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    owner.fill(-1); const room = [...sizes];
    for (const [, k, j] of pairs) if (owner[k] < 0 && room[j] > 0) { owner[k] = j; room[j]--; }
    if (round === LLOYD) return { owner, centres };
    const sum = centres.map(() => [0, 0, 0]); lattice.forEach((p, k) => { const s = sum[owner[k]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
    centres = centres.map((c, j) => unit(sum[j][0], sum[j][1], sum[j][2], c));
  }
}

// The connections are curved (2026-09-28): each edge follows the great circle between its two
// ends, lifted a little off the surface, instead of a straight chord through the ball. One point
// per edge carries the curve: the arc's midpoint, which the canvas projects and draws through with
// one quadratic (control = 2 * mid - (a + b) / 2 passes the curve through mid), so a frame strokes
// the same number of segments as the straight lines did. The lift grows with the arc's length, so
// a long link bows outward and a short one hugs the surface. Two opposite ends have no single
// great circle; any perpendicular will do, and it is still on the surface, never through the centre.
export const ARC_LIFT = 0.12;
export function arcMid(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
  let mx = ax + bx, my = ay + by, mz = az + bz; let len = Math.hypot(mx, my, mz);
  if (len < 1e-6) { mx = -ay; my = ax; mz = 0; len = Math.hypot(mx, my, mz); if (len < 1e-6) { mx = 1; my = 0; mz = 0; len = 1; } }
  const theta = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))); const r = 1 + ARC_LIFT * theta / Math.PI;
  return [mx / len * r, my / len * r, mz / len * r];
}
// The point at t along the quadratic through a, mid and b (t = 0 is a, 0.5 is mid, 1 is b), for
// the canvas's messages, which travel the same curve the edge is drawn on. Screen or sphere space.
export const curveAt = (a: number, m: number, b: number, t: number) => { const c = 2 * m - (a + b) / 2; return (1 - t) * (1 - t) * a + 2 * t * (1 - t) * c + t * t * b; };

// The load-in: nodes fly from scatter to their place over about 1.2 s, each on its own slight
// delay, and the edges fade in after them. Under reduced motion both are complete at once, so
// the first frame is the final picture.
export const INTRO_MS = 1200;
export const ease = (t: number) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
export function intro(elapsed: number, reduced: boolean): { node: number; edge: number } {
  if (reduced) return { node: 1, edge: 1 };
  return { node: Math.max(0, Math.min(1, elapsed / INTRO_MS)), edge: Math.max(0, Math.min(1, (elapsed - INTRO_MS * 0.75) / (INTRO_MS * 0.6))) };
}
// Node i's own progress, staggered over the first 300 ms so the sphere assembles rather than snaps.
export const nodeProgress = (elapsed: number, i: number, reduced: boolean) => reduced ? 1 : ease((elapsed - (i % 37) / 37 * 300) / (INTRO_MS - 300));

// The messages: a few particles travelling along edges, so the graph reads as alive rather than
// busy. Never more than `cap` on screen, spawned at `rate` per second, each crossing its edge in
// two to five seconds and gone at the far end.
export type Particle = { edge: number; t: number; speed: number };
export class Messages {
  live: Particle[] = []; private due = 0; private seed = 7;
  constructor(public cap = 40, public rate = 5) {}
  private random() { this.seed = (this.seed * 1664525 + 1013904223) % 4294967296; return this.seed / 4294967296; }
  tick(dt: number, edges: GraphEdge[]) {
    for (const p of this.live) p.t += p.speed * dt / 1000;
    this.live = this.live.filter(p => p.t < 1);
    if (!edges.length) return;
    this.due += this.rate * dt / 1000;
    while (this.due >= 1) { this.due -= 1; if (this.live.length >= this.cap) { this.due = 0; break; } this.live.push({ edge: Math.floor(this.random() * edges.length), t: 0, speed: 0.2 + this.random() * 0.3 }); }
  }
}

// The spatial grid over projected positions, rebuilt each frame from the screen coordinates the
// frame just drew, so "which node is under the pointer" never touches every node.
export const CELL = 32;
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
export function buildGrid(px: Float32Array, py: Float32Array, n: number): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const k = key(Math.floor(px[i] / CELL), Math.floor(py[i] / CELL)); const cell = grid.get(k); if (cell) cell.push(i); else grid.set(k, [i]); }
  return grid;
}
// The nearest node within `reach` of the pointer, the nearer to the viewer winning a tie.
export function hitGrid(grid: Map<number, number[]>, px: Float32Array, py: Float32Array, pz: Float32Array, radius: (i: number) => number, sx: number, sy: number, reach: number): number {
  let best = -1, bestScore = Infinity;
  for (let cx = Math.floor((sx - reach) / CELL); cx <= Math.floor((sx + reach) / CELL); cx++) for (let cy = Math.floor((sy - reach) / CELL); cy <= Math.floor((sy + reach) / CELL); cy++) {
    for (const i of grid.get(key(cx, cy)) || []) { const d = Math.hypot(px[i] - sx, py[i] - sy); if (d > Math.max(reach, radius(i) + 2)) continue; const score = d - pz[i] * 4; if (score < bestScore) { bestScore = score; best = i; } }
  }
  return best;
}
