// The home page's flat view: the same grouped graph as the globe, laid out as labelled clusters of
// rings (lib/clusters.ts): each area or project is a hub with its members on a circle round it,
// the Skills a circle of skills, and the clusters packed side by side, most linked nearest. It
// takes the globe's props, so one selection, one hover and one detail panel serve both views.
//
// The layout is computed once per graph, with no simulation, so there is no clock at all: a frame
// is drawn only on demand (a drag, a wheel, a hover, new props), an idle graph costs no CPU, and
// reduced motion draws once. The camera is a pan (tx, ty) and a zoom (k): screen = world * k + t.
// At rest only the category names show, one per cluster in its colour; a node's own name appears
// when it or a neighbour is hovered, or when it is selected. A click on a category name zooms to
// that cluster.
import { useEffect, useRef } from 'react';
import { colorOf, type Model } from './lib/network';
import { clusterLayout, type ClusterLayout } from './lib/clusters';
import { buildGrid, hitGrid } from './lib/sphere';
import { INK } from './SphereCanvas';

type Props = { model: Model; selected: number; hovered: number; onSelect: (index: number) => void; onHover: (index: number, x: number, y: number) => void; focus: { index: number; seq: number }; fitSeq: number };
type Label = { cluster: number; x: number; y: number; w: number; h: number };
const FONT = '"Instrument Sans Variable", sans-serif';
const MIN_K = 0.03, MAX_K = 12;
const LABEL_LIFT = 10; // screen pixels between a cluster's outer ring and its name

declare global { interface Window { __graph2d?: { ready: boolean; renders: () => number; settled: () => boolean; camera: () => { k: number; tx: number; ty: number }; screenOf: (name: string) => { x: number; y: number } | null; labelOf: (name: string) => { x: number; y: number } | null } } }

export function GraphCanvas2D({ model, selected, hovered, onSelect, onHover, focus, fitSeq }: Props) {
  const host = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ w: 0, h: 0, dpr: 1, k: 1, tx: 0, ty: 0, lay: null as ClusterLayout | null, hubs: new Uint8Array(0), degree: new Int32Array(0), px: new Float32Array(0), py: new Float32Array(0), pz: new Float32Array(0), grid: new Map<number, number[]>(), labels: [] as Label[], raf: 0, touched: false, renders: 0, hover: -1, hoverLabel: -1, pointers: new Map<number, { x: number; y: number }>(), drag: null as null | { x: number; y: number; node: number; label: number; moved: boolean }, pinch: null as null | { d: number; k: number; tx: number; ty: number; mx: number; my: number } });
  const props = useRef({ model, selected, hovered, onSelect, onHover }); props.current = { model, selected, hovered, onSelect, onHover };

  // A hub (an area or project) is the biggest dot; a member grows a little with its links, capped
  // under half the ring spacing (lib/clusters.ts SPACING) so neighbours on a ring never touch.
  const worldRadius = (i: number) => state.current.hubs[i] ? 9 : 3 + Math.min(5, Math.sqrt(state.current.degree[i] || 0) * 1.5);
  const radius = (i: number) => Math.max(1.5, worldRadius(i) * state.current.k);

  // Frame a world box, with a margin, capped at zoom `most` so a small cluster is not blown up.
  function frameBox(x0: number, y0: number, x1: number, y1: number, most: number) {
    const s = state.current; if (!s.w || !s.h) return;
    const pad = 60; s.k = Math.min(most, Math.max(MIN_K, Math.min((s.w - 2 * pad) / Math.max(1, x1 - x0), (s.h - 2 * pad) / Math.max(1, y1 - y0))));
    s.tx = s.w / 2 - (x0 + x1) / 2 * s.k; s.ty = s.h / 2 - (y0 + y1) / 2 * s.k;
  }
  // The whole graph: every cluster's outer ring, with room above each for its name.
  function fit() {
    const lay = state.current.lay; if (!lay || !lay.clusters.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of lay.clusters) { x0 = Math.min(x0, c.x - c.radius); x1 = Math.max(x1, c.x + c.radius); y0 = Math.min(y0, c.y - c.radius - 30); y1 = Math.max(y1, c.y + c.radius); }
    frameBox(x0, y0, x1, y1, 3);
  }
  function fitCluster(index: number) {
    const c = state.current.lay?.clusters[index]; if (!c) return;
    frameBox(c.x - c.radius - 12, c.y - c.radius - 40, c.x + c.radius + 12, c.y + c.radius + 12, 4); state.current.touched = true;
  }
  // Zoom to `k` keeping the world point under (mx, my) where it is on screen.
  function zoomAt(mx: number, my: number, k: number, from = { k: state.current.k, tx: state.current.tx, ty: state.current.ty }) {
    const s = state.current; const next = Math.min(MAX_K, Math.max(MIN_K, k));
    s.tx = mx - (mx - from.tx) * next / from.k; s.ty = my - (my - from.ty) * next / from.k; s.k = next; s.touched = true;
  }
  const hit = (x: number, y: number) => { const s = state.current; return s.px.length ? hitGrid(s.grid, s.px, s.py, s.pz, radius, x, y, 7) : -1; };
  const hitLabel = (x: number, y: number) => { const found = state.current.labels.find(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h); return found ? found.cluster : -1; };

  function draw() {
    const s = state.current; const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); const lay = s.lay;
    if (!canvas || !ctx || !s.w || !s.h || !lay) return;
    const { model, selected, hovered } = props.current; const nodes = model.nodes; const n = Math.min(lay.x.length, nodes.length); const { w, h, k, tx, ty, dpr } = s;
    if (s.px.length !== n) { s.px = new Float32Array(n); s.py = new Float32Array(n); s.pz = new Float32Array(n); }
    const { px, py } = s; for (let i = 0; i < n; i++) { px[i] = lay.x[i] * k + tx; py[i] = lay.y[i] * k + ty; }
    s.grid = buildGrid(px, py, n);
    const cx = (c: number) => lay.clusters[c].x * k + tx, cy = (c: number) => lay.clusters[c].y * k + ty;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); // clear: the sky behind is .home's glow, as for the globe
    const focusNode = hovered >= 0 && hovered < n ? hovered : selected >= 0 && selected < n ? selected : -1;
    const near = new Set<number>(); if (focusNode >= 0) { for (const q of model.linksOut[focusNode]) near.add(q); for (const q of model.linksIn[focusNode]) near.add(q); }
    const out = (i: number) => px[i] < -40 || px[i] > w + 40 || py[i] < -40 || py[i] > h + 40;
    // The rings themselves, faint in the cluster's colour, so a cluster reads as a circle even
    // where its members are few.
    ctx.lineWidth = 1; ctx.globalAlpha = 0.14;
    lay.clusters.forEach((c, index) => { ctx.strokeStyle = c.color; ctx.beginPath(); for (const r of c.radii) { ctx.moveTo(cx(index) + r * k, cy(index)); ctx.arc(cx(index), cy(index), r * k, 0, 6.2832); } ctx.stroke(); });
    ctx.globalAlpha = 1;
    // A link bends: inside a cluster it curves in toward the hub, so it stays inside the ring;
    // between clusters it bends through the midpoint of the two centres, so the links between
    // two clusters gather into one soft band instead of a hatch of straight lines.
    const curve = (a: number, b: number) => {
      const p = lay.clusterOf[a], q = lay.clusterOf[b]; ctx.moveTo(px[a], py[a]);
      if (p === q && p >= 0) ctx.quadraticCurveTo((px[a] + px[b]) / 4 + cx(p) / 2, (py[a] + py[b]) / 4 + cy(p) / 2, px[b], py[b]);
      else if (p >= 0 && q >= 0) ctx.quadraticCurveTo((cx(p) + cx(q)) / 2, (cy(p) + cy(q)) / 2, px[b], py[b]);
      else ctx.lineTo(px[b], py[b]);
    };
    const inside: number[] = [], across: number[] = []; // pairs, flat: a, b, a, b
    for (const [a, b] of model.edges) { if (a >= n || b >= n || a < 0 || b < 0 || a === focusNode || b === focusNode || (out(a) && out(b))) continue; (lay.clusterOf[a] === lay.clusterOf[b] ? inside : across).push(a, b); }
    ctx.strokeStyle = `rgba(178,190,228,${focusNode >= 0 ? 0.06 : 0.2})`; ctx.beginPath(); for (let e = 0; e < inside.length; e += 2) curve(inside[e], inside[e + 1]); ctx.stroke();
    ctx.strokeStyle = `rgba(178,190,228,${focusNode >= 0 ? 0.03 : 0.07})`; ctx.beginPath(); for (let e = 0; e < across.length; e += 2) curve(across[e], across[e + 1]); ctx.stroke();
    if (focusNode >= 0) { ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(233,174,142,0.85)'; ctx.beginPath(); for (const q of near) if (q < n) curve(focusNode, q); ctx.stroke(); }
    // The dots, one path per colour and dim step, as on the globe.
    const byFill = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { if (out(i)) continue; const key = colorOf(nodes[i]) + '|' + (focusNode >= 0 && i !== focusNode && !near.has(i) ? 0.25 : 1); const list = byFill.get(key); if (list) list.push(i); else byFill.set(key, [i]); }
    for (const [key, list] of byFill) { const [color, a] = key.split('|'); ctx.fillStyle = color; ctx.globalAlpha = Number(a); ctx.beginPath(); for (const i of list) { const r = radius(i); ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, 6.2832); } ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK.halo;
    // Category names, always: centred just above each cluster's outer ring, in its colour. Their
    // boxes are kept for the pointer, since a click on one zooms to that cluster. While a node is
    // focused the other clusters' names step back.
    s.labels = []; ctx.textBaseline = 'bottom'; ctx.lineWidth = 4;
    lay.clusters.forEach((c, index) => {
      const x = cx(index), y = cy(index) - c.radius * k - LABEL_LIFT; if (x < -200 || x > w + 200 || y < -20 || y > h + 60) return;
      const size = index === s.hoverLabel ? 15 : 14; ctx.font = `600 ${size}px ${FONT}`;
      const name = c.name.length > 32 ? c.name.slice(0, 31) + '…' : c.name; const bw = ctx.measureText(name).width + 8;
      s.labels.push({ cluster: index, x: x - bw / 2, y: y - size - 4, w: bw, h: size + 6 });
      ctx.globalAlpha = focusNode >= 0 && lay.clusterOf[focusNode] !== index ? 0.45 : 1;
      ctx.strokeText(name, x, y); ctx.fillStyle = c.color; ctx.fillText(name, x, y);
    });
    ctx.globalAlpha = 1;
    // Node names only for the focused node, its neighbours and the selection, each placed only
    // where no earlier name sits.
    ctx.textBaseline = 'top'; ctx.lineWidth = 3.5;
    const placed: [number, number, number, number][] = s.labels.map(l => [l.x, l.y, l.w, l.h]);
    const label = (i: number, size: number, ink: string) => {
      if (out(i)) return; ctx.font = `${i === focusNode ? '600 ' : ''}${size}px ${FONT}`;
      const name = nodes[i].name.length > 40 ? nodes[i].name.slice(0, 39) + '…' : nodes[i].name; const bw = ctx.measureText(name).width + 6, bh = size + 4;
      const x = px[i] - bw / 2, y = py[i] + radius(i) + 2;
      if (i !== focusNode && placed.some(([qx, qy, qw, qh]) => !(x + bw < qx || qx + qw < x || y + bh < qy || qy + qh < y))) return;
      placed.push([x, y, bw, bh]); ctx.strokeText(name, px[i], y + 2); ctx.fillStyle = ink; ctx.fillText(name, px[i], y + 2);
    };
    if (focusNode >= 0) { label(focusNode, 12.5, INK.focus); let count = 0; for (const q of near) if (q < n && count++ < 60) label(q, 11, INK.near); }
    if (selected >= 0 && selected < n && selected !== focusNode) label(selected, 12, INK.focus);
    if (selected >= 0 && selected < n) { ctx.strokeStyle = '#e9ae8e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px[selected], py[selected], radius(selected) + 4, 0, 6.2832); ctx.stroke(); }
    s.renders++;
  }

  const frame = () => { state.current.raf = 0; draw(); };
  const schedule = () => { const s = state.current; if (!s.raf) s.raf = requestAnimationFrame(frame); };

  useEffect(() => {
    const container = host.current!; const canvas = canvasRef.current!; const s = state.current;
    if (!canvas.getContext('2d')) return;
    s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { const first = !s.w; s.w = container.clientWidth; s.h = container.clientHeight; canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr); canvas.style.width = s.w + 'px'; canvas.style.height = s.h + 'px'; if (first || !s.touched) fit(); schedule(); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null; observer?.observe(container); size();
    const point = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    // Two pointers down is a pinch: the zoom follows the change in their distance, about their midpoint.
    const pinchFrom = () => { const [a, b] = [...s.pointers.values()]; s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: s.k, tx: s.tx, ty: s.ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; s.drag = null; };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return; const at = point(event); s.pointers.set(event.pointerId, at);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
      if (s.pointers.size === 2) pinchFrom(); else if (s.pointers.size === 1) { const label = hitLabel(at.x, at.y); s.drag = { ...at, label, node: label >= 0 ? -1 : hit(at.x, at.y), moved: false }; }
    };
    const move = (event: PointerEvent) => {
      const at = point(event);
      if (s.pointers.has(event.pointerId)) s.pointers.set(event.pointerId, at);
      if (s.pinch && s.pointers.size >= 2) { const [a, b] = [...s.pointers.values()]; const p = s.pinch; zoomAt(p.mx, p.my, p.k * Math.hypot(a.x - b.x, a.y - b.y) / p.d, p); schedule(); return; }
      if (s.drag) { const dx = at.x - s.drag.x, dy = at.y - s.drag.y; if (!s.drag.moved && Math.hypot(dx, dy) < 4) return; s.drag.moved = true; s.tx += dx; s.ty += dy; s.drag.x = at.x; s.drag.y = at.y; s.touched = true; schedule(); return; }
      const label = hitLabel(at.x, at.y); const index = label >= 0 ? -1 : hit(at.x, at.y);
      if (label !== s.hoverLabel) { s.hoverLabel = label; schedule(); }
      canvas.style.cursor = index >= 0 || label >= 0 ? 'pointer' : '';
      if (index !== s.hover) { s.hover = index; props.current.onHover(index, event.clientX, event.clientY); schedule(); }
    };
    const up = (event: PointerEvent) => {
      s.pointers.delete(event.pointerId); if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
      if (!s.drag) return; const drag = s.drag; s.drag = null;
      if (!drag.moved) { if (drag.label >= 0) fitCluster(drag.label); else props.current.onSelect(drag.node); }
      schedule();
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); const at = point(event); zoomAt(at.x, at.y, s.k * Math.exp(-event.deltaY * 0.0016)); schedule(); };
    const leave = () => { if (s.hoverLabel !== -1) { s.hoverLabel = -1; schedule(); } if (s.hover !== -1) { s.hover = -1; canvas.style.cursor = ''; props.current.onHover(-1, 0, 0); schedule(); } };
    const key = (event: KeyboardEvent) => {
      const step = 40;
      if (event.key === 'ArrowLeft') s.tx += step; else if (event.key === 'ArrowRight') s.tx -= step; else if (event.key === 'ArrowUp') s.ty += step; else if (event.key === 'ArrowDown') s.ty -= step;
      else if (event.key === '+' || event.key === '=') zoomAt(s.w / 2, s.h / 2, s.k * 1.2); else if (event.key === '-') zoomAt(s.w / 2, s.h / 2, s.k / 1.2); else return;
      s.touched = true; event.preventDefault(); schedule();
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('keydown', key);
    const rectOf = () => canvas.getBoundingClientRect();
    window.__graph2d = { ready: true, renders: () => s.renders, settled: () => !!s.lay, camera: () => ({ k: s.k, tx: s.tx, ty: s.ty }),
      screenOf: name => { const i = props.current.model.nodes.findIndex(node => node.name === name); if (i < 0 || !s.lay) return null; const rect = rectOf(); return { x: s.lay.x[i] * s.k + s.tx + rect.left, y: s.lay.y[i] * s.k + s.ty + rect.top }; },
      labelOf: name => { const l = s.labels.find(item => s.lay?.clusters[item.cluster].name === name); if (!l) return null; const rect = rectOf(); return { x: l.x + l.w / 2 + rect.left, y: l.y + l.h / 2 + rect.top }; } };
    return () => { observer?.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('keydown', key); delete window.__graph2d; };
  }, []);

  // A new graph: a new layout (it is pure, so the same graph lands the same way), the hubs to
  // draw large, and the degree that sizes the other dots.
  useEffect(() => {
    const s = state.current; s.lay = clusterLayout(model); s.touched = false;
    s.hubs = new Uint8Array(model.nodes.length); for (const c of s.lay.clusters) if (c.hub >= 0) s.hubs[c.hub] = 1;
    s.degree = Int32Array.from(model.nodes, (_, i) => model.linksIn[i].length + model.linksOut[i].length);
    fit(); cancelAnimationFrame(s.raf); s.raf = 0; schedule();
  }, [model]);
  useEffect(() => { schedule(); }, [selected, hovered]);
  // A pick from the tree, the search or a category centres that node, without animating the camera.
  useEffect(() => { const s = state.current; const lay = s.lay; if (!lay || focus.index < 0 || focus.index >= lay.x.length) return; s.tx = s.w / 2 - lay.x[focus.index] * s.k; s.ty = s.h / 2 - lay.y[focus.index] * s.k; s.touched = true; schedule(); }, [focus.seq]);
  // The Fit button (Home.tsx) frames the whole graph again.
  useEffect(() => { if (!fitSeq) return; state.current.touched = false; fit(); schedule(); }, [fitSeq]);

  return <div className="sphere-canvas" ref={host}><canvas ref={canvasRef} tabIndex={0} role="img" aria-label="Your workspace as a flat graph: every area and project a named cluster, its files on a ring round it. Drag to pan, scroll or pinch to zoom, arrow keys pan too, click a name to zoom to that cluster, click a node to open it."/></div>;
}
