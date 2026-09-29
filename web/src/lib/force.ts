// The flat graph's layout (GraphCanvas2D.tsx), the Obsidian-style graph view: a small force
// simulation written here rather than pulled in from d3-force, because it needs one extra force
// (same colour attracts) and is about a hundred lines. Pure and seeded, so tests run it without a
// canvas and the same graph settles the same way every load.
//
// Four forces, each scaled by alpha, a "temperature" that cools geometrically from 1 to ALPHA_MIN
// over about 300 ticks, so the layout always stops (the canvas stops drawing with it):
//   repulsion  every pair closer than CUTOFF pushes apart, found through a grid of CUTOFF-sized
//              cells so a tick is about linear in nodes rather than every pair (the grid is the
//              "Barnes-Hut-lite": far pairs are simply ignored, and gravity keeps it all together)
//   springs    each edge pulls its two ends toward LINK apart, weaker on a hub so it does not
//              drag its whole neighbourhood into a knot (d3's 1 / min degree rule)
//   gravity    everything drifts toward the origin, so loose nodes do not wander off
//   colour     each node is pulled toward the centroid of its own colour, so colours clump
export const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const KEEP = 0.6; // share of velocity kept each tick (d3's velocityDecay of 0.4)
const CUTOFF = 60, REPEL = 250, LINK = 28, GRAVITY = 0.01, COLOUR = 0.02;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const AHEAD = [[1, 0], [-1, 1], [0, 1], [1, 1]]; // the four neighbour cells each cell is compared with, so a pair is met once

export type Force = { n: number; x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; a: Int32Array; b: Int32Array; strength: Float32Array; group: Int32Array; groups: number; alpha: number; steps: number };

// A tiny seeded random source (mulberry32), so a seed pins the start and so the result.
export function random(seed: number) { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

// The start: each colour gets its own spot on a ring and its nodes a sunflower spiral round it, so
// the simulation begins near the answer instead of untangling a random cloud.
export function createForce(n: number, edges: readonly (readonly [number, number, ...unknown[]])[], group: ArrayLike<number>, seed = 1): Force {
  const rand = random(seed); const x = new Float32Array(n), y = new Float32Array(n);
  const g = Int32Array.from(group); let groups = 0; for (let i = 0; i < n; i++) groups = Math.max(groups, g[i] + 1);
  const seen = new Int32Array(groups); const ring = 12 * Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const k = seen[g[i]]++; const angle = 2 * Math.PI * g[i] / Math.max(1, groups); const r = 9 * Math.sqrt(k + 0.5);
    x[i] = Math.cos(angle) * ring + Math.cos(k * GOLDEN) * r + rand() - 0.5; y[i] = Math.sin(angle) * ring + Math.sin(k * GOLDEN) * r + rand() - 0.5;
  }
  const valid = edges.filter(([p, q]) => p >= 0 && q >= 0 && p < n && q < n && p !== q);
  const degree = new Int32Array(n); for (const [p, q] of valid) { degree[p]++; degree[q]++; }
  const a = Int32Array.from(valid, e => e[0]), b = Int32Array.from(valid, e => e[1]);
  const strength = Float32Array.from(valid, ([p, q]) => 1 / Math.min(degree[p], degree[q]));
  return { n, x, y, vx: new Float32Array(n), vy: new Float32Array(n), a, b, strength, group: g, groups, alpha: 1, steps: 0 };
}

export const settled = (f: Force) => f.alpha < ALPHA_MIN;

// One tick. Returns whether the layout is still moving.
export function tick(f: Force): boolean {
  if (settled(f)) return false;
  const { n, x, y, vx, vy, alpha } = f;
  // Repulsion over the grid: each cell against itself and the four cells AHEAD of it.
  const cells = new Map<number, number[]>(); const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
  for (let i = 0; i < n; i++) { const k = key(Math.floor(x[i] / CUTOFF), Math.floor(y[i] / CUTOFF)); const cell = cells.get(k); if (cell) cell.push(i); else cells.set(k, [i]); }
  const push = (i: number, j: number) => {
    let dx = x[j] - x[i], dy = y[j] - y[i]; let d2 = dx * dx + dy * dy;
    if (d2 > CUTOFF * CUTOFF) return;
    if (d2 < 1e-6) { dx = ((i * 7 + j * 13) % 11 - 5) * 0.01 + 0.001; dy = ((i * 3 + j * 5) % 7 - 3) * 0.01; d2 = dx * dx + dy * dy; } // two on one spot: part them the same way every time
    const w = REPEL * alpha / Math.max(d2, 1); vx[i] -= dx * w; vy[i] -= dy * w; vx[j] += dx * w; vy[j] += dy * w;
  };
  for (const [k, list] of cells) {
    const cx = Math.floor(k / 65536) - 32768, cy = k % 65536 - 32768;
    for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) push(list[p], list[q]);
    for (const [ox, oy] of AHEAD) { const other = cells.get(key(cx + ox, cy + oy)); if (other) for (const i of list) for (const j of other) push(i, j); }
  }
  // Springs.
  for (let e = 0; e < f.a.length; e++) {
    const i = f.a[e], j = f.b[e]; const dx = x[j] + vx[j] - x[i] - vx[i], dy = y[j] + vy[j] - y[i] - vy[i]; const l = Math.hypot(dx, dy) || 1;
    const k = (l - LINK) / l * alpha * f.strength[e] * 0.5; vx[j] -= dx * k; vy[j] -= dy * k; vx[i] += dx * k; vy[i] += dy * k;
  }
  // Gravity and colour: toward the origin, and toward the centroid of the node's own colour.
  const sx = new Float64Array(f.groups), sy = new Float64Array(f.groups), count = new Int32Array(f.groups);
  for (let i = 0; i < n; i++) { sx[f.group[i]] += x[i]; sy[f.group[i]] += y[i]; count[f.group[i]]++; }
  for (let i = 0; i < n; i++) {
    const g = f.group[i]; const cx = sx[g] / count[g], cy = sy[g] / count[g];
    vx[i] += (cx - x[i]) * COLOUR * alpha - x[i] * GRAVITY * alpha; vy[i] += (cy - y[i]) * COLOUR * alpha - y[i] * GRAVITY * alpha;
  }
  for (let i = 0; i < n; i++) { vx[i] *= KEEP; vy[i] *= KEEP; x[i] += vx[i]; y[i] += vy[i]; }
  f.alpha -= f.alpha * ALPHA_DECAY; f.steps++;
  return !settled(f);
}

// Run to rest in one go: the reduced-motion path, and the tests.
export function settle(f: Force, maxSteps = 1000) { while (f.steps < maxSteps && tick(f)); return f; }
