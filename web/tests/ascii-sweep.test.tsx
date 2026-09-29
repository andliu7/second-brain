// AsciiSweep and PageSweep. jsdom has no WebGL2, so the shader itself cannot run here: these check the
// pure helpers the engine leans on, and PageSweep's promises around the effect (the right page shows,
// nothing runs without WebGL2 or under reduced motion, and the copy of the old page goes once it settles).
import { Suspense, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ANDREW_SWEEP, ease, easeInverse, resolveGlyphRamp, resolveObjectPosition } from '../src/components/ui/ascii-sweep';
import { PAGE_SWEEP_S, PageSweep, resolveSweepColor, GREEN, SKELETON_AFTER_MS, SweepWait, WAIT_CAP_MS } from '../src/components/ui/page-sweep';

describe('the sweep helpers', () => {
  it('reads object-position keywords and percentages, and centres anything else', () => {
    expect(resolveObjectPosition('50% 50%')).toEqual([0.5, 0.5]);
    expect(resolveObjectPosition('left top')).toEqual([0, 0]);
    expect(resolveObjectPosition('right bottom')).toEqual([1, 1]);
    expect(resolveObjectPosition('center')).toEqual([0.5, 0.5]);
    expect(resolveObjectPosition('25% 140%')).toEqual([0.25, 1]);   // clamped to the box
    expect(resolveObjectPosition('12px 3em')).toEqual([0.5, 0.5]);  // lengths are not resolved: centred
  });

  it('easeInverse undoes ease across the whole range, so a reversed sweep keeps its place', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(easeInverse(ease(t))).toBeCloseTo(t, 9);
      expect(ease(easeInverse(t))).toBeCloseTo(t, 9);
    }
    expect([ease(0), ease(1), ease(-1), ease(2)]).toEqual([0, 1, 0, 1]);
    expect(ease(0.1)).toBeGreaterThan(0.1);  // ease out: fastest at the start
  });

  it('picks the glyph ramp: a custom one of two or more wins, else the named charset', () => {
    expect(resolveGlyphRamp([], 'binary')).toEqual([0, 4591758, 15324974]);
    expect(resolveGlyphRamp([7], 'blocks')).toHaveLength(6);          // one glyph is not a ramp
    expect(resolveGlyphRamp([1, 2, 3], 'ascii')).toEqual([1, 2, 3]);
    expect(resolveGlyphRamp([], 'nonsense' as 'ascii')).toHaveLength(10);  // unknown names fall back to ascii
  });

  it('inks with the accent token by default, and his green on request', () => {
    document.documentElement.style.setProperty('--acc-fill', '#7B5FC7');
    expect(resolveSweepColor()).toBe('#7B5FC7');
    expect(resolveSweepColor('green')).toBe(GREEN);
    expect(resolveSweepColor('tomato')).toBe('tomato');
    document.documentElement.style.removeProperty('--acc-fill');
  });

  it('plays a page change for 1.6s, slower than its first 0.9s, and keeps his 2.05s for the Chat and Generate tabs', () => {
    // Andrew, 2026-09-29: "make the transition for the sweep slower".
    expect(PAGE_SWEEP_S).toBe(1.6);
    expect(ANDREW_SWEEP.duration).toBe(2.05);
  });
});

// setup.ts answers every media query with matches: true, which reads as "reduce motion".
const motionAllowed = () => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
function Pages({ at }: { at: 'a' | 'b' }) {
  return <main><PageSweep index={at}>{at === 'a' ? <p>Page A</p> : <p>Page B</p>}</PageSweep></main>;
}

describe('PageSweep', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the page for the index in normal flow, with no overlay on the first render', () => {
    motionAllowed();
    render(<Pages at="a"/>);
    expect(screen.getByText('Page A').parentElement).toHaveClass('page-sweep');
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
  });

  it('skips the effect without WebGL2: the new page replaces the old at once', () => {
    motionAllowed();
    const { rerender } = render(<Pages at="a"/>);
    rerender(<Pages at="b"/>);
    expect(screen.getByText('Page B')).toBeInTheDocument();
    expect(screen.queryByText('Page A')).toBeNull();
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
  });

  it('skips the effect under reduced motion even with WebGL2', () => {
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext);
    const { rerender } = render(<Pages at="a"/>);  // setup.ts: reduced motion is on
    rerender(<Pages at="b"/>);
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
    expect(screen.queryByText('Page A')).toBeNull();
  });
});

// With WebGL2 reported present, the overlay mounts with a copy of the old page. The engine then finds no
// real GL context in jsdom, so it never reports the end: the safety timer is what settles it here.
describe('PageSweep with WebGL2', () => {
  it('covers the new page with an inert copy of the old one, and drops the copy once it settles', async () => {
    vi.useFakeTimers();
    motionAllowed();
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'webgl2' ? ({} as RenderingContext) : null) as HTMLCanvasElement['getContext']);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<Pages at="a"/>);
    rerender(<Pages at="b"/>);
    const layer = document.querySelector('.page-sweep-layer')!;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveAttribute('inert');
    expect(layer.textContent).toContain('Page A');           // the copy of the old page
    expect(screen.getByText('Page B').closest('.page-sweep-layer')).toBeNull();  // the live page, outside it
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
    expect(document.body.textContent).not.toContain('Page A');
    expect(screen.getByText('Page B')).toBeInTheDocument();
    errors.mockRestore();
  });

  it('sweeps only the changes when() allows', () => {
    motionAllowed();
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'webgl2' ? ({} as RenderingContext) : null) as HTMLCanvasElement['getContext']);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Only = ({ at }: { at: string }) => <main><PageSweep index={at} when={(_from, to) => to === 'settings'}><p>{at}</p></PageSweep></main>;
    const { rerender } = render(<Only at="docs"/>);
    rerender(<Only at="board"/>);
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
    rerender(<Only at="settings"/>);
    expect(document.querySelector('.page-sweep-layer')?.textContent).toContain('board');
    errors.mockRestore();
  });
});

// Andrew, 2026-09-29: "once it sweeps over, things should be loaded". The band waits for the new page:
// for its Suspense boundary (a SweepWait in the fallback) and its first data (a SweepWait with a flag).
// data-phase on the overlay says whether the band has started.
describe('PageSweep waits for the new page', () => {
  afterEach(() => vi.useRealTimers());
  const withWebGL2 = () => {
    vi.useFakeTimers();
    motionAllowed();
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'webgl2' ? ({} as RenderingContext) : null) as HTMLCanvasElement['getContext']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  };
  const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
  const layer = () => document.querySelector('.page-sweep-layer');
  // The destination panel, whose text is what the band sweeps onto.
  const destination = () => document.querySelector('.page-sweep-dest');
  // A page that suspends until resolve() is called, as a lazy page does until its chunk arrives.
  function slowPage() {
    let loaded = false;
    let resolve = () => {};
    const promise = new Promise<void>(done => { resolve = () => { loaded = true; done(); }; });
    function Slow(): ReactElement { if (!loaded) throw promise; return <p>Page B</p>; }
    return { Slow, resolve: () => resolve() };
  }
  function Lazy({ at, Slow }: { at: 'a' | 'b'; Slow: () => ReactElement }) {
    return <main><PageSweep index={at}>{at === 'a' ? <p>Page A</p> : <Suspense fallback={<p><SweepWait/>Loading B</p>}><Slow/></Suspense>}</PageSweep></main>;
  }

  it('does not start the band while the Suspense fallback is up, and never sweeps onto it', async () => {
    withWebGL2();
    const { Slow } = slowPage();
    const { rerender } = render(<Lazy at="a" Slow={Slow}/>);
    rerender(<Lazy at="b" Slow={Slow}/>);
    expect(screen.getByText('Loading B')).toBeInTheDocument();  // the live page is on its fallback
    await advance(SKELETON_AFTER_MS - 10);
    expect(layer()).toHaveAttribute('data-phase', 'waiting');
    expect(destination()?.textContent).toBe('');
  });

  it('starts the band as soon as the page is ready, onto a copy of the finished page', async () => {
    withWebGL2();
    const Data = ({ at, loaded }: { at: 'a' | 'b'; loaded: boolean }) => <main><PageSweep index={at}><SweepWait when={at === 'b' && !loaded}/><p>{at === 'a' ? 'Page A' : loaded ? 'Page B, with its data' : 'Page B'}</p></PageSweep></main>;
    const { rerender } = render(<Data at="a" loaded={false}/>);
    rerender(<Data at="b" loaded={false}/>);
    await advance(60);
    expect(layer()).toHaveAttribute('data-phase', 'waiting');
    rerender(<Data at="b" loaded/>);
    await advance(48);
    expect(layer()).toHaveAttribute('data-phase', 'sweeping');
    expect(destination()?.textContent).toBe('Page B, with its data');
    expect(document.querySelector('[data-testid="page-skeleton"]')).toBeNull();  // ready in time: no skeleton
  });

  it('holds for a piece still loading inside a nested PageSweep (the editor inside Docs)', async () => {
    withWebGL2();
    const Nested = ({ at, loaded }: { at: 'a' | 'b'; loaded: boolean }) => <main><PageSweep index={at}>{at === 'a' ? <p>Page A</p> : <PageSweep index="doc"><SweepWait when={!loaded}/><p>Page B</p></PageSweep>}</PageSweep></main>;
    const { rerender } = render(<Nested at="a" loaded={false}/>);
    rerender(<Nested at="b" loaded={false}/>);
    await advance(60);
    expect(layer()).toHaveAttribute('data-phase', 'waiting');
    rerender(<Nested at="b" loaded/>);
    await advance(48);
    expect(layer()).toHaveAttribute('data-phase', 'sweeping');
  });

  it('sweeps onto a skeleton after the delay, then fades the finished page in over it', async () => {
    withWebGL2();
    const { Slow, resolve } = slowPage();
    const { rerender } = render(<Lazy at="a" Slow={Slow}/>);
    rerender(<Lazy at="b" Slow={Slow}/>);
    await advance(SKELETON_AFTER_MS);
    expect(layer()).toHaveAttribute('data-phase', 'sweeping');
    expect(destination()?.querySelector('[data-testid="page-skeleton"]')).not.toBeNull();
    expect(destination()?.textContent).not.toContain('Loading B');
    await act(async () => { resolve(); });
    await advance(400);  // React holds a shown fallback up to 300ms before swapping the page in
    await advance(16);   // then the copy is taken a frame later
    expect(document.querySelector('.page-sweep')?.textContent).toBe('Page B');  // the live page
    expect(destination()?.querySelector('.page-sweep-fade')?.textContent).toBe('Page B');
  });

  it('never waits beyond the cap: a page still loading is copied as it is, and the overlay still goes', async () => {
    withWebGL2();
    const { Slow } = slowPage();
    const { rerender } = render(<Lazy at="a" Slow={Slow}/>);
    rerender(<Lazy at="b" Slow={Slow}/>);
    await advance(WAIT_CAP_MS - 20);
    expect(destination()?.querySelector('.page-sweep-copy')?.textContent).toBe('');
    await advance(20);  // the cap: ready, whatever the page shows
    await advance(16);  // and copied a frame later
    expect(destination()?.querySelector('.page-sweep-fade')?.textContent).toBe('Loading B');
    await advance(5000);
    expect(layer()).toBeNull();
  });
});
