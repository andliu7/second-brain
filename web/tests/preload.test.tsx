// lib/preload.ts: the lazy chunks load on idle and on a nav hover, a hovered page's first data is
// fetched once and handed to the click, and a preloaded page renders with no Suspense fallback.
// The import functions are spied on, so no real page chunk loads here.
import { Suspense, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { chunks, lazyPage, preloadOn, preloadWhenIdle, takePrefetched } from '../src/lib/preload';

const spyChunks = () => Object.fromEntries(Object.keys(chunks).map(name => [name, vi.spyOn(chunks, name as keyof typeof chunks).mockResolvedValue({} as never)])) as Record<keyof typeof chunks, ReturnType<typeof vi.fn>>;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('preload', () => {
  afterEach(() => vi.useRealTimers());

  it('loads the main pages\' chunks once the page is idle, one idle moment each, and not before', async () => {
    const spies = spyChunks();
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (run: () => void) => { idle.push(run); return idle.length; });
    vi.stubGlobal('cancelIdleCallback', () => {});
    preloadWhenIdle();
    expect(spies.docs).not.toHaveBeenCalled();
    idle.shift()!();
    expect(spies.docs).toHaveBeenCalledTimes(1);
    expect(spies.docEditor).not.toHaveBeenCalled();  // the next waits for its own idle moment
    await settle();
    idle.shift()!();
    expect(spies.docEditor).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) { await settle(); idle.shift()!(); }
    for (const name of ['whiteboardCanvas', 'home', 'network'] as const) expect(spies[name]).toHaveBeenCalledTimes(1);
    expect(spies.pdfTools).not.toHaveBeenCalled();  // reached from Docs: loads on its own hover
  });

  it('falls back to a timer where there is no requestIdleCallback', () => {
    vi.useFakeTimers();
    const spies = spyChunks();
    vi.stubGlobal('requestIdleCallback', undefined);
    preloadWhenIdle();
    expect(spies.docs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(spies.docs).toHaveBeenCalledTimes(1);
  });

  it('loads a page\'s chunks on hover or focus of its nav button', () => {
    const spies = spyChunks();
    render(<><button {...preloadOn('docs')}>Docs</button><button {...preloadOn('draw')}>Whiteboard</button></>);
    fireEvent.pointerEnter(screen.getByText('Docs'));
    expect(spies.docs).toHaveBeenCalled();
    expect(spies.docEditor).toHaveBeenCalled();
    fireEvent.focus(screen.getByText('Whiteboard'));
    expect(spies.whiteboardCanvas).toHaveBeenCalled();
  });

  it('fetches a hovered page\'s first data once, and hands it to the click once', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ repos: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<button {...preloadOn('agenda')}>Today</button>);
    fireEvent.pointerEnter(screen.getByText('Today'));
    fireEvent.pointerEnter(screen.getByText('Today'));  // a second hover reuses the first request
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('/api/projects');
    await expect(takePrefetched('projects')).resolves.toEqual({ repos: [] });
    expect(takePrefetched('projects')).toBeUndefined();
  });

  it('renders a page whose chunk has arrived with no Suspense fallback', async () => {
    type Module = { Page: () => ReactElement };
    const load: (() => Promise<Module>) & { loaded?: Module } = async () => ({ Page: () => <p>Loaded page</p> });
    const Lazy = lazyPage(load, 'Page');
    load.loaded = await load();
    render(<Suspense fallback={<p>Spinner</p>}><Lazy/></Suspense>);
    expect(screen.getByText('Loaded page')).toBeInTheDocument();
    expect(screen.queryByText('Spinner')).toBeNull();
  });
});
