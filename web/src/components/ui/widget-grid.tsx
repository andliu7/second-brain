// WidgetGrid: a grid of square cells holding widgets of four sizes, rearranged by drag or keyboard.
// Reimplemented from the 21st.dev "Draggable Widget Grid" (2026-09-28): its layout algorithm and
// input handling, none of its demo, data, palette or font. Props:
//   items: the widgets in sequence order, each { id, size }; the owner persists this array
//   editing: dragging, the keyboard moves and the size menus are live only while this is true, so
//            outside edit mode clicks and text selection behave as on any other page
//   onChange(items): the new sequence after a drop, a keyboard move or a size change
//   label(id): the widget's name, for the size menu and the spoken announcements
//   render(item): the widget's content
//
// Layout. A sequence is placed by tile(), an exact tiler: at each step it takes the first empty cell in
// reading order and puts there the earliest remaining widget that fits, backtracking when nothing fits,
// so the grid has no hole before its last widget. tile() may pull a later widget forward to fill a cell,
// so canonical() rewrites the sequence in the order the eye reads it. When no gap-free arrangement
// exists (two wide widgets on three columns), pack() places the sequence as it is, row by row, gaps and all.
//
// Dragging. On pickup, candidatesFor() lays out every position the widget could be dropped at. choose()
// keeps the current candidate while the widget's centre stays inside that candidate's cell, and switches
// only once the centre is ENTER_INSET cells deep inside another. That margin is the hysteresis: the
// layout reflows on every switch, and without it a centre sitting on a boundary would flip back and forth.
// The DOM order never changes, only the positions, so the element being moved keeps focus and its
// Motion drag; aria-posinset carries the visual order for assistive technology instead.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { motion, MotionConfig, useDragControls, useReducedMotion } from 'framer-motion';
import './widget-grid.css';

export type WidgetSize = 'sm' | 'wide' | 'tall' | 'lg';
export type GridItem = { id: string; size: WidgetSize };
export type Placement = { id: string; x: number; y: number; w: number; h: number };
export type Candidate = { order: GridItem[]; placements: Placement[]; rect: Placement };

export const SPANS: Record<WidgetSize, { w: number; h: number }> = { sm: { w: 1, h: 1 }, wide: { w: 2, h: 1 }, tall: { w: 1, h: 2 }, lg: { w: 2, h: 2 } };
export const SIZE_LABELS: Record<WidgetSize, string> = { sm: 'Small, 1 by 1', wide: 'Wide, 2 by 1', tall: 'Tall, 1 by 2', lg: 'Large, 2 by 2' };
export const ENTER_INSET = 0.2;          // cells, see the header
const LONG_PRESS_MS = 350;               // touch and pen wait this long, so a swipe still scrolls the page
const LONG_PRESS_SLOP = 10;              // px a finger may wander before the press counts as a scroll

// A widget wider than the grid is narrowed to fit; its height is kept.
const span = (size: WidgetSize, cols: number) => ({ w: Math.min(SPANS[size].w, cols), h: SPANS[size].h });
// Occupied cells as indexes y * cols + x, which is also reading order.
function fits(taken: Set<number>, x: number, y: number, w: number, h: number, cols: number) {
  if (x + w > cols) return false;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (taken.has((y + dy) * cols + x + dx)) return false;
  return true;
}
function mark(taken: Set<number>, p: Placement, cols: number, on: boolean) {
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) { const cell = (p.y + dy) * cols + p.x + dx; if (on) taken.add(cell); else taken.delete(cell); }
}

// The exact tiler. Widgets of one size are interchangeable for fitting, so at each cell only the
// earliest remaining widget of each size is tried: at most four branches, earliest first, which is
// what keeps the user's order wherever it can. `budget` caps the search; running out counts as failure.
export function tile(items: GridItem[], cols: number, budget = 20000): Placement[] | null {
  const taken = new Set<number>();
  const used = items.map(() => false);
  const out: Placement[] = [];
  let steps = 0;
  const place = (): boolean => {
    if (out.length === items.length) return true;
    if (++steps > budget) return false;
    let at = 0; while (taken.has(at)) at++;
    const x = at % cols, y = Math.floor(at / cols);
    const tried = new Set<WidgetSize>();
    for (let i = 0; i < items.length; i++) {
      if (used[i] || tried.has(items[i].size)) continue;
      tried.add(items[i].size);
      const { w, h } = span(items[i].size, cols);
      if (!fits(taken, x, y, w, h, cols)) continue;
      const p = { id: items[i].id, x, y, w, h };
      used[i] = true; out.push(p); mark(taken, p, cols, true);
      if (place()) return true;
      used[i] = false; out.pop(); mark(taken, p, cols, false);
    }
    return false;
  };
  return place() ? out : null;
}

// The fallback row packer: the sequence as given, each widget at the first cell after the previous
// widget's where it fits. Never reorders, may leave gaps.
export function pack(items: GridItem[], cols: number): Placement[] {
  const taken = new Set<number>();
  let cursor = 0;
  return items.map(item => {
    const { w, h } = span(item.size, cols);
    let at = cursor;
    while (!fits(taken, at % cols, Math.floor(at / cols), w, h, cols)) at++;
    const p = { id: item.id, x: at % cols, y: Math.floor(at / cols), w, h };
    mark(taken, p, cols, true);
    cursor = at + 1;
    return p;
  });
}

// Placements in reading order: top to bottom, then left to right.
export const canonical = (placements: Placement[]) => [...placements].sort((a, b) => a.y - b.y || a.x - b.x);
export const arrange = (items: GridItem[], cols: number) => canonical(tile(items, cols) ?? pack(items, cols));
// The sequence rewritten in the placements' order, so what is saved is what is seen.
export function reorder(items: GridItem[], placements: Placement[]): GridItem[] {
  const byId = new Map(items.map(i => [i.id, i]));
  return placements.map(p => byId.get(p.id)!);
}

const layoutKey = (placements: Placement[]) => placements.map(p => `${p.id}:${p.x},${p.y},${p.w},${p.h}`).join('|');

// Every distinct layout the moving widget can produce: it is inserted at each index of the others'
// sequence and the result arranged. Insertions that arrange identically are kept once.
export function candidatesFor(items: GridItem[], id: string, cols: number): Candidate[] {
  const moving = items.find(i => i.id === id);
  if (!moving) return [];
  const rest = items.filter(i => i.id !== id);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (let i = 0; i <= rest.length; i++) {
    const sequence = [...rest.slice(0, i), moving, ...rest.slice(i)];
    const placements = arrange(sequence, cols);
    const key = layoutKey(placements);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ order: reorder(sequence, placements), placements, rect: placements.find(p => p.id === id)! });
  }
  return out;
}

const inside = (r: Placement, pt: { x: number; y: number }, pad: number) => pt.x >= r.x + pad && pt.x <= r.x + r.w - pad && pt.y >= r.y + pad && pt.y <= r.y + r.h - pad;
// Which candidate a point (in cell units) selects, given the one selected now. See the header.
export function choose(candidates: Candidate[], point: { x: number; y: number }, current: number, inset = ENTER_INSET): number {
  if (current >= 0 && candidates[current] && inside(candidates[current].rect, point, 0)) return current;
  let best = -1, bestDistance = Infinity;
  candidates.forEach((c, i) => {
    if (i === current || !inside(c.rect, point, inset)) return;
    const d = Math.hypot(c.rect.x + c.rect.w / 2 - point.x, c.rect.y + c.rect.h / 2 - point.y);
    if (d < bestDistance) { best = i; bestDistance = d; }
  });
  return best >= 0 ? best : current;
}

export type Direction = 'left' | 'right' | 'up' | 'down';
// The candidate a keyboard move lands on. Left and right step to the nearest position before or after
// in reading order; up and down to the nearest row above or below, then the nearest column.
export function step(candidates: Candidate[], from: Placement, dir: Direction, cols: number): Candidate | null {
  const at = (p: Placement) => p.y * cols + p.x;
  let best: Candidate | null = null, bestScore = Infinity;
  for (const c of candidates) {
    const r = c.rect;
    let score: number;
    if (dir === 'left') score = at(r) < at(from) ? at(from) - at(r) : Infinity;
    else if (dir === 'right') score = at(r) > at(from) ? at(r) - at(from) : Infinity;
    else if (dir === 'up') score = r.y < from.y ? (from.y - r.y) * 100 + Math.abs(r.x - from.x) : Infinity;
    else score = r.y > from.y ? (r.y - from.y) * 100 + Math.abs(r.x - from.x) : Infinity;
    if (score < bestScore) { best = c; bestScore = score; }
  }
  return best;
}

const KEYS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

type Props = { items: GridItem[]; editing: boolean; onChange: (items: GridItem[]) => void; label: (id: string) => string; render: (item: GridItem) => ReactNode; ariaLabel?: string; minCell?: number; maxColumns?: number; gap?: number };
type Drag = { id: string; origin: Placement; candidates: Candidate[]; chosen: number };

export function WidgetGrid({ items, editing, onChange, label, render, ariaLabel = 'Widgets', minCell = 170, maxColumns = 4, gap = 12 }: Props) {
  const box = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);
  // Cells are square: the column count follows the width, and the cell size follows the columns.
  // A ResizeObserver (it reports the element's own size, not the window's) keeps both current.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Width 0 means not measured yet (or a test DOM): assume the widest grid at the smallest cell.
  const cols = width ? Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minCell + gap)))) : maxColumns;
  const cell = width ? (width - gap * (cols - 1)) / cols : minCell;
  const pitch = cell + gap;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  // The DOM order is the order the widgets were first seen in, newcomers appended; see the header.
  const [firstSeen] = useState(() => items.map(i => i.id));
  const domOrder = [...firstSeen.filter(id => items.some(i => i.id === id)), ...items.map(i => i.id).filter(id => !firstSeen.includes(id))];

  const base = arrange(items, cols);
  const shown = drag && drag.chosen >= 0 ? drag.candidates[drag.chosen].placements : base;
  const rows = Math.max(0, ...shown.map(p => p.y + p.h));
  const px = (p: Placement) => ({ left: p.x * pitch, top: p.y * pitch, width: p.w * cell + (p.w - 1) * gap, height: p.h * cell + (p.h - 1) * gap });
  const position = (order: Placement[], id: string) => order.findIndex(p => p.id === id) + 1;
  const announce = (id: string, placements: Placement[]) => setSaid(`${label(id)}, position ${position(placements, id)} of ${placements.length}`);

  function startDrag(id: string) {
    const origin = base.find(p => p.id === id)!;
    const candidates = candidatesFor(items, id, cols);
    const now = layoutKey(base);
    setDrag({ id, origin, candidates, chosen: candidates.findIndex(c => layoutKey(c.placements) === now) });
  }
  // offset is how far the pointer has moved since pickup, in px; the widget's centre is what chooses.
  function moveDrag(offset: { x: number; y: number }) {
    setDrag(d => {
      if (!d) return d;
      const rect = px(d.origin);
      // gap / 2 maps a cell's centre in px to its centre in cell units exactly.
      const point = { x: (rect.left + offset.x + rect.width / 2 + gap / 2) / pitch, y: (rect.top + offset.y + rect.height / 2 + gap / 2) / pitch };
      const chosen = choose(d.candidates, point, d.chosen);
      return chosen === d.chosen ? d : { ...d, chosen };
    });
  }
  function endDrag() {
    if (drag && drag.chosen >= 0) {
      const target = drag.candidates[drag.chosen];
      if (layoutKey(target.placements) !== layoutKey(base)) { onChange(target.order); announce(drag.id, target.placements); }
    }
    setDrag(null);
  }
  function keyMove(id: string, dir: Direction) {
    const from = base.find(p => p.id === id);
    const target = from && step(candidatesFor(items, id, cols), from, dir, cols);
    if (!target) { setSaid(`${label(id)} cannot move ${dir}`); return; }
    onChange(target.order);
    announce(id, target.placements);
  }
  function resize(id: string, size: WidgetSize) {
    const next = items.map(i => i.id === id ? { ...i, size } : i);
    const placements = arrange(next, cols);
    onChange(reorder(next, placements));
    setSaid(`${label(id)} is now ${SIZE_LABELS[size]}`);
  }

  const reduce = useReducedMotion();
  const hint = useId();
  const byId = new Map(items.map(i => [i.id, i]));
  return <MotionConfig reducedMotion="user">
    <div className="wgrid-wrap">
      <ul ref={box} className="wgrid" aria-label={ariaLabel} data-editing={editing || undefined} style={{ height: rows ? rows * pitch - gap : 0 }}>
        {drag && drag.chosen >= 0 && <li className="wgrid-slot" role="presentation" aria-hidden="true" style={px(drag.candidates[drag.chosen].rect)}/>}
        {domOrder.map(id => {
          const item = byId.get(id)!;
          const dragging = drag?.id === id;
          const placement = dragging ? drag.origin : shown.find(p => p.id === id)!;
          return <Cell key={id} item={item} box={px(placement)} editing={editing} dragging={dragging} reduce={!!reduce} posinset={position(base, id)} setsize={items.length} label={label(id)} hint={hint}
            onDragStart={() => startDrag(id)} onDrag={moveDrag} onDragEnd={endDrag} onKey={dir => keyMove(id, dir)} onResize={size => resize(id, size)}>{render(item)}</Cell>;
        })}
      </ul>
      <p className="sr-only" aria-live="polite">{said}</p>
      <p className="sr-only" id={hint}>Drag to move. Alt with an arrow key moves one step. Touch: press and hold, then drag.</p>
    </div>
  </MotionConfig>;
}

type CellProps = { item: GridItem; box: { left: number; top: number; width: number; height: number }; editing: boolean; dragging: boolean; reduce: boolean; posinset: number; setsize: number; label: string; hint: string; onDragStart: () => void; onDrag: (offset: { x: number; y: number }) => void; onDragEnd: () => void; onKey: (dir: Direction) => void; onResize: (size: WidgetSize) => void; children: ReactNode };

// One widget. useDragControls lets the drag start from code (dragListener is off), which is how a mouse
// press starts it at once and a touch press only after LONG_PRESS_MS. The position is animated as
// left/top with a spring; the drag itself moves x/y, which dragSnapToOrigin returns to 0 on release.
function Cell({ item, box, editing, dragging, reduce, posinset, setsize, label, hint, onDragStart, onDrag, onDragEnd, onKey, onResize, children }: CellProps) {
  const controls = useDragControls();
  const el = useRef<HTMLLIElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  // Once a touch drag is under way the page must not scroll with the finger. React's touch listeners
  // are passive, so preventDefault needs a listener added by hand with passive: false.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const stop = (e: TouchEvent) => { if (held.current) e.preventDefault(); };
    node.addEventListener('touchmove', stop, { passive: false });
    return () => node.removeEventListener('touchmove', stop);
  }, []);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  function pointerDown(e: ReactPointerEvent<HTMLLIElement>) {
    if (!editing || (e.target as HTMLElement).closest('select,button,input,textarea,a')) return;
    if (e.pointerType === 'mouse') { if (e.button !== 0) return; e.preventDefault(); controls.start(e); return; }
    const native = e.nativeEvent;
    press.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { press.current = null; held.current = true; controls.start(native); }, LONG_PRESS_MS) };
  }
  function pointerMove(e: ReactPointerEvent<HTMLLIElement>) {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP) cancelPress();
  }
  function keyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (!editing || !e.altKey || e.target !== e.currentTarget || !KEYS[e.key]) return;
    e.preventDefault();
    onKey(KEYS[e.key]);
  }
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 36 };
  return <motion.li ref={el} className={`wgrid-item${dragging ? ' is-dragging' : ''}`} data-size={item.size} aria-posinset={posinset} aria-setsize={setsize}
    tabIndex={editing ? 0 : undefined} aria-label={editing ? label : undefined} aria-describedby={editing ? hint : undefined}
    initial={false} animate={box} transition={spring}
    drag={editing} dragControls={controls} dragListener={false} dragMomentum={false} dragSnapToOrigin
    onDragStart={onDragStart} onDrag={(_, info) => onDrag(info.offset)} onDragEnd={() => { held.current = false; onDragEnd(); }}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={cancelPress} onPointerCancel={cancelPress}
    onContextMenu={e => { if (editing) e.preventDefault(); }} onKeyDown={keyDown}>
    <div className="wgrid-body">{children}</div>
    {editing && <select className="wgrid-size" aria-label={`Size of ${label}`} value={item.size} onChange={e => onResize(e.target.value as WidgetSize)}>
      {(Object.keys(SIZE_LABELS) as WidgetSize[]).map(size => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}
    </select>}
  </motion.li>;
}
