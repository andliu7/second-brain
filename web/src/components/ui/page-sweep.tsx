// PageSweep: the AsciiSweep band played when the page changes (Andrew, 2026-09-28: "add this when switching
// between generate and chat tabs. also for docs to pdf. or anything to today or settings"; 2026-09-29:
// "make the transition for the sweep slower and for every new page"). Props:
//   index: which page is showing (any string or number); a change is what sweeps
//   children: the page for that index, rendered as it would be without the wrapper
//   color: 'accent' (default, the --acc-fill token read with getComputedStyle), 'green' (his #4ade80),
//          or any CSS colour
//   duration: seconds; 1.6 by default (it was 0.9 until he asked for slower). Tabs pass his 2.05.
//   when(from, to): optional; which changes sweep. Without it every change does. App passes one so every
//          page change sweeps except into or out of the home globe, whose canvas copies unreliably.
//   skeleton(index): optional; what to show while the new page is not ready yet. A PageSkeleton of
//          cards by default.
//
// Why it does not simply wrap the page in <AsciiSweep>: AsciiSweep's panels are absolutely positioned
// scroll boxes, so a page inside one would lose the document's own scrolling, the sticky top bar and
// every layout that assumes normal flow, and would remount when the sweep ended. So the live page stays
// exactly where it was, in normal flow, inside a display:contents wrapper that changes no layout. Only
// while a sweep plays, an overlay sits over the visible part of the page: an AsciiSweep whose two panels
// are static DOM copies (cloneNode) of the old page and the new one. The copies are not React trees, so
// the old page is never mounted twice, and the overlay is removed once the band has faded.
//
// Waiting for the new page (Andrew, 2026-09-29: "once it sweeps over, things should be loaded"). The band
// used to start 48ms after the change, onto whatever the page showed then: a lazy page's spinner, or a
// page still fetching. Now it starts when the new page is ready, which is when no <SweepWait> inside
// PageSweep is mounted. App puts one in each lazy page's Suspense fallback (so the page is ready the
// moment React swaps the fallback for it) and one for the first data of the pages that fetch on arrival
// (let go at DATA_WAIT_MS whatever happens). Why a mark in the fallback rather than a Ready signal inside
// the page: PageSweep learns there is something to wait for in the same commit as the change, and a page
// that needs nothing (or whose chunk was preloaded) costs no wait at all. If the page is not ready within
// SKELETON_AFTER_MS, the band sweeps onto a skeleton instead, and the finished page fades in over the
// skeleton when it is ready. WAIT_CAP_MS bounds the wait, so a navigation never hangs on a slow request.
//
// Cheap by construction: nothing runs on the first render, under prefers-reduced-motion, without WebGL2,
// or on a page too big to copy quickly. The overlay is pointer-events:none and inert, so input goes to
// the live page underneath from the first frame; it blocks nothing, for any length of time.
import { Component, createContext, createRef, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AsciiSweep, ANDREW_SWEEP, primeSvgImages, type AsciiSweepOptions } from './ascii-sweep';
import { PageSkeleton } from './page-skeleton';
import './page-sweep.css';

export const GREEN = '#4ade80';
export const PAGE_SWEEP_S = 1.6;
// AsciiSweep's own FADE_OUT_S is 0.45: the glow left at the far edge dissolves for that long after the
// band lands, so the overlay stays that long plus a margin before it goes.
const FADE_MS = 500;
// If the engine never reports the end (no GL context after all, a lost context), the overlay still goes.
const SAFETY_MS = 1500;
// Copying and painting a page walks every element; past this many it costs more than the effect is worth.
const MAX_ELEMENTS = 3000;
// A page ready sooner than this sweeps straight onto itself; a slower one gets its skeleton first.
export const SKELETON_AFTER_MS = 120;
// The longest the band's destination waits for the page, from the change. The page is copied as it is then.
export const WAIT_CAP_MS = 1500;
// The most a page waits on its first data (App's SweepWait for /api/projects and /api/skills).
export const DATA_WAIT_MS = 600;

export type SweepColor = 'accent' | 'green' | (string & {});

export function resolveSweepColor(color: SweepColor = 'accent'): string {
  if (color === 'green') return GREEN;
  if (color !== 'accent') return color;
  const token = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--acc-fill').trim();
  return token || GREEN;
}

// jsdom and some old browsers have no WebGL2; the constructor's absence says so without creating a
// context. Where it exists, one probe context is made, once, and its answer kept.
let webgl2: boolean | undefined;
export function hasWebGL2(): boolean {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  return webgl2 ??= !!document.createElement('canvas').getContext('webgl2');
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function canSweep(host: HTMLElement | null): host is HTMLElement {
  return !!host?.parentElement && !reducedMotion() && hasWebGL2() && host.getElementsByTagName('*').length <= MAX_ELEMENTS;
}

// The gate: how many things in the new page are still loading. SweepWait holds it; SweepLayer reads it
// with useSyncExternalStore (React's hook for a value kept outside React: it re-renders on a change).
// A PageSweep inside another (Docs has one for its PDF tab) passes each hold up as well, so the editor
// loading inside Docs holds the page sweep into Docs too.
type Gate = { hold: () => () => void; subscribe: (onChange: () => void) => () => void; open: () => boolean };
function createGate(parent: () => Gate | null): Gate {
  let holds = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach(listener => listener());
  return {
    hold() {
      holds++; changed();
      const releaseParent = parent()?.hold();
      let held = true;
      return () => { if (held) { held = false; holds--; changed(); releaseParent?.(); } };
    },
    subscribe(onChange) { listeners.add(onChange); return () => { listeners.delete(onChange); }; },
    open: () => holds === 0,
  };
}
const GateContext = createContext<Gate | null>(null);

// While mounted with when true, the page sweep holds its band for the page around it. upTo (ms) lets go
// on its own after that long. A layout effect, so the hold is in place in the same commit as the change,
// before PageSweep looks (a parent's componentDidUpdate runs after its children's layout effects).
// Outside a PageSweep it does nothing.
export function SweepWait({ when = true, upTo }: { when?: boolean; upTo?: number }) {
  const gate = useContext(GateContext);
  useLayoutEffect(() => {
    if (!when || !gate) return;
    const release = gate.hold();
    const timer = upTo === undefined ? 0 : window.setTimeout(release, upTo);
    return () => { window.clearTimeout(timer); release(); };
  }, [gate, when, upTo]);
  return null;
}

// A static copy of what the page's container shows: the container itself without its children (so the
// page keeps its class, padding and width), then the page's nodes. Ids are dropped so nothing in the app
// finds the copy by id, and top is where the container's top sits in the overlay.
function copyPage(host: HTMLElement, overlayTop: number): HTMLElement {
  const parent = host.parentElement!;
  const box = parent.cloneNode(false) as HTMLElement;
  box.removeAttribute('id');
  box.removeAttribute('tabindex');
  for (const child of Array.from(host.childNodes)) {
    const copy = child.cloneNode(true);
    // cloneNode copies a canvas element but not its pixels, so a board or chart would copy blank.
    if (child instanceof Element && copy instanceof Element) {
      const to = copy.querySelectorAll('canvas');
      child.querySelectorAll('canvas').forEach((from, i) => {
        const target = to[i];
        target.width = from.width; target.height = from.height;
        try { target.getContext('2d')?.drawImage(from, 0, 0); } catch { /* a tainted or lost canvas stays blank */ }
      });
    }
    box.appendChild(copy);
  }
  box.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  const rect = parent.getBoundingClientRect();
  // The container's own entrance animation (the andliu.ai panel slides in) must not replay in the copy.
  Object.assign(box.style, { position: 'absolute', left: '0', top: `${rect.top - overlayTop}px`, width: `${rect.width}px`, maxWidth: 'none', margin: '0', animation: 'none', transition: 'none' });
  return box;
}

// Where the page's container sits in the overlay, with its padding, so a skeleton lines up with the page.
function shellOf(host: HTMLElement, overlayTop: number): CSSProperties {
  const parent = host.parentElement!;
  const rect = parent.getBoundingClientRect();
  return { position: 'absolute', left: 0, top: rect.top - overlayTop, width: rect.width, padding: getComputedStyle(parent).padding, boxSizing: 'border-box' };
}

type Frame = { top: number; left: number; width: number; height: number };
// The overlay covers the part of the container on screen, never more than the viewport.
function frameOf(host: HTMLElement): Frame {
  const rect = host.parentElement!.getBoundingClientRect();
  const top = Math.max(rect.top, 0);
  return { top, left: rect.left, width: rect.width, height: Math.max(0, Math.min(rect.bottom, window.innerHeight) - top) };
}

type Index = string | number;
type Props = { index: Index; children: ReactNode; color?: SweepColor; duration?: number; options?: AsciiSweepOptions; when?: (from: Index, to: Index) => boolean; skeleton?: (index: Index) => ReactNode };
type Sweep = { id: number; old: HTMLElement; frame: Frame };

// A class, because getSnapshotBeforeUpdate is the one React API that runs after a render but before the
// DOM changes: the only moment the old page can still be copied. Function components have no equivalent.
export class PageSweep extends Component<Props, { sweep: Sweep | null }> {
  // contextType: how a class component reads a context; here the gate of a PageSweep around this one.
  static contextType = GateContext;
  declare context: Gate | null;
  state = { sweep: null as Sweep | null };
  host = createRef<HTMLDivElement>();
  count = 0;
  gate = createGate(() => this.context);

  getSnapshotBeforeUpdate(prev: Props): Sweep | null {
    const host = this.host.current;
    const { index, when } = this.props;
    if (prev.index === index || (when && !when(prev.index, index)) || !canSweep(host)) return null;
    const frame = frameOf(host);
    // The painter draws icons from images of them; starting those now means the old page's icons are
    // in its very first capture.
    primeSvgImages(host);
    return { id: ++this.count, old: copyPage(host, frame.top), frame };
  }

  // setState here re-renders before the browser paints, so the copy of the old page covers the new one
  // from the first frame. A second change mid-sweep replaces the overlay (a new key, a new engine).
  componentDidUpdate(_prev: Props, _state: unknown, snapshot: Sweep | null) {
    if (snapshot) this.setState({ sweep: snapshot });
  }

  render() {
    const { sweep } = this.state;
    const { index, skeleton } = this.props;
    return <>
      <GateContext.Provider value={this.gate}><div ref={this.host} className="page-sweep">{this.props.children}</div></GateContext.Provider>
      {sweep && <SweepLayer key={sweep.id} sweep={sweep} host={this.host} gate={this.gate} skeleton={skeleton ? skeleton(index) : <PageSkeleton/>} color={this.props.color} duration={this.props.duration ?? PAGE_SWEEP_S} options={this.props.options}
        done={() => this.setState(s => s.sweep?.id === sweep.id ? { sweep: null } : s)}/>}
    </>;
  }
}

// Mounts a DOM node React did not create. The layout effect runs before AsciiSweep's own effect starts
// the engine, so the engine finds the copy already in place. fade: the copy fades in over a skeleton.
function Foreign({ node, fade }: { node: HTMLElement | null; fade?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!node) return;
    box.current!.appendChild(node);
    return () => node.remove();
  }, [node]);
  return <div ref={box} className={fade ? 'page-sweep-copy page-sweep-fade' : 'page-sweep-copy'}/>;
}

function SweepLayer({ sweep, host, gate, skeleton, color, duration, options, done }: { sweep: Sweep; host: RefObject<HTMLDivElement | null>; gate: Gate; skeleton: ReactNode; color?: SweepColor; duration: number; options?: AsciiSweepOptions; done: () => void }) {
  const open = useSyncExternalStore(gate.subscribe, gate.open);
  const [capped, setCapped] = useState(false);
  const ready = open || capped;
  // waited: SKELETON_AFTER_MS passed before the page was ready, so the band goes onto the skeleton.
  const [waited, setWaited] = useState(false);
  const [fresh, setFresh] = useState<HTMLElement | null>(null);
  const [index, setIndex] = useState(0);
  const [landed, setLanded] = useState(false);
  const [shell] = useState(() => host.current ? shellOf(host.current, sweep.frame.top) : {});

  useEffect(() => {
    const cap = window.setTimeout(() => setCapped(true), WAIT_CAP_MS);
    return () => window.clearTimeout(cap);
  }, []); // once per sweep: the layer is keyed on it, so a new sweep is a new layer
  // Not ready in time: the band starts now, onto the skeleton.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => { setWaited(true); setIndex(1); }, SKELETON_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);
  // The engine starts on panel 0, the old page, which hides the new one. Once the new page is ready it is
  // copied a frame later, after App has scrolled it to the top and a page that just resolved has painted,
  // and the band starts once both copies are painted (at once, if it is already on its way to a skeleton).
  // All three timers are set here together, from the moment the page is ready.
  useEffect(() => {
    if (!ready) return;
    const copy = window.setTimeout(() => { if (host.current) { primeSvgImages(host.current); setFresh(copyPage(host.current, sweep.frame.top)); } }, 16);
    const start = window.setTimeout(() => setIndex(1), 48);
    // If the engine never reports the end (no GL context after all, a lost context), the overlay still goes.
    const safety = window.setTimeout(done, 48 + duration * 1000 + FADE_MS + SAFETY_MS);
    return () => { window.clearTimeout(copy); window.clearTimeout(start); window.clearTimeout(safety); };
  }, [ready]);
  // The overlay goes FADE_MS after the band has landed and the copy is in. That also covers the copy's
  // 250ms fade over a skeleton when the page was ready only after the band landed.
  useEffect(() => {
    if (!landed || !fresh) return;
    const settle = window.setTimeout(done, FADE_MS);
    return () => window.clearTimeout(settle);
  }, [landed, fresh]);

  const style: CSSProperties = { top: sweep.frame.top, left: sweep.frame.left, width: sweep.frame.width, height: sweep.frame.height };
  return <div className="page-sweep-layer" style={style} aria-hidden="true" inert data-phase={index ? 'sweeping' : 'waiting'}>
    <AsciiSweep {...ANDREW_SWEEP} {...options} duration={duration} color={resolveSweepColor(color)} index={index} directional={false} style={{ width: '100%', height: '100%' }}
      alternate={<div className="page-sweep-dest">
        {waited && <div className="page-sweep-skeleton" style={shell}>{skeleton}</div>}
        <Foreign node={fresh} fade={waited}/>
      </div>} onSweepEnd={() => setLanded(true)}>
      <Foreign node={sweep.old}/>
    </AsciiSweep>
  </div>;
}
