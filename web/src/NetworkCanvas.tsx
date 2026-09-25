// The map itself: every node of the scene on one 2D canvas, Obsidian-style.
//
// Why a cached bitmap: 13,000 dots and their lines take ~100 ms to rasterise in software, far
// over a frame. So the scene is drawn once into an offscreen canvas twice the viewport, and each
// frame only copies that bitmap at the current pan and zoom (a few ms), redrawing it when the
// camera settles or leaves the cached area. Hover and selection never redraw the scene: they
// dim the bitmap and draw the node's neighbourhood on top, which is a few dozen shapes.
//
// Two bitmaps, not one: the dots and links in the first, the names in the second. A focused node
// dims the first and skips the second entirely, so the map reads as two tiers (the node and its
// neighbours, then everything else evenly dimmed) instead of a field of half-legible names.
import { useEffect, useRef } from 'react';
import { COLORS, colorOf, isFolder, type Model, type Scene } from './lib/network';

type Props = { model: Model; scene: Scene; selected: number; hovered: number; onSelect: (index: number) => void; onHover: (index: number, x: number, y: number) => void; focus: { index: number; seq: number }; sceneKey: string };
type Camera = { tx: number; ty: number; k: number };
// Every painted name carries the dot it belongs to (dx, dy, same coordinates as x and y), so the
// check can measure that a name is anchored to a node on screen rather than pinned to an edge.
export type LabelBox = { name: string; x: number; y: number; w: number; h: number; dx: number; dy: number };
// At rest the links are a faint texture under the dots and names, Obsidian-style; a hover or a
// selection draws the node's own links bright on top (draw), so the web never has to be read whole.
const EDGE_COLORS: Record<string, string> = { link: 'rgba(213,152,124,0.2)', wiki: 'rgba(213,152,124,0.2)', mention: 'rgba(213,152,124,0.12)', skill: 'rgba(217,119,87,0.24)', app: 'rgba(76,143,219,0.2)' };
const BG = '#0d0f12';
// The two label inks and the dim, kept here so the check can read them: every one of them, and
// every node colour in COLORS, clears 4.5:1 against BG.
const INK = { bg: BG, label: '#e6e7ee', dept: '#f2f1ef', near: '#ececf2', focus: '#f2f1ef', dim: 0.72 };
const LABEL_WIDTH = 170; // a long department name is cut with an ellipsis rather than run off the panel
export const INSET = 26; // no label is drawn closer than this to the edge of the map

// A small hook for the gauntlet check: where a node is on screen, what is selected, its colour,
// and the names actually painted in the last frame, so "no label crosses the panel edge" is measured.
declare global { interface Window { __network?: { ready: boolean; count: number; screenOf: (path: string) => { x: number; y: number } | null; camera: () => Camera; renders: () => number; selected: () => string; colorOf: (path: string) => string; colors: Record<string, string>; ink: typeof INK; labels: () => LabelBox[] } } }

// A name wider than the label column is cut, so one long department name cannot run off the map.
export function ellipsis(ctx: CanvasRenderingContext2D, name: string) {
  if (ctx.measureText(name).width <= LABEL_WIDTH) return name;
  let text = name;
  while (text.length > 4 && ctx.measureText(text + '…').width > LABEL_WIDTH) text = text.slice(0, -1);
  return text + '…';
}

export function NetworkCanvas({ model, scene, selected, hovered, onSelect, onHover, focus, sceneKey }: Props) {
  const host = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ cam: { tx: 0, ty: 0, k: 1 } as Camera, fitK: 0.05, cache: null as null | (Camera & { off: HTMLCanvasElement; names: HTMLCanvasElement; w: number; h: number }), grid: new Map<string, number[]>(), w: 0, h: 0, dpr: 1, frame: 0, timer: 0, renders: 0, drag: null as null | { x: number; y: number; node: number; moved: boolean }, hover: -1, cachedLabels: [] as LabelBox[], liveLabels: [] as LabelBox[], view: { dx: 0, dy: 0, sc: 1 } });
  const props = useRef({ model, scene, selected, hovered, onSelect, onHover }); props.current = { model, scene, selected, hovered, onSelect, onHover };

  // The spatial grid answers "which node is under the pointer" without touching all 13,000.
  function buildGrid() { const { scene } = props.current; const grid = new Map<string, number[]>(); for (let p = 0; p < scene.ids.length; p++) { const key = `${Math.floor(scene.x[p] / 40)},${Math.floor(scene.y[p] / 40)}`; const cell = grid.get(key); if (cell) cell.push(p); else grid.set(key, [p]); } state.current.grid = grid; }
  function hit(sx: number, sy: number): number {
    const { cam, grid } = state.current; const { scene } = props.current; const wx = (sx - cam.tx) / cam.k, wy = (sy - cam.ty) / cam.k; const reach = Math.max(7 / cam.k, 4);
    let best = -1, bestDist = Infinity;
    for (let cx = Math.floor((wx - reach) / 40); cx <= Math.floor((wx + reach) / 40); cx++) for (let cy = Math.floor((wy - reach) / 40); cy <= Math.floor((wy + reach) / 40); cy++) {
      for (const p of grid.get(`${cx},${cy}`) || []) { const d = Math.hypot(scene.x[p] - wx, scene.y[p] - wy); if (d <= Math.max(reach, dotRadius(p) / cam.k) && d < bestDist) { bestDist = d; best = p; } }
    }
    return best;
  }
  const dotRadius = (p: number) => props.current.scene.r[p] * Math.min(2.4, Math.max(0.8, Math.sqrt(state.current.cam.k)));

  // Draws the whole scene into the offscreen bitmap for the current camera.
  function renderCache() {
    const s = state.current; const { scene, model } = props.current; const { w, h, dpr, cam } = s; if (!w || !h) return;
    const same = s.cache?.w === w && s.cache.h === h;
    const off = same && s.cache?.off ? s.cache.off : document.createElement('canvas');
    const names = same && s.cache?.names ? s.cache.names : document.createElement('canvas');
    off.width = names.width = Math.round(w * 2 * dpr); off.height = names.height = Math.round(h * 2 * dpr);
    const o = off.getContext('2d'); const n = names.getContext('2d'); if (!o || !n) return;
    o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, off.width, off.height);
    n.setTransform(1, 0, 0, 1, 0, 0); n.clearRect(0, 0, names.width, names.height);
    const ox = cam.tx + w / 2, oy = cam.ty + h / 2; // the viewport sits in the middle of the bitmap
    const left = -ox / cam.k, top = -oy / cam.k, right = (2 * w - ox) / cam.k, bottom = (2 * h - oy) / cam.k;
    const inside = (p: number) => scene.x[p] >= left && scene.x[p] <= right && scene.y[p] >= top && scene.y[p] <= bottom;
    o.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * ox, dpr * oy);
    o.lineWidth = 1 / cam.k; o.strokeStyle = 'rgba(255,255,255,0.055)'; o.beginPath();
    for (let p = 0; p < scene.ids.length; p++) { const q = scene.contains[p]; if (q >= 0 && (inside(p) || inside(q))) { o.moveTo(scene.x[p], scene.y[p]); o.lineTo(scene.x[q], scene.y[q]); } }
    o.stroke();
    const byType = new Map<string, [number, number][]>();
    for (const [pa, pb, t] of scene.edges) { if (!inside(pa) && !inside(pb)) continue; const list = byType.get(t); if (list) list.push([pa, pb]); else byType.set(t, [[pa, pb]]); }
    o.lineWidth = 1.2 / cam.k;
    for (const [type, list] of byType) { o.strokeStyle = EDGE_COLORS[type] || EDGE_COLORS.link; o.beginPath(); for (const [pa, pb] of list) { o.moveTo(scene.x[pa], scene.y[pa]); o.lineTo(scene.x[pb], scene.y[pb]); } o.stroke(); }
    const byColor = new Map<string, number[]>();
    for (let p = 0; p < scene.ids.length; p++) { if (!inside(p)) continue; const c = colorOf(model.nodes[scene.ids[p]]); const list = byColor.get(c); if (list) list.push(p); else byColor.set(c, [p]); }
    for (const [color, list] of byColor) { o.fillStyle = color; o.beginPath(); for (const p of list) { const r = dotRadius(p) / cam.k; o.moveTo(scene.x[p] + r, scene.y[p]); o.arc(scene.x[p], scene.y[p], r, 0, 6.2832); } o.fill(); }
    // Labels, in screen pixels, most important first: departments, then top-level folders, layer
    // nodes and busy folders as you zoom in, files when close. Each is placed only where no earlier
    // label sits, with a dark halo, so names never smear into one another. A department's name
    // sits above its dot, every other name below its own.
    n.setTransform(dpr, 0, 0, dpr, 0, 0); n.textAlign = 'center'; n.textBaseline = 'top'; n.lineJoin = 'round'; n.lineWidth = 3.5; n.strokeStyle = 'rgba(13,15,18,0.95)';
    const want: [number, number, number, string][] = []; // priority, scene index, font size, weight
    for (let p = 0; p < scene.ids.length; p++) {
      if (!inside(p)) continue; const node = model.nodes[scene.ids[p]]; const top = node.parent >= 0 && model.nodes[node.parent].kind === 'dept';
      if (node.kind === 'dept') want.push([0, p, 13, '600 ']);
      else if (node.kind === 'app' || node.kind === 'skill' || node.layer) { if (cam.k >= 0.7) want.push([2, p, 11.5, '500 ']); }
      else if (top && node.kind === 'folder') want.push([1, p, 12, '500 ']);
      else if (isFolder(node)) { if (cam.k >= 2.4 || (cam.k >= 1.3 && model.count[scene.ids[p]] >= 20)) want.push([3, p, 11, '']); }
      else if (cam.k >= 3) want.push([4, p, 10.5, '']);
    }
    want.sort((a, b) => a[0] - b[0]);
    const placed: [number, number, number, number][] = []; const boxes: LabelBox[] = [];
    const free = (x: number, y: number, w2: number, h2: number) => placed.every(([px, py, pw, ph]) => x + w2 < px || px + pw < x || y + h2 < py || py + ph < y);
    // The viewport inside the bitmap, which is twice its size with the viewport in the middle. A
    // name whose node is on screen is kept inside that rectangle, so it never runs off the panel.
    const vx = w / 2, vy = h / 2; const used = new Set<string>();
    for (const [, p, size, weight] of want) {
      if (placed.length >= 700) break;
      const node = model.nodes[scene.ids[p]]; n.font = `${weight}${size}px "DM Sans Variable", sans-serif`;
      // Two files of the same name (a CLAUDE.md in two repos) are told apart by their folder.
      let name = ellipsis(n, node.name);
      if (used.has(name) && node.parent >= 0) name = ellipsis(n, `${node.name} · ${model.nodes[node.parent].name}`);
      used.add(name);
      const width = n.measureText(name).width; const dx = scene.x[p] * cam.k + ox, dy = scene.y[p] * cam.k + oy;
      const boxW = width + 6, boxH = size + 4;
      let boxX = dx - boxW / 2, boxY = dy + (node.kind === 'dept' ? -dotRadius(p) - 5 - size : dotRadius(p) + 2);
      if (dx > vx && dx < vx + w && dy > vy && dy < vy + h) {
        boxX = Math.min(Math.max(boxX, vx + INSET), vx + w - INSET - boxW);
        boxY = Math.min(Math.max(boxY, vy + INSET), vy + h - INSET - boxH);
      }
      if (!free(boxX, boxY, boxW, boxH)) continue;
      placed.push([boxX, boxY, boxW, boxH]); boxes.push({ name, x: boxX, y: boxY, w: boxW, h: boxH, dx, dy });
      n.fillStyle = node.kind === 'dept' ? INK.dept : node.layer ? colorOf(node) : INK.label;
      n.strokeText(name, boxX + boxW / 2, boxY + 1); n.fillText(name, boxX + boxW / 2, boxY + 1);
    }
    s.cachedLabels = boxes;
    s.cache = { off, names, w, h, tx: cam.tx, ty: cam.ty, k: cam.k }; s.renders++;
  }

  // One frame: copy the cached bitmap at the current camera, then the highlighted neighbourhood on top.
  function draw() {
    const s = state.current; const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    const { w, h, dpr, cam } = s; const { scene, model, selected, hovered } = props.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
    if (!s.cache) renderCache();
    const c = s.cache!; const sc = cam.k / c.k; const dx = cam.tx - (w / 2 + c.tx) * sc, dy = cam.ty - (h / 2 + c.ty) * sc;
    s.view = { dx, dy, sc }; s.liveLabels = [];
    ctx.drawImage(c.off, dx, dy, 2 * w * sc, 2 * h * sc);
    // Stale when the viewport reaches the bitmap's edge or the zoom drifted: redraw once the camera settles.
    if (sc < 0.6 || sc > 1.7 || dx > 0 || dy > 0 || dx + 2 * w * sc < w || dy + 2 * h * sc < h) { clearTimeout(s.timer); s.timer = window.setTimeout(() => { renderCache(); draw(); }, 90); }
    const focusNode = hovered >= 0 ? hovered : selected;
    if (focusNode < 0 || scene.at[focusNode] < 0) ctx.drawImage(c.names, dx, dy, 2 * w * sc, 2 * h * sc);
    if (focusNode >= 0 && scene.at[focusNode] >= 0) {
      const p = scene.at[focusNode]; const node = model.nodes[focusNode];
      // One dimmed tier under the neighbourhood: the map's own names are left out of this frame
      // rather than ghosted, so the only names on screen are the ones drawn bright below.
      ctx.fillStyle = `rgba(13,15,18,${INK.dim})`; ctx.fillRect(0, 0, w, h);
      // Links first, then the folder, then the contents: when labels compete for the same pixels, the links keep theirs.
      const near = new Set<number>([...model.linksOut[focusNode], ...model.linksIn[focusNode], ...(node.parent >= 0 ? [node.parent] : []), ...model.children[focusNode].slice(0, 400)]);
      const sx = (q: number) => scene.x[q] * cam.k + cam.tx, sy = (q: number) => scene.y[q] * cam.k + cam.ty;
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath();
      for (const q of near) { if (scene.at[q] < 0) continue; const isLink = model.linksOut[focusNode].includes(q) || model.linksIn[focusNode].includes(q); if (!isLink) { ctx.moveTo(sx(p), sy(p)); ctx.lineTo(sx(scene.at[q]), sy(scene.at[q])); } }
      ctx.stroke(); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(233,174,142,0.85)'; ctx.beginPath();
      for (const q of near) { if (scene.at[q] < 0) continue; const isLink = model.linksOut[focusNode].includes(q) || model.linksIn[focusNode].includes(q); if (isLink) { ctx.moveTo(sx(p), sy(p)); ctx.lineTo(sx(scene.at[q]), sy(scene.at[q])); } }
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      // A label is drawn only where no earlier label sits, so a folder's packed contents never smear
      // into one another. A name belongs to its dot: one whose dot is off screen is not drawn at all
      // (it would float at the edge of the panel with nothing under it), and one whose dot is on
      // screen is nudged inside the map so the edge never cuts it.
      const onScreen = (x: number, y: number) => x >= 0 && x <= w && y >= 0 && y <= h;
      const inside = (x: number, y: number, bw: number, bh: number): [number, number] => [Math.min(Math.max(x, INSET), Math.max(INSET, w - INSET - bw)), Math.min(Math.max(y, INSET), Math.max(INSET, h - INSET - bh))];
      const r = Math.max(4, dotRadius(p)) + 1.5; ctx.font = '600 12.5px "DM Sans Variable", sans-serif';
      const focusName = ellipsis(ctx, node.name); const width = ctx.measureText(focusName).width;
      const shown = onScreen(sx(p), sy(p));
      const [px0, py0] = shown ? inside(sx(p) - width / 2 - 7, sy(p) + r + 2, width + 14, 21) : [sx(p) - width / 2 - 7, sy(p) + r + 2];
      const placed: [number, number, number, number][] = [[px0, py0, width + 14, 21]];
      const free = (x: number, y: number, w2: number, h2: number) => placed.every(([qx, qy, qw, qh]) => x + w2 < qx || qx + qw < x || y + h2 < qy || qy + qh < y);
      ctx.font = '11px "DM Sans Variable", sans-serif'; let labels = 0; const used = new Set<string>([focusName]);
      for (const q of near) { const pq = scene.at[q]; if (pq < 0) continue; const rq = Math.max(2.5, dotRadius(pq)); ctx.fillStyle = colorOf(model.nodes[q]); ctx.beginPath(); ctx.arc(sx(pq), sy(pq), rq, 0, 6.2832); ctx.fill();
        if (labels >= 90 || !onScreen(sx(pq), sy(pq))) continue;
        // Two neighbours of the same name read apart by the folder they live in.
        let name = ellipsis(ctx, model.nodes[q].name);
        if (used.has(name) && model.nodes[q].parent >= 0) name = ellipsis(ctx, `${model.nodes[q].name} · ${model.nodes[model.nodes[q].parent].name}`);
        used.add(name); const tw = ctx.measureText(name).width;
        const [tx, ty] = inside(sx(pq) - tw / 2, sy(pq) + rq + 3, tw, 13);
        if (!free(tx, ty, tw, 13)) continue; placed.push([tx, ty, tw, 13]); labels++; s.liveLabels.push({ name, x: tx, y: ty, w: tw, h: 13, dx: sx(pq), dy: sy(pq) });
        ctx.strokeStyle = 'rgba(13,15,18,0.92)'; ctx.fillStyle = INK.near; ctx.strokeText(name, tx + tw / 2, ty); ctx.fillText(name, tx + tw / 2, ty); }
      ctx.fillStyle = colorOf(node); ctx.beginPath(); ctx.arc(sx(p), sy(p), r, 0, 6.2832); ctx.fill();
      // The focused name sits on a pill, so the lines fanning out below the dot never run through it.
      ctx.font = '600 12.5px "DM Sans Variable", sans-serif';
      ctx.fillStyle = 'rgba(13,15,18,0.94)'; ctx.beginPath(); ctx.roundRect(px0, py0, width + 14, 21, 6); ctx.fill();
      ctx.strokeStyle = colorOf(node); ctx.lineWidth = 1; ctx.globalAlpha = 0.45; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = INK.focus; ctx.fillText(focusName, px0 + width / 2 + 7, py0 + 3);
      if (shown) s.liveLabels.push({ name: focusName, x: px0, y: py0, w: width + 14, h: 21, dx: sx(p), dy: sy(p) });
    }
    if (selected >= 0 && scene.at[selected] >= 0) { const p = scene.at[selected]; ctx.strokeStyle = '#e9ae8e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(scene.x[p] * cam.k + cam.tx, scene.y[p] * cam.k + cam.ty, Math.max(4, dotRadius(p)) + 5, 0, 6.2832); ctx.stroke(); }
  }
  const schedule = () => { const s = state.current; if (s.frame) return; s.frame = requestAnimationFrame(() => { s.frame = 0; draw(); }); };
  const refresh = () => { renderCache(); schedule(); };

  function fitScene() {
    const { scene } = props.current; const s = state.current; if (!scene.ids.length || !s.w) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let p = 0; p < scene.ids.length; p++) { minX = Math.min(minX, scene.x[p]); maxX = Math.max(maxX, scene.x[p]); minY = Math.min(minY, scene.y[p]); maxY = Math.max(maxY, scene.y[p]); }
    // The inset leaves room for the names, which are drawn in screen pixels beside their dots.
    const k = Math.min(3, Math.max(0.05, Math.min((s.w - 150) / (maxX - minX + 1), (s.h - 110) / (maxY - minY + 1))));
    s.cam = { k, tx: s.w / 2 - (minX + maxX) / 2 * k, ty: s.h / 2 - (minY + maxY) / 2 * k }; s.fitK = k;
  }

  useEffect(() => {
    const container = host.current!; const canvas = canvasRef.current!; const s = state.current;
    if (!canvas.getContext('2d')) return;
    s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { s.w = container.clientWidth; s.h = container.clientHeight; canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr); canvas.style.width = s.w + 'px'; canvas.style.height = s.h + 'px'; if (!s.cache) fitScene(); refresh(); };
    const observer = new ResizeObserver(size); observer.observe(container); size();
    const point = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; const { x, y } = point(event); canvas.setPointerCapture(event.pointerId); s.drag = { x, y, node: hit(x, y), moved: false }; };
    const move = (event: PointerEvent) => {
      const { x, y } = point(event);
      if (s.drag) {
        const dx = x - s.drag.x, dy = y - s.drag.y; if (!s.drag.moved && Math.hypot(dx, dy) < 4) return; s.drag.moved = true;
        if (s.drag.node >= 0) { const { scene } = props.current; const p = s.drag.node; scene.x[p] += dx / s.cam.k; scene.y[p] += dy / s.cam.k; clearTimeout(s.timer); s.timer = window.setTimeout(() => { buildGrid(); refresh(); }, 120); }
        else { s.cam.tx += dx; s.cam.ty += dy; }
        s.drag.x = x; s.drag.y = y; schedule(); return;
      }
      const index = hit(x, y); const id = index >= 0 ? props.current.scene.ids[index] : -1;
      if (id !== s.hover) { s.hover = id; props.current.onHover(id, event.clientX, event.clientY); }
    };
    const up = (event: PointerEvent) => { if (!s.drag) return; const drag = s.drag; s.drag = null; if (!drag.moved) props.current.onSelect(drag.node >= 0 ? props.current.scene.ids[drag.node] : -1); else if (drag.node >= 0) { buildGrid(); refresh(); } };
    const wheel = (event: WheelEvent) => { event.preventDefault(); const { x, y } = point(event); const factor = Math.exp(-event.deltaY * 0.0016); const k = Math.min(14, Math.max(0.04, s.cam.k * factor)); const real = k / s.cam.k; s.cam = { k, tx: x - (x - s.cam.tx) * real, ty: y - (y - s.cam.ty) * real }; schedule(); };
    const leave = () => { if (s.hover !== -1) { s.hover = -1; props.current.onHover(-1, 0, 0); } };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerleave', leave);
    const find = (path: string) => { const { model } = props.current; return model.paths.findIndex(p => p === path || p.endsWith('/' + path)); };
    const labels = () => { const { scene, selected, hovered } = props.current; const focusNode = hovered >= 0 ? hovered : selected; const { dx, dy, sc } = s.view;
      const boxes = focusNode >= 0 && scene.at[focusNode] >= 0 ? s.liveLabels : s.cachedLabels.map(b => ({ name: b.name, x: dx + b.x * sc, y: dy + b.y * sc, w: b.w * sc, h: b.h * sc, dx: dx + b.dx * sc, dy: dy + b.dy * sc }));
      return boxes.filter(b => b.x + b.w > 0 && b.x < s.w && b.y + b.h > 0 && b.y < s.h); };
    window.__network = { ready: true, count: props.current.scene.ids.length, camera: () => ({ ...s.cam }), renders: () => s.renders, colors: COLORS, ink: INK, labels, colorOf: path => { const i = find(path); return i < 0 ? '' : colorOf(props.current.model.nodes[i]); }, selected: () => { const { model, selected } = props.current; return selected < 0 ? '' : model.paths[selected] || model.nodes[selected].name; }, screenOf: path => { const { scene } = props.current; const i = find(path); if (i < 0 || scene.at[i] < 0) return null; const rect = canvas.getBoundingClientRect(); const p = scene.at[i]; return { x: scene.x[p] * s.cam.k + s.cam.tx + rect.left, y: scene.y[p] * s.cam.k + s.cam.ty + rect.top }; } };
    return () => { observer.disconnect(); clearTimeout(s.timer); cancelAnimationFrame(s.frame); s.frame = 0; canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerleave', leave); delete window.__network; };
  }, []);
  // A new scene (the local view, or a reload) fits the camera to it and rebuilds the grid and bitmap.
  useEffect(() => { const s = state.current; s.cache = null; buildGrid(); if (s.w) { fitScene(); refresh(); } if (window.__network) window.__network.count = scene.ids.length; }, [sceneKey]);
  useEffect(() => { schedule(); }, [selected, hovered]);
  // Search, a tree row or a link in the viewer: the camera fits the node and its neighbourhood
  // (its folder, contents and links) with room for labels, so every highlighted line ends at a
  // named node on screen. A node with no neighbours in the scene is simply shown close up.
  useEffect(() => {
    const s = state.current; const { scene, model } = props.current; if (focus.index < 0 || scene.at[focus.index] < 0 || !s.w) return;
    const node = model.nodes[focus.index]; const p = scene.at[focus.index];
    const near = [focus.index, ...(node.parent >= 0 ? [node.parent] : []), ...model.children[focus.index].slice(0, 400), ...model.linksOut[focus.index], ...model.linksIn[focus.index]].map(q => scene.at[q]).filter(q => q >= 0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of near) { minX = Math.min(minX, scene.x[q]); maxX = Math.max(maxX, scene.x[q]); minY = Math.min(minY, scene.y[q]); maxY = Math.max(maxY, scene.y[q]); }
    // Never further out than the whole map, never closer than 3x: a note that links across departments is seen with all its links.
    const k = near.length > 1 ? Math.min(3, Math.max(s.fitK, Math.min((s.w - 180) / (maxX - minX + 1), (s.h - 150) / (maxY - minY + 1)))) : 2.6;
    let tx = s.w / 2 - (minX + maxX) / 2 * k, ty = s.h / 2 - (minY + maxY) / 2 * k;
    // The node itself always stays well inside the frame, even when its neighbourhood is wider than the view.
    const nx = scene.x[p] * k + tx, ny = scene.y[p] * k + ty; const margin = 90;
    if (nx < margin) tx += margin - nx; else if (nx > s.w - margin) tx -= nx - (s.w - margin);
    if (ny < margin) ty += margin - ny; else if (ny > s.h - margin) ty -= ny - (s.h - margin);
    s.cam = { k, tx, ty }; refresh();
  }, [focus.seq]);

  return <div className="network-canvas" ref={host}><canvas ref={canvasRef} role="img" aria-label="Map of every file, folder, skill, routine and application. Drag to pan, scroll to zoom, click a node to open it. The file tree beside it offers the same nodes to the keyboard."/></div>;
}
