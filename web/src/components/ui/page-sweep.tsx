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
//
// Why it does not simply wrap the page in <AsciiSweep>: AsciiSweep's panels are absolutely positioned
// scroll boxes, so a page inside one would lose the document's own scrolling, the sticky top bar and
// every layout that assumes normal flow, and would remount when the sweep ended. So the live page stays
// exactly where it was, in normal flow, inside a display:contents wrapper that changes no layout. Only
// while a sweep plays, an overlay sits over the visible part of the page: an AsciiSweep whose two panels
// are static DOM copies (cloneNode) of the old page and the new one. The copies are not React trees, so
// the old page is never mounted twice, and the overlay is removed once the band has faded.
//
// Cheap by construction: nothing runs on the first render, under prefers-reduced-motion, without WebGL2,
// or on a page too big to copy quickly. The overlay is pointer-events:none and inert, so input goes to
// the live page underneath from the first frame; it blocks nothing, for any length of time.
import { Component, createRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AsciiSweep, ANDREW_SWEEP, type AsciiSweepOptions } from './ascii-sweep';
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

type Frame = { top: number; left: number; width: number; height: number };
// The overlay covers the part of the container on screen, never more than the viewport.
function frameOf(host: HTMLElement): Frame {
  const rect = host.parentElement!.getBoundingClientRect();
  const top = Math.max(rect.top, 0);
  return { top, left: rect.left, width: rect.width, height: Math.max(0, Math.min(rect.bottom, window.innerHeight) - top) };
}

type Index = string | number;
type Props = { index: Index; children: ReactNode; color?: SweepColor; duration?: number; options?: AsciiSweepOptions; when?: (from: Index, to: Index) => boolean };
type Sweep = { id: number; old: HTMLElement; frame: Frame };

// A class, because getSnapshotBeforeUpdate is the one React API that runs after a render but before the
// DOM changes: the only moment the old page can still be copied. Function components have no equivalent.
export class PageSweep extends Component<Props, { sweep: Sweep | null }> {
  state = { sweep: null as Sweep | null };
  host = createRef<HTMLDivElement>();
  count = 0;

  getSnapshotBeforeUpdate(prev: Props): Sweep | null {
    const host = this.host.current;
    const { index, when } = this.props;
    if (prev.index === index || (when && !when(prev.index, index)) || !canSweep(host)) return null;
    const frame = frameOf(host);
    return { id: ++this.count, old: copyPage(host, frame.top), frame };
  }

  // setState here re-renders before the browser paints, so the copy of the old page covers the new one
  // from the first frame. A second change mid-sweep replaces the overlay (a new key, a new engine).
  componentDidUpdate(_prev: Props, _state: unknown, snapshot: Sweep | null) {
    if (snapshot) this.setState({ sweep: snapshot });
  }

  render() {
    const { sweep } = this.state;
    return <>
      <div ref={this.host} className="page-sweep">{this.props.children}</div>
      {sweep && <SweepLayer key={sweep.id} sweep={sweep} host={this.host} color={this.props.color} duration={this.props.duration ?? PAGE_SWEEP_S} options={this.props.options}
        done={() => this.setState(s => s.sweep?.id === sweep.id ? { sweep: null } : s)}/>}
    </>;
  }
}

// Mounts a DOM node React did not create. The layout effect runs before AsciiSweep's own effect starts
// the engine, so the engine finds the copy already in place.
function Foreign({ node }: { node: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!node) return;
    box.current!.appendChild(node);
    return () => node.remove();
  }, [node]);
  return <div ref={box} className="page-sweep-copy"/>;
}

function SweepLayer({ sweep, host, color, duration, options, done }: { sweep: Sweep; host: RefObject<HTMLDivElement | null>; color?: SweepColor; duration: number; options?: AsciiSweepOptions; done: () => void }) {
  const [fresh, setFresh] = useState<HTMLElement | null>(null);
  const [index, setIndex] = useState(0);
  // The engine starts on panel 0, the old page, which hides the new one. The new page is copied a frame
  // later, after App has scrolled it to the top, and the sweep starts once both copies are painted.
  useEffect(() => {
    const copy = window.setTimeout(() => { if (host.current) setFresh(copyPage(host.current, sweep.frame.top)); }, 16);
    const start = window.setTimeout(() => setIndex(1), 48);
    const safety = window.setTimeout(done, 48 + duration * 1000 + FADE_MS + SAFETY_MS);
    return () => { window.clearTimeout(copy); window.clearTimeout(start); window.clearTimeout(safety); };
  }, []); // once per sweep: the layer is keyed on it, so a new sweep is a new layer
  const settle = useRef(0);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const style: CSSProperties = { top: sweep.frame.top, left: sweep.frame.left, width: sweep.frame.width, height: sweep.frame.height };
  return <div className="page-sweep-layer" style={style} aria-hidden="true" inert>
    <AsciiSweep {...ANDREW_SWEEP} {...options} duration={duration} color={resolveSweepColor(color)} index={index} directional={false} style={{ width: '100%', height: '100%' }}
      alternate={<Foreign node={fresh}/>} onSweepEnd={() => { settle.current = window.setTimeout(done, FADE_MS); }}>
      <Foreign node={sweep.old}/>
    </AsciiSweep>
  </div>;
}
