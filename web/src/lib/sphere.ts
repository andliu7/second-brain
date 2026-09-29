// The home page's globe, as pure functions so tests run them without a canvas: where every node
// sits on the unit sphere (sphereLayout), the rotation the pointer and the clock apply to it
// (turn, spin, toFront), the load-in progress (intro) and the messages that travel its edges
// (Messages). SphereCanvas.tsx projects the result to the screen each frame.
import { layout, type GraphEdge, type Model } from './network';

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
// n points spread evenly over the sphere: the cluster centres, one per department.
export function fibonacci(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) { const y = n === 1 ? 0 : 1 - 2 * (i + 0.5) / n; const r = Math.sqrt(Math.max(0, 1 - y * y)); const phi = i * GOLDEN; out.push([r * Math.cos(phi), y, r * Math.sin(phi)]); }
  return out;
}

export type SphereLayout = { pos: Float32Array; scatter: Float32Array; cap: Float32Array; mid: Float32Array };
// Every node takes its own point of one Fibonacci lattice over the whole sphere, so the globe is
// an evenly filled ball with a round silhouette rather than lumpy caps with bare sea between them
// (2026-09-28, "make the whole thing more circular"). Each department still reads as one blob:
// its node sits on its Fibonacci centre, and it claims the free lattice points nearest that centre
// until it has one per node inside it. Inside that patch, the flat map's packing (layout in
// network.ts: folders as circles inside their parent's circle) is projected onto a cap around the
// centre as a target, and each node, nearest the centre first, takes the free point of the patch
// nearest its target, so a folder still sits together. Deterministic: the same tree lands the
// same way. scatter is where each node starts on a cold open, well outside the sphere, before it
// flies in. mid holds, per edge, the lifted midpoint of its great-circle arc (arcMid below).
export function sphereLayout(model: Model): SphereLayout {
  const { nodes, children, tops } = model; const n = nodes.length; const flat = layout(model);
  const pos = new Float32Array(n * 3); const scatter = new Float32Array(n * 3); const cap = new Float32Array(n);
  const centres = fibonacci(tops.length);
  const lists = tops.map(t => { const list: number[] = []; const walk = (i: number) => { for (const c of children[i]) { list.push(c); walk(c); } }; walk(t); return list; });
  const set = (i: number, [x, y, z]: [number, number, number]) => { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; };
  const angle = (a: [number, number, number], b: [number, number, number]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  // The lattice, less the point nearest each centre, since the department's own node stands there.
  let lattice = fibonacci(n);
  for (const c of centres) { let best = -1, bestAngle = Infinity; lattice.forEach((p, k) => { const d = angle(p, c); if (d < bestAngle) { bestAngle = d; best = k; } }); if (best >= 0) lattice = lattice.filter((_, k) => k !== best); }
  // Each department claims points nearest its centre first, until it holds one per member.
  const room = lists.map(list => list.length); const owner = new Int32Array(lattice.length).fill(-1);
  const pairs: [number, number, number][] = [];
  lattice.forEach((p, k) => centres.forEach((c, j) => { if (room[j]) pairs.push([angle(p, c), k, j]); }));
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, k, j] of pairs) if (owner[k] < 0 && room[j] > 0) { owner[k] = j; room[j]--; }
  tops.forEach((t, j) => {
    const c = centres[j]; const [cx, cy, cz] = c; const list = lists[j]; set(t, c);
    const patch = lattice.filter((_, k) => owner[k] === j); const free = patch.map(() => true);
    // The patch's reach from the centre is the cap the flat packing is projected onto.
    const reach = Math.max(0.05, ...patch.map(p => angle(p, c))); cap[t] = reach;
    // An orthonormal frame at the centre: u and v span the cap, c points out of the sphere.
    const upx = Math.abs(cy) > 0.9 ? 1 : 0, upy = 1 - upx;
    let ux = -cz * upy, uy = cz * upx, uz = cx * upy - cy * upx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = cy * uz - cz * uy, vy = cz * ux - cx * uz, vz = cx * uy - cy * ux;
    const offset = (i: number) => Math.hypot(flat.x[i] - flat.x[t], flat.y[i] - flat.y[t]);
    let extent = 1; for (const i of list) extent = Math.max(extent, offset(i));
    for (const i of [...list].sort((a, b) => offset(a) - offset(b) || a - b)) {
      const theta = reach * offset(i) / extent; const phi = Math.atan2(flat.y[i] - flat.y[t], flat.x[i] - flat.x[t]);
      const lx = Math.sin(theta) * Math.cos(phi), ly = Math.sin(theta) * Math.sin(phi), lz = Math.cos(theta);
      const target: [number, number, number] = [ux * lx + vx * ly + cx * lz, uy * lx + vy * ly + cy * lz, uz * lx + vz * ly + cz * lz];
      let best = -1, bestDot = -Infinity; patch.forEach((p, k) => { if (!free[k]) return; const d = p[0] * target[0] + p[1] * target[1] + p[2] * target[2]; if (d > bestDot) { bestDot = d; best = k; } }); // the largest dot is the smallest angle, without an acos per pair
      free[best] = false; set(i, patch[best]); cap[i] = reach;
    }
  });
  for (let i = 0; i < n; i++) { const h = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1; const far = 2.2 + h(1); for (let a = 0; a < 3; a++) scatter[i * 3 + a] = pos[i * 3 + a] * far + (h(2 + a) - 0.5) * 1.2; }
  const mid = new Float32Array(model.edges.length * 3);
  model.edges.forEach(([a, b], e) => { if (a < 0 || b < 0 || a >= n || b >= n) return; const m = arcMid(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]); mid[e * 3] = m[0]; mid[e * 3 + 1] = m[1]; mid[e * 3 + 2] = m[2]; });
  return { pos, scatter, cap, mid };
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
