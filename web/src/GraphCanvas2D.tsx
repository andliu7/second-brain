// The home page's flat view: the same grouped graph as the globe, laid out by a force simulation
// (lib/force.ts) the way Obsidian's graph view is, with each colour pulled into its own clump. It
// takes the globe's props, so one selection, one hover and one detail panel serve both views.
//
// The simulation runs a few milliseconds per animation frame until it settles, then the loop stops
// and frames come only on demand (a drag, a wheel, a hover, new props), so an idle graph costs no
// CPU. Under prefers-reduced-motion it settles in one go before the first frame and is drawn once.
// The camera is a pan (tx, ty) and a zoom (k): screen = world * k + t. Zoomed out, the labels are
// skipped and the links dimmed, which is what keeps a few thousand nodes inside the frame budget.
import { useEffect, useRef } from 'react';
import { colorOf, type Model } from './lib/network';
import { createForce, settle, settled, tick, type Force } from './lib/force';
import { buildGrid, hitGrid } from './lib/sphere';
import { INK } from './SphereCanvas';

type Props = { model: Model; selected: number; hovered: number; onSelect: (index: number) => void; onHover: (index: number, x: number, y: number) => void; focus: { index: number; seq: number }; fitSeq: number };
const FONT = '"Instrument Sans Variable", sans-serif';
const LABEL_ZOOM = 0.9; // below this zoom only the focused neighbourhood is named
const FRAME_MS = 8; // simulation time per animation frame while it is still moving
const MIN_K = 0.03, MAX_K = 12;

declare global { interface Window { __graph2d?: { ready: boolean; renders: () => number; settled: () => boolean; steps: () => number; camera: () => { k: number; tx: number; ty: number }; screenOf: (name: string) => { x: number; y: number } | null } } }

export function GraphCanvas2D({ model, selected, hovered, onSelect, onHover, focus, fitSeq }: Props) {
  const host = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ w: 0, h: 0, dpr: 1, k: 1, tx: 0, ty: 0, sim: null as Force | null, degree: new Int32Array(0), byDegree: [] as number[], px: new Float32Array(0), py: new Float32Array(0), pz: new Float32Array(0), grid: new Map<number, number[]>(), raf: 0, reduced: false, touched: false, renders: 0, hover: -1, pointers: new Map<number, { x: number; y: number }>(), drag: null as null | { x: number; y: number; node: number; moved: boolean }, pinch: null as null | { d: number; k: number; tx: number; ty: number; mx: number; my: number } });
  const props = useRef({ model, selected, hovered, onSelect, onHover }); props.current = { model, selected, hovered, onSelect, onHover };

  // A node's size grows with how many links it has, as in Obsidian: a hub reads as a hub.
  const worldRadius = (i: number) => 3 + Math.min(9, Math.sqrt(state.current.degree[i] || 0) * 1.8);
  const radius = (i: number) => Math.max(1.5, worldRadius(i) * state.current.k);

  // Frame the whole graph, with a margin, in the canvas.
  function fit() {
    const s = state.current; const sim = s.sim; if (!sim || !sim.n || !s.w || !s.h) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < sim.n; i++) { x0 = Math.min(x0, sim.x[i]); x1 = Math.max(x1, sim.x[i]); y0 = Math.min(y0, sim.y[i]); y1 = Math.max(y1, sim.y[i]); }
    const pad = 60; s.k = Math.min(3, Math.max(MIN_K, Math.min((s.w - 2 * pad) / Math.max(1, x1 - x0), (s.h - 2 * pad) / Math.max(1, y1 - y0))));
    s.tx = s.w / 2 - (x0 + x1) / 2 * s.k; s.ty = s.h / 2 - (y0 + y1) / 2 * s.k;
  }
  // Zoom by `factor` keeping the world point under (mx, my) where it is on screen.
  function zoomAt(mx: number, my: number, k: number, from = { k: state.current.k, tx: state.current.tx, ty: state.current.ty }) {
    const s = state.current; const next = Math.min(MAX_K, Math.max(MIN_K, k));
    s.tx = mx - (mx - from.tx) * next / from.k; s.ty = my - (my - from.ty) * next / from.k; s.k = next; s.touched = true;
  }
  const hit = (x: number, y: number) => { const s = state.current; return s.px.length ? hitGrid(s.grid, s.px, s.py, s.pz, radius, x, y, 7) : -1; };

  function draw() {
    const s = state.current; const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); const sim = s.sim;
    if (!canvas || !ctx || !s.w || !s.h || !sim) return;
    const { model, selected, hovered } = props.current; const nodes = model.nodes; const n = Math.min(sim.n, nodes.length); const { w, h, k, tx, ty, dpr } = s;
    if (s.px.length !== n) { s.px = new Float32Array(n); s.py = new Float32Array(n); s.pz = new Float32Array(n); }
    const { px, py } = s; for (let i = 0; i < n; i++) { px[i] = sim.x[i] * k + tx; py[i] = sim.y[i] * k + ty; }
    s.grid = buildGrid(px, py, n);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); // clear: the sky behind is .home's glow, as for the globe
    const focusNode = hovered >= 0 && hovered < n ? hovered : selected >= 0 && selected < n ? selected : -1;
    const near = new Set<number>(); if (focusNode >= 0) { for (const q of model.linksOut[focusNode]) near.add(q); for (const q of model.linksIn[focusNode]) near.add(q); }
    const out = (i: number) => px[i] < -40 || px[i] > w + 40 || py[i] < -40 || py[i] > h + 40;
    // The links, one path. Zoomed out they are a faint texture; a focused node dims the rest further.
    ctx.lineWidth = 1; ctx.strokeStyle = `rgba(178,190,228,${focusNode >= 0 ? 0.05 : k < 0.4 ? 0.07 : 0.16})`; ctx.beginPath();
    for (const [a, b] of model.edges) { if (a >= n || b >= n || a < 0 || b < 0 || a === focusNode || b === focusNode || (out(a) && out(b))) continue; ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); }
    ctx.stroke();
    if (focusNode >= 0) { ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(233,174,142,0.85)'; ctx.beginPath(); for (const q of near) { if (q >= n) continue; ctx.moveTo(px[focusNode], py[focusNode]); ctx.lineTo(px[q], py[q]); } ctx.stroke(); }
    // The dots, one path per colour and dim step, as on the globe.
    const byFill = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { if (out(i)) continue; const key = colorOf(nodes[i]) + '|' + (focusNode >= 0 && i !== focusNode && !near.has(i) ? 0.25 : 1); const list = byFill.get(key); if (list) list.push(i); else byFill.set(key, [i]); }
    for (const [key, list] of byFill) { const [color, a] = key.split('|'); ctx.fillStyle = color; ctx.globalAlpha = Number(a); ctx.beginPath(); for (const i of list) { const r = radius(i); ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, 6.2832); } ctx.fill(); }
    ctx.globalAlpha = 1;
    // Names: the focused node and its neighbours always; everything else only zoomed in, most linked
    // first, each placed only where no earlier name sits, and never more than 200 a frame.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = INK.halo;
    const placed: [number, number, number, number][] = [];
    const label = (i: number, size: number, ink: string) => {
      if (out(i)) return; const font = `${i === focusNode ? '600 ' : ''}${size}px ${FONT}`; ctx.font = font;
      const name = nodes[i].name.length > 40 ? nodes[i].name.slice(0, 39) + '…' : nodes[i].name; const bw = ctx.measureText(name).width + 6, bh = size + 4;
      const x = px[i] - bw / 2, y = py[i] + radius(i) + 2;
      if (placed.some(([qx, qy, qw, qh]) => !(x + bw < qx || qx + qw < x || y + bh < qy || qy + qh < y))) return;
      placed.push([x, y, bw, bh]); ctx.strokeText(name, px[i], y + 2); ctx.fillStyle = ink; ctx.fillText(name, px[i], y + 2);
    };
    if (focusNode >= 0) { label(focusNode, 12.5, INK.focus); let count = 0; for (const q of near) if (q < n && count++ < 60) label(q, 11, INK.near); }
    if (selected >= 0 && selected < n && selected !== focusNode) label(selected, 12, INK.focus);
    if (k >= LABEL_ZOOM && focusNode < 0) { let tried = 0; for (const i of s.byDegree) { if (placed.length >= 200 || tried >= 600) break; if (i >= n || out(i)) continue; tried++; label(i, 11, INK.label); } }
    if (selected >= 0 && selected < n) { ctx.strokeStyle = '#e9ae8e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px[selected], py[selected], radius(selected) + 4, 0, 6.2832); ctx.stroke(); }
    s.renders++;
  }

  // The clock: a few milliseconds of simulation, then one frame, until the layout settles. While
  // the reader has not moved the camera it keeps the growing graph framed.
  const frame = () => {
    const s = state.current; s.raf = 0; const sim = s.sim;
    if (sim && !settled(sim)) { const until = performance.now() + FRAME_MS; do tick(sim); while (!settled(sim) && performance.now() < until); if (!s.touched) fit(); }
    draw();
    if (sim && !settled(sim)) s.raf = requestAnimationFrame(frame);
  };
  const schedule = () => { const s = state.current; if (!s.raf) s.raf = requestAnimationFrame(frame); };

  useEffect(() => {
    const container = host.current!; const canvas = canvasRef.current!; const s = state.current;
    if (!canvas.getContext('2d')) return;
    s.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { const first = !s.w; s.w = container.clientWidth; s.h = container.clientHeight; canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr); canvas.style.width = s.w + 'px'; canvas.style.height = s.h + 'px'; if (first || !s.touched) fit(); schedule(); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null; observer?.observe(container); size();
    const point = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    // Two pointers down is a pinch: the zoom follows the change in their distance, about their midpoint.
    const pinchFrom = () => { const [a, b] = [...s.pointers.values()]; s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: s.k, tx: s.tx, ty: s.ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; s.drag = null; };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return; const at = point(event); s.pointers.set(event.pointerId, at);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
      if (s.pointers.size === 2) pinchFrom(); else if (s.pointers.size === 1) s.drag = { ...at, node: hit(at.x, at.y), moved: false };
    };
    const move = (event: PointerEvent) => {
      const at = point(event);
      if (s.pointers.has(event.pointerId)) s.pointers.set(event.pointerId, at);
      if (s.pinch && s.pointers.size >= 2) { const [a, b] = [...s.pointers.values()]; const p = s.pinch; zoomAt(p.mx, p.my, p.k * Math.hypot(a.x - b.x, a.y - b.y) / p.d, p); schedule(); return; }
      if (s.drag) { const dx = at.x - s.drag.x, dy = at.y - s.drag.y; if (!s.drag.moved && Math.hypot(dx, dy) < 4) return; s.drag.moved = true; s.tx += dx; s.ty += dy; s.drag.x = at.x; s.drag.y = at.y; s.touched = true; schedule(); return; }
      const index = hit(at.x, at.y); if (index !== s.hover) { s.hover = index; canvas.style.cursor = index >= 0 ? 'pointer' : ''; props.current.onHover(index, event.clientX, event.clientY); schedule(); }
    };
    const up = (event: PointerEvent) => {
      s.pointers.delete(event.pointerId); if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
      if (!s.drag) return; const drag = s.drag; s.drag = null; if (!drag.moved) props.current.onSelect(drag.node); schedule();
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); const at = point(event); zoomAt(at.x, at.y, s.k * Math.exp(-event.deltaY * 0.0016)); schedule(); };
    const leave = () => { if (s.hover !== -1) { s.hover = -1; canvas.style.cursor = ''; props.current.onHover(-1, 0, 0); schedule(); } };
    const key = (event: KeyboardEvent) => {
      const step = 40;
      if (event.key === 'ArrowLeft') s.tx += step; else if (event.key === 'ArrowRight') s.tx -= step; else if (event.key === 'ArrowUp') s.ty += step; else if (event.key === 'ArrowDown') s.ty -= step;
      else if (event.key === '+' || event.key === '=') zoomAt(s.w / 2, s.h / 2, s.k * 1.2); else if (event.key === '-') zoomAt(s.w / 2, s.h / 2, s.k / 1.2); else return;
      s.touched = true; event.preventDefault(); schedule();
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('keydown', key);
    window.__graph2d = { ready: true, renders: () => s.renders, settled: () => !!s.sim && settled(s.sim), steps: () => s.sim?.steps ?? 0, camera: () => ({ k: s.k, tx: s.tx, ty: s.ty }),
      screenOf: name => { const i = props.current.model.nodes.findIndex(node => node.name === name); if (i < 0 || !s.sim) return null; const rect = canvas.getBoundingClientRect(); return { x: s.sim.x[i] * s.k + s.tx + rect.left, y: s.sim.y[i] * s.k + s.ty + rect.top }; } };
    return () => { observer?.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('keydown', key); delete window.__graph2d; };
  }, []);

  // A new graph: a new simulation, seeded so the same graph lands the same way. Each colour is a
  // group for the colour force; the degree sizes the dots and orders the names.
  useEffect(() => {
    const s = state.current; const colours = new Map<string, number>();
    const group = model.nodes.map(node => { const c = colorOf(node); if (!colours.has(c)) colours.set(c, colours.size); return colours.get(c)!; });
    s.sim = createForce(model.nodes.length, model.edges, group, 7); s.touched = false;
    s.degree = Int32Array.from(model.nodes, (_, i) => model.linksIn[i].length + model.linksOut[i].length);
    s.byDegree = model.nodes.map((_, i) => i).sort((a, b) => s.degree[b] - s.degree[a] || a - b);
    if (s.reduced) { settle(s.sim); fit(); }
    cancelAnimationFrame(s.raf); s.raf = 0; schedule();
  }, [model]);
  useEffect(() => { schedule(); }, [selected, hovered]);
  // A pick from the tree, the search or a category centres that node, without animating the camera.
  useEffect(() => { const s = state.current; const sim = s.sim; if (!sim || focus.index < 0 || focus.index >= sim.n) return; s.tx = s.w / 2 - sim.x[focus.index] * s.k; s.ty = s.h / 2 - sim.y[focus.index] * s.k; s.touched = true; schedule(); }, [focus.seq]);
  // The Fit button (Home.tsx) frames the whole graph again.
  useEffect(() => { if (!fitSeq) return; state.current.touched = false; fit(); schedule(); }, [fitSeq]);

  return <div className="sphere-canvas" ref={host}><canvas ref={canvasRef} tabIndex={0} role="img" aria-label="Your workspace as a flat graph: every node coloured by its source and sized by its links, same colours clustered together. Drag to pan, scroll or pinch to zoom, arrow keys pan too, click a node to open it."/></div>;
}
