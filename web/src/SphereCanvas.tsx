// The home page's globe on one 2D canvas: every node of the grouped graph sits on a sphere
// (lib/sphere.ts), which is rotated and projected to the screen each frame. Nearer nodes draw
// larger and brighter, far ones smaller and dimmer, so it reads as depth without WebGL.
//
// No cached bitmap here, unlike NetworkCanvas: the sphere turns on its own, so every frame is a
// fresh projection of about 1,200 dots and 1,500 lines, batched into one path per colour and
// alpha step, which is a few milliseconds. The spatial grid and the greedy label placement are
// the flat map's, rebuilt over the projected coordinates. A drag orbits the whole sphere and
// never moves a node; scroll zooms; a click selects; a pick from the tree turns the node to the
// front. The turntable, the load-in and the messages are all off under prefers-reduced-motion.
import { useEffect, useRef } from 'react';
import { COLORS, colorOf, isFolder, type Model } from './lib/network';
import { apply, axisAngle, buildGrid, ease, hitGrid, identity, intro, Messages, multiply, nodeProgress, spin, toFront, turn, type Mat, type SphereLayout } from './lib/sphere';
import { ellipsis, INSET, type LabelBox } from './NetworkCanvas';

type Props = { model: Model; layout: SphereLayout; selected: number; hovered: number; onSelect: (index: number) => void; onHover: (index: number, x: number, y: number) => void; focus: { index: number; seq: number }; paused: boolean };
const BG = '#0c1222'; // dark navy, never pure black
export const INK = { bg: BG, label: '#e6e7ee', dept: '#f2f1ef', near: '#ececf2', focus: '#f2f1ef', halo: 'rgba(12,18,34,0.92)', dim: 0.62 };
export const PERSPECTIVE = 3.2; // eye distance in sphere radii: the near face reads a little larger than the far one
export const RADIUS = 0.34; // the sphere's radius at zoom 1, as a share of the shorter side of the panel
const FONT = '"DM Sans Variable", sans-serif';

// Text widths, measured once per font and name: measureText is a real cost in a frame of 100
// names, and so is setting ctx.font, so the font is set only on a miss and never read back.
const widths = new Map<string, number>();
function measure(ctx: CanvasRenderingContext2D, font: string, name: string): number { const key = font + '|' + name; let w = widths.get(key); if (w === undefined) { ctx.font = font; w = ctx.measureText(name).width; widths.set(key, w); } return w; }
// A painted name on its backing box, once per name, font and ink. Bounded: past 3,000 the cache starts over.
const labelSprites = new Map<string, HTMLCanvasElement>();
function labelSprite(name: string, font: string, ink: string, bw: number, bh: number, dpr: number): HTMLCanvasElement {
  const key = `${font}|${ink}|${name}`; const hit = labelSprites.get(key); if (hit) return hit;
  if (labelSprites.size > 3000) labelSprites.clear();
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(bw * dpr); canvas.height = Math.ceil(bh * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) { ctx.scale(dpr, dpr); ctx.fillStyle = INK.halo; ctx.fillRect(0, 0, bw, bh); ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = ink; ctx.fillText(name, bw / 2, 2); }
  labelSprites.set(key, canvas); return canvas;
}
const fitted = new Map<string, string>();
function fit(ctx: CanvasRenderingContext2D, font: string, name: string): string { const key = font + '|' + name; let text = fitted.get(key); if (text === undefined) { ctx.font = font; text = ellipsis(ctx, name); fitted.set(key, text); } return text; }

declare global { interface Window { __sphere?: { ready: boolean; count: number; renders: () => number; timing: () => Record<string, number>; camera: () => { k: number; rot: number[] }; positions: () => Float32Array; intro: () => { node: number; edge: number }; particles: () => number; labels: () => LabelBox[]; screenOf: (path: string) => { x: number; y: number; z: number } | null; selected: () => string; colors: Record<string, string>; ink: typeof INK } } }

export function SphereCanvas({ model, layout, selected, hovered, onSelect, onHover, focus, paused }: Props) {
  const host = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ rot: identity() as Mat, k: 1, w: 0, h: 0, dpr: 1, px: new Float32Array(0), py: new Float32Array(0), pz: new Float32Array(0), order: [] as number[], grid: new Map<number, number[]>(), raf: 0, last: 0, started: 0, renders: 0, drag: null as null | { x: number; y: number; node: number; moved: boolean }, hover: -1, labels: [] as LabelBox[], messages: new Messages(40, 5), reduced: false, intro: { node: 0, edge: 0 }, timing: {} as Record<string, number>, turning: null as null | { axis: [number, number, number]; angle: number; from: Mat; start: number } });
  const props = useRef({ model, layout, selected, hovered, onSelect, onHover, paused }); props.current = { model, layout, selected, hovered, onSelect, onHover, paused };

  // A node's drawn radius: departments biggest, then applications, skills and layer nodes, a group
  // by how many files it holds, folders, then single files; all scaled by the zoom and the depth.
  const base = (i: number) => { const node = props.current.model.nodes[i]; return node.kind === 'dept' ? 6.5 : node.kind === 'app' || node.kind === 'skill' ? 4.2 : node.members ? 3 + Math.min(3.5, Math.log10(node.members.length) * 1.4) : node.layer ? 3.6 : isFolder(node) ? 2.6 : 2.1; };
  const depth = (i: number) => (state.current.pz[i] + 1) / 2;
  const radius = (i: number) => base(i) * Math.min(1.8, Math.max(0.85, Math.sqrt(state.current.k))) * (0.55 + 0.45 * depth(i));
  const alpha = (i: number) => 0.3 + 0.7 * depth(i);

  // Rotate and project every node for this frame, then rebuild the grid and the draw order.
  function project(now: number) {
    const s = state.current; const { model, layout } = props.current; const n = model.nodes.length;
    if (s.px.length !== n) { s.px = new Float32Array(n); s.py = new Float32Array(n); s.pz = new Float32Array(n); s.order = Array.from({ length: n }, (_, i) => i); }
    const elapsed = now - s.started; s.intro = intro(elapsed, s.reduced);
    const R = Math.min(s.w, s.h) * RADIUS * s.k; const cx = s.w / 2, cy = s.h / 2;
    for (let i = 0; i < n; i++) {
      const e = nodeProgress(elapsed, i, s.reduced); const o = i * 3;
      const x = layout.scatter[o] + (layout.pos[o] - layout.scatter[o]) * e, y = layout.scatter[o + 1] + (layout.pos[o + 1] - layout.scatter[o + 1]) * e, z = layout.scatter[o + 2] + (layout.pos[o + 2] - layout.scatter[o + 2]) * e;
      const [vx, vy, vz] = apply(s.rot, x, y, z); const persp = PERSPECTIVE / (PERSPECTIVE - Math.min(vz, PERSPECTIVE - 0.5));
      s.px[i] = cx + vx * R * persp; s.py[i] = cy - vy * R * persp; s.pz[i] = Math.max(-1, Math.min(1, vz));
    }
    s.order.sort((a, b) => s.pz[a] - s.pz[b]); s.grid = buildGrid(s.px, s.py, n);
  }
  const hit = (sx: number, sy: number) => { const s = state.current; return s.px.length ? hitGrid(s.grid, s.px, s.py, s.pz, radius, sx, sy, 7) : -1; };

  function draw(now: number) {
    const s = state.current; const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (!canvas || !ctx || !s.w || !s.h) return;
    const t0 = performance.now(); project(now); const t1 = performance.now();
    const { model, selected, hovered } = props.current; const { px, py, pz, w, h, dpr } = s; const n = model.nodes.length; const nodes = model.nodes;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
    const focusNode = hovered >= 0 ? hovered : selected; const node = focusNode >= 0 ? nodes[focusNode] : null;
    const near = new Set<number>(); if (node) { for (const q of model.linksOut[focusNode]) near.add(q); for (const q of model.linksIn[focusNode]) near.add(q); if (node.parent >= 0) near.add(node.parent); for (const q of model.children[focusNode].slice(0, 400)) near.add(q); }
    const isLink = (q: number) => focusNode >= 0 && (model.linksOut[focusNode].includes(q) || model.linksIn[focusNode].includes(q));
    // The links, one path per alpha step, dimmed to a trace when a node is focused: its own are drawn bright below.
    if (s.intro.edge > 0) {
      const buckets: [number, number][][] = [[], [], [], []];
      // Zoomed in, most of the sphere is off the panel: a line with both ends well outside it is skipped.
      const far = (i: number) => px[i] < -w / 2 || px[i] > w * 1.5 || py[i] < -h / 2 || py[i] > h * 1.5;
      for (let e = 0; e < model.edges.length; e++) { const [a, b] = model.edges[e]; if (focusNode >= 0 && (a === focusNode || b === focusNode)) continue; if (far(a) && far(b)) continue; buckets[Math.round(Math.min(depth(a), depth(b)) * 3)].push([a, b]); }
      // The faintest step, both ends on the far side, is left out: at 7% alpha it is not seen, and it is a third of the lines.
      ctx.lineWidth = 1;
      buckets.forEach((list, step) => { if (!list.length || step === 0) return; ctx.strokeStyle = `rgba(178,190,228,${((0.07 + 0.2 * step / 3) * s.intro.edge * (focusNode >= 0 ? 0.3 : 1)).toFixed(3)})`; ctx.beginPath(); for (const [a, b] of list) { ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); } ctx.stroke(); });
    }
    const t2 = performance.now();
    // The messages: a few dim dots moving along edges, in the colour of the node they left.
    for (const p of s.messages.live) { if (!model.edges[p.edge]) continue; const [a, b] = model.edges[p.edge]; const x = px[a] + (px[b] - px[a]) * p.t, y = py[a] + (py[b] - py[a]) * p.t; ctx.globalAlpha = 0.55 * Math.min(depth(a), depth(b)); ctx.fillStyle = colorOf(nodes[a]); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;
    // The dots, far to near, one path per colour and alpha step: the whole sphere is a few dozen
    // fills, and one path of 300 arcs rasterises in a single pass where 300 separate draws do not.
    const byFill = new Map<string, number[]>();
    for (const i of s.order) { if (px[i] < -20 || px[i] > w + 20 || py[i] < -20 || py[i] > h + 20) continue; const dim = focusNode >= 0 && i !== focusNode && !near.has(i) ? 0.3 : 1; const step = Math.round(alpha(i) * dim * 8) / 8; const key = colorOf(nodes[i]) + '|' + step; const list = byFill.get(key); if (list) list.push(i); else byFill.set(key, [i]); }
    for (const [key, list] of byFill) { const [color, step] = key.split('|'); ctx.fillStyle = color; ctx.globalAlpha = Number(step); ctx.beginPath(); for (const i of list) { const r = radius(i); ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, 6.2832); } ctx.fill(); }
    ctx.globalAlpha = 1;
    const t3 = performance.now();
    // Labels, most important first, each placed only where no earlier one sits, inset from the
    // panel edge, on the near face only: departments always, groups and top folders next, files
    // when zoomed in. A focused view keeps the department names as faint bearings and lights the
    // neighbourhood's own names below.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = INK.halo;
    const want: [number, number, number, string][] = []; const k = s.k;
    for (let i = 0; i < n; i++) {
      const node = nodes[i]; const z = pz[i]; const top = node.parent >= 0 && nodes[node.parent].kind === 'dept';
      if (node.kind === 'dept') { if (z > -0.35) want.push([0, i, 13, '600 ']); }
      else if (focusNode >= 0) continue;
      else if (node.members) { if (z > 0.15 && (k >= 0.9 || node.members.length >= 200)) want.push([1, i, 11.5, '500 ']); }
      else if (top && isFolder(node)) { if (z > 0.1) want.push([1, i, 12, '500 ']); }
      else if (node.kind === 'app' || node.kind === 'skill' || node.layer) { if (z > 0.1 && k >= 0.9) want.push([2, i, 11.5, '500 ']); }
      else if (isFolder(node)) { if (z > 0.25 && k >= 2) want.push([3, i, 11, '']); }
      else if (z > 0.3 && k >= 3.2) want.push([4, i, 10.5, '']);
    }
    want.sort((a, b) => a[0] - b[0] || pz[b[1]] - pz[a[1]]);
    const placed: [number, number, number, number][] = []; const boxes: LabelBox[] = []; const used = new Set<string>();
    const free = (x: number, y: number, bw: number, bh: number) => placed.every(([qx, qy, qw, qh]) => x + bw < qx || qx + qw < x || y + bh < qy || qy + qh < y);
    const onScreen = (x: number, y: number) => x >= 0 && x <= w && y >= 0 && y <= h;
    const inside = (x: number, y: number, bw: number, bh: number): [number, number] => [Math.min(Math.max(x, INSET), Math.max(INSET, w - INSET - bw)), Math.min(Math.max(y, INSET), Math.max(INSET, h - INSET - bh))];
    const label = (i: number, size: number, weight: string, ink: string, above: boolean, a: number) => {
      if (!onScreen(px[i], py[i])) return false;
      const node = nodes[i]; const font = `${weight}${size}px ${FONT}`;
      let name = fit(ctx, font, node.members ? node.name.split(' · ').slice(-1)[0] + ' in ' + node.name.split(' · ')[0].split('/').slice(-1)[0] : node.name);
      if (used.has(name) && node.parent >= 0) name = fit(ctx, font, `${node.name} · ${nodes[node.parent].name}`);
      const width = measure(ctx, font, name); const bw = Math.ceil(width + 6), bh = Math.ceil(size + 4); const r = radius(i);
      const [x, y] = inside(px[i] - bw / 2, above ? py[i] - r - 5 - size : py[i] + r + 2, bw, bh);
      if (!free(x, y, bw, bh)) return false;
      placed.push([x, y, bw, bh]); boxes.push({ name, x, y, w: bw, h: bh, dx: px[i], dy: py[i] }); used.add(name);
      // Each name is painted once, on its dark backing box, and stamped from then on: filling text is the costly part of a frame of names.
      ctx.globalAlpha = a; ctx.drawImage(labelSprite(name, font, ink, bw + 2, bh + 2, dpr), Math.round(x - 1), Math.round(y - 1), bw + 2, bh + 2); ctx.globalAlpha = 1; return true;
    };
    // Names are never dimmed by depth (the dots are): a name on screen is there to be read, and every one clears 4.5:1.
    let tried = 0; // zoomed in, every file is a candidate; the ones off screen are cheap, the rest are budgeted
    for (const [, i, size, weight] of want) { if (placed.length >= 160 || tried >= 400) break; if (i === focusNode) continue; if (onScreen(px[i], py[i])) tried++; const node = nodes[i]; label(i, size, weight, node.kind === 'dept' ? INK.dept : node.layer ? colorOf(node) : INK.label, node.kind === 'dept', node.kind === 'dept' && focusNode >= 0 ? 0.7 : 1); }
    const t4 = performance.now();
    // The focused neighbourhood on top: its lines, its dots at full strength, its names.
    if (node && focusNode >= 0) {
      const sx = px[focusNode], sy = py[focusNode];
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); for (const q of near) if (!isLink(q)) { ctx.moveTo(sx, sy); ctx.lineTo(px[q], py[q]); } ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(233,174,142,0.9)'; ctx.beginPath(); for (const q of near) if (isLink(q)) { ctx.moveTo(sx, sy); ctx.lineTo(px[q], py[q]); } ctx.stroke();
      ctx.lineWidth = 3; let count = 0;
      for (const q of near) { const rq = Math.max(2.5, radius(q)); ctx.fillStyle = colorOf(nodes[q]); ctx.beginPath(); ctx.arc(px[q], py[q], rq, 0, 6.2832); ctx.fill(); if (count < 70 && label(q, 11, '', INK.near, false, 1)) count++; }
      const r = Math.max(4, radius(focusNode)) + 1.5; ctx.fillStyle = colorOf(node); ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
      const font = `600 12.5px ${FONT}`; ctx.font = font; const name = fit(ctx, font, node.name); const width = measure(ctx, font, name);
      const [x, y] = inside(sx - width / 2 - 7, sy + r + 3, width + 14, 21);
      ctx.fillStyle = 'rgba(12,18,34,0.94)'; ctx.beginPath(); ctx.roundRect(x, y, width + 14, 21, 6); ctx.fill();
      ctx.strokeStyle = colorOf(node); ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = INK.focus; ctx.fillText(name, x + width / 2 + 7, y + 3);
      if (onScreen(sx, sy)) boxes.push({ name, x, y, w: width + 14, h: 21, dx: sx, dy: sy });
    }
    if (selected >= 0) { ctx.strokeStyle = '#e9ae8e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px[selected], py[selected], Math.max(4, radius(selected)) + 5, 0, 6.2832); ctx.stroke(); }
    s.labels = boxes; s.renders++; s.timing = { project: t1 - t0, edges: t2 - t1, dots: t3 - t2, labels: t4 - t3, focus: performance.now() - t4 };
  }

  // The clock: the turntable, a pick turning to the front, the messages, then one frame. The loop
  // runs whenever motion is allowed (the messages never stop); under reduced motion it never
  // runs, and frames come on demand from the pointer, the keyboard and the props.
  const animating = () => !state.current.reduced;
  const frame = (now: number) => {
    const s = state.current; s.raf = 0; const dt = s.last ? Math.min(50, now - s.last) : 0; s.last = now;
    if (s.turning) { const t = s.reduced ? 1 : Math.min(1, (now - s.turning.start) / 500); const [ax, ay, az] = s.turning.axis; s.rot = multiply(axisAngle(ax, ay, az, s.turning.angle * ease(t)), s.turning.from); if (t >= 1) s.turning = null; }
    else if (!s.reduced && !s.drag && !props.current.paused) s.rot = spin(s.rot, dt);
    if (!s.reduced && s.intro.edge >= 1) s.messages.tick(dt, props.current.model.edges);
    draw(now);
    if (animating()) s.raf = requestAnimationFrame(frame); else s.last = 0;
  };
  const schedule = () => { const s = state.current; if (!s.raf) s.raf = requestAnimationFrame(frame); };

  useEffect(() => {
    const container = host.current!; const canvas = canvasRef.current!; const s = state.current;
    if (!canvas.getContext('2d')) return;
    s.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; s.started = performance.now(); s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { s.w = container.clientWidth; s.h = container.clientHeight; canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr); canvas.style.width = s.w + 'px'; canvas.style.height = s.h + 'px'; schedule(); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null; observer?.observe(container); size();
    const point = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; const { x, y } = point(event); try { canvas.setPointerCapture(event.pointerId); } catch { /* a synthetic event has no pointer to capture */ } s.drag = { x, y, node: hit(x, y), moved: false }; };
    const move = (event: PointerEvent) => {
      const { x, y } = point(event);
      if (s.drag) { const dx = x - s.drag.x, dy = y - s.drag.y; if (!s.drag.moved && Math.hypot(dx, dy) < 4) return; s.drag.moved = true; s.rot = turn(s.rot, dx * 0.0055, dy * 0.0055); s.drag.x = x; s.drag.y = y; schedule(); return; }
      const index = hit(x, y); if (index !== s.hover) { s.hover = index; canvas.style.cursor = index >= 0 ? 'pointer' : ''; props.current.onHover(index, event.clientX, event.clientY); schedule(); }
    };
    const up = () => { if (!s.drag) return; const drag = s.drag; s.drag = null; if (!drag.moved) props.current.onSelect(drag.node); schedule(); };
    const wheel = (event: WheelEvent) => { event.preventDefault(); s.k = Math.min(9, Math.max(0.6, s.k * Math.exp(-event.deltaY * 0.0016))); schedule(); };
    const leave = () => { if (s.hover !== -1) { s.hover = -1; canvas.style.cursor = ''; props.current.onHover(-1, 0, 0); schedule(); } };
    const key = (event: KeyboardEvent) => { const step = 0.12; if (event.key === 'ArrowLeft') s.rot = turn(s.rot, -step, 0); else if (event.key === 'ArrowRight') s.rot = turn(s.rot, step, 0); else if (event.key === 'ArrowUp') s.rot = turn(s.rot, 0, -step); else if (event.key === 'ArrowDown') s.rot = turn(s.rot, 0, step); else if (event.key === '+' || event.key === '=') s.k = Math.min(9, s.k * 1.2); else if (event.key === '-') s.k = Math.max(0.6, s.k / 1.2); else return; event.preventDefault(); schedule(); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('keydown', key);
    const find = (path: string) => { const { model } = props.current; const i = model.paths.findIndex(p => p === path || p.endsWith('/' + path)); return i >= 0 ? i : model.nodes.findIndex(node => node.name === path); };
    window.__sphere = { ready: true, count: props.current.model.nodes.length, renders: () => s.renders, timing: () => ({ ...s.timing }), camera: () => ({ k: s.k, rot: Array.from(s.rot) }), positions: () => Float32Array.from(props.current.layout.pos), intro: () => ({ ...s.intro }), particles: () => s.messages.live.length, labels: () => s.labels.filter(b => b.x + b.w > 0 && b.x < s.w && b.y + b.h > 0 && b.y < s.h), colors: COLORS, ink: INK,
      screenOf: path => { const i = find(path); if (i < 0 || !s.px.length) return null; const rect = canvas.getBoundingClientRect(); return { x: s.px[i] + rect.left, y: s.py[i] + rect.top, z: s.pz[i] }; },
      selected: () => { const { model, selected } = props.current; return selected < 0 ? '' : model.nodes[selected].members ? model.nodes[selected].name : model.paths[selected] || model.nodes[selected].name; } };
    return () => { observer?.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('keydown', key); delete window.__sphere; };
  }, []);
  useEffect(() => { if (window.__sphere) window.__sphere.count = model.nodes.length; schedule(); }, [model, layout, selected, hovered, paused]);
  // A pick from the tree, the viewer or the search turns that node to the front, over half a second.
  useEffect(() => { const s = state.current; const { layout } = props.current; if (focus.index < 0 || focus.index * 3 >= layout.pos.length) return; const { axis, angle } = toFront(s.rot, layout.pos, focus.index); if (angle < 0.02) return; s.turning = { axis, angle, from: s.rot, start: performance.now() }; schedule(); }, [focus.seq]);

  return <div className="sphere-canvas" ref={host}><canvas ref={canvasRef} tabIndex={0} role="img" aria-label="Your workspace as a globe: every note, skill, routine, memory, application and folder, with images and code grouped by folder. Drag to turn it, scroll to zoom, arrow keys turn it too, click a node to open it."/></div>;
}
