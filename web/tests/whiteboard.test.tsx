import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Whiteboard, SAVE_DELAY_MS } from '../src/Whiteboard';
import App from '../src/App';
import { initialWorkspace, loadWorkspace, saveWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Drawing, Whiteboard as Board, Workspace } from '../src/types';

// The page is mounted the way App.tsx mounts it, with the real Drawnix (not a stand-in) and a commit
// that goes through saveWorkspace, so every assertion about persistence reads real storage.
let commits = 0;
function Host({ initial }: { initial: Workspace }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { commits++; const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
  return <Whiteboard workspace={workspace} commit={commit}/>;
}
// One freehand stroke, the shape Drawnix itself writes for a felt-tip pen line.
const stroke: Drawing = { elements: [{ id: 'stroke-1', type: 'freehand', shape: 'feltTipPen', points: [[0, 0], [40, 30], [90, 10]] }], viewport: { zoom: 1 } };
const updated = '2026-09-29T10:00:00.000Z';
const board = (id: string, name: string, drawing: Drawing = { elements: [] }): Board => ({ id, name, updated, ...drawing });
// Two boards, the first open: Plans holds the stroke, Sketches is empty.
const twoBoards = (): Workspace => ({ ...initialWorkspace(), whiteboards: [board('b-plans', 'Plans', stroke), board('b-sketch', 'Sketches')], currentWhiteboard: 'b-plans' });
// A workspace saved before there were several boards: one drawing.
const withDrawing = (drawing: Drawing): Workspace => ({ ...initialWorkspace(), drawing });
// The first render waits on the lazy Drawnix chunk, which takes a few seconds cold under Vitest.
const boardReady = (container: HTMLElement) => waitFor(() => expect(container.querySelector('.plait-board-container')).not.toBeNull(), { timeout: 15000 });
// A real change made through Drawnix's own interface: the canvas theme picker in the corner.
const changeSomething = (container: HTMLElement) => fireEvent.change(container.querySelector('.theme-toolbar select')!, { target: { value: 'soft' } });
const strokeShown = (container: HTMLElement) => container.querySelector('[plait-data-id="stroke-1"]') !== null;
const saved = () => loadWorkspace();
const openMenu = () => { fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' })); return screen.getByRole('menu', { name: 'Whiteboards' }); };
const title = () => screen.getByRole('textbox', { name: 'Whiteboard title' }) as HTMLInputElement;

beforeEach(() => {
  commits = 0;
  // jsdom has no ResizeObserver; the board only uses it to notice the page resizing.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the whiteboard page', () => {
  it('renders the Drawnix board in the page, in English and in the dark theme, with no heading', async () => {
    const { container } = render(<Host initial={initialWorkspace()}/>);
    const page = screen.getByRole('region', { name: 'Whiteboard' });
    expect(within(page).queryByRole('heading')).toBeNull();
    await boardReady(container);
    expect(container.querySelector('.plait-board-container')).toHaveClass('theme-dark');
    expect(screen.getByRole('button', { name: /^Zoom In/ })).toBeInTheDocument();
  });

  it('fills the page in the app: no Whiteboard heading, and the shell is marked for a full-bleed page', async () => {
    // Every /api call answers; only the connection status needs a shape (App reads its models).
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/status') ? { local: true, authRequired: false, providers: {}, models: { claude: 'model' } } : {}), { status: 200, headers: { 'content-type': 'application/json' } })));
    window.location.hash = 'draw';
    const { container } = render(<App/>);
    await screen.findByRole('region', { name: 'Whiteboard' }, { timeout: 15000 });
    expect(container.querySelector('.app-shell')).toHaveClass('app-draw');
    expect(screen.queryByRole('heading', { name: 'Whiteboard' })).toBeNull();
    window.location.hash = '';
  });

  it('has one bar: the Whiteboards menu, Undo, Redo, then the title, in that order', async () => {
    const { container } = render(<Host initial={initialWorkspace()}/>);
    const bar = screen.getByRole('toolbar', { name: 'Whiteboard tools' });
    expect([...bar.querySelectorAll('button, input')].map(el => el.getAttribute('aria-label'))).toEqual(['Whiteboards', 'Undo', 'Redo', 'Whiteboard title']);
    expect(title().value).toBe('Whiteboard');
    await boardReady(container);
    // A fresh board has nothing to undo or redo.
    expect(within(bar).getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('the menu button is a grid of boards, not the hamburger (Menu) icon', () => {
    render(<Host initial={initialWorkspace()}/>);
    const icon = screen.getByRole('button', { name: 'Whiteboards' }).querySelector('svg')!;
    expect(icon).toHaveClass('lucide-layout-grid');
    expect(icon).not.toHaveClass('lucide-menu');
  });
});

describe('the boards', () => {
  it('the title edits in place and is saved; Esc throws away an edit', async () => {
    render(<Host initial={twoBoards()}/>);
    fireEvent.focus(title());
    fireEvent.change(title(), { target: { value: 'Exam plan' } });
    fireEvent.keyDown(title(), { key: 'Enter' });
    fireEvent.blur(title());
    await waitFor(async () => expect((await saved()).whiteboards!.map(b => b.name)).toEqual(['Exam plan', 'Sketches']));
    fireEvent.change(title(), { target: { value: 'Scrap this' } });
    fireEvent.keyDown(title(), { key: 'Escape' });
    fireEvent.blur(title());
    expect(title().value).toBe('Exam plan');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await saved()).whiteboards![0].name).toBe('Exam plan');
  });

  it('the menu lists every board with the open one ticked, and switching opens that board', async () => {
    const { container } = render(<Host initial={twoBoards()}/>);
    await boardReady(container);
    await waitFor(() => expect(strokeShown(container)).toBe(true));
    const menu = openMenu();
    const boards = within(menu).getAllByRole('menuitemradio');
    expect(boards.map(b => b.textContent)).toEqual(['Plans', 'Sketches']);
    expect(boards.map(b => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    fireEvent.click(boards[1]);
    await waitFor(() => expect(title().value).toBe('Sketches'));
    await boardReady(container);
    expect(strokeShown(container)).toBe(false);
    expect((await saved()).currentWhiteboard).toBe('b-sketch');
  });

  it('New whiteboard adds an empty board and opens it', async () => {
    render(<Host initial={twoBoards()}/>);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'New whiteboard' }));
    await waitFor(() => expect(title().value).toBe('Whiteboard 3'));
    const w = await saved();
    expect(w.whiteboards!.map(b => b.name)).toEqual(['Plans', 'Sketches', 'Whiteboard 3']);
    expect(w.whiteboards![2].elements).toEqual([]);
    expect(w.currentWhiteboard).toBe(w.whiteboards![2].id);
    expect(() => validateWorkspace(w)).not.toThrow();
  });

  it('Rename from the menu puts the caret in the title', () => {
    render(<Host initial={twoBoards()}/>);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Rename' }));
    expect(document.activeElement).toBe(title());
  });

  it('Duplicate copies the open board, drawing and all, next to it, and opens the copy', async () => {
    const { container } = render(<Host initial={twoBoards()}/>);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(title().value).toBe('Plans copy'));
    const w = await saved();
    expect(w.whiteboards!.map(b => b.name)).toEqual(['Plans', 'Plans copy', 'Sketches']);
    expect(w.whiteboards![1].elements).toEqual(stroke.elements);
    expect(w.currentWhiteboard).toBe(w.whiteboards![1].id);
    await boardReady(container);
    await waitFor(() => expect(strokeShown(container)).toBe(true));
  });

  it('Delete asks inside the menu, never with window.confirm, then removes the board and opens its neighbour', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<Host initial={twoBoards()}/>);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Delete' }));
    const ask = screen.getByRole('alert');
    expect(ask).toHaveTextContent('Delete Plans?');
    // Keep it backs out and nothing is saved.
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(commits).toBe(0);
    fireEvent.click(within(screen.getByRole('menu', { name: 'Whiteboards' })).getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Delete whiteboard' }));
    await waitFor(() => expect(title().value).toBe('Sketches'));
    const w = await saved();
    expect(w.whiteboards!.map(b => b.id)).toEqual(['b-sketch']);
    expect(w.currentWhiteboard).toBe('b-sketch');
    expect(confirm).not.toHaveBeenCalled();
    // The last board left cannot be deleted.
    expect(within(openMenu()).getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  it('an edit is saved to the open board once the board has been still, in one commit', async () => {
    const { container } = render(<Host initial={twoBoards()}/>);
    await boardReady(container);
    changeSomething(container);
    changeSomething(container);
    expect(commits).toBe(0);
    await waitFor(() => expect(commits).toBe(1), { timeout: SAVE_DELAY_MS * 4 });
    const w = await saved();
    expect(w.whiteboards![0].elements.map(e => e.id)).toEqual(['stroke-1']);
    expect(w.whiteboards![0].viewport?.zoom).toBeGreaterThan(0);
    expect(w.whiteboards![0].updated).not.toBe(updated);
    expect(w.whiteboards![1].updated).toBe(updated);
    expect(w.drawing).toBeUndefined();
  });

  it('leaving the page saves an edit that was still waiting', async () => {
    const { container, unmount } = render(<Host initial={twoBoards()}/>);
    await boardReady(container);
    changeSomething(container);
    // Plait reports a change on the next microtask, not inside the event; a person leaving the page is a
    // later event, so let the report land, then leave well inside the save delay.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(commits).toBe(0);
    unmount();
    // Straight away, not after the delay: the pending timer would also commit, which proves nothing.
    expect(commits).toBe(1);
    await waitFor(async () => expect((await saved()).whiteboards?.[0].elements.map(e => e.id)).toEqual(['stroke-1']));
    await new Promise(resolve => setTimeout(resolve, SAVE_DELAY_MS * 2));
    expect(commits).toBe(1);
  });

  it('an old save with one drawing opens it as the first board, named Whiteboard, and stops writing drawing', async () => {
    await saveWorkspace(withDrawing(stroke));
    const loaded = await saved();
    expect(loaded.drawing).toEqual(stroke);
    const { container } = render(<Host initial={loaded}/>);
    await boardReady(container);
    await waitFor(() => expect(strokeShown(container)).toBe(true));
    await waitFor(async () => expect((await saved()).whiteboards).toBeDefined());
    const w = await saved();
    expect(w.whiteboards).toHaveLength(1);
    expect(w.whiteboards![0]).toMatchObject({ name: 'Whiteboard', elements: stroke.elements, viewport: stroke.viewport });
    expect(w.drawing).toBeUndefined();
    expect(title().value).toBe('Whiteboard');
  });
});

describe('the infinite canvas', () => {
  // jsdom lays nothing out, so how far a pan scrolls is for a real browser; what can be checked here is
  // that the page takes the wheel over (it never scrolls the page) and that Ctrl+wheel zooms and is saved.
  it('takes every wheel over the board, and Ctrl+wheel zooms in and saves the zoom with the board', async () => {
    const { container } = render(<Host initial={twoBoards()}/>);
    await boardReady(container);
    const target = container.querySelector('.board-host-svg')!;
    const pan = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    target.dispatchEvent(pan);
    expect(pan.defaultPrevented).toBe(true);
    const zoom = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    await waitFor(async () => expect((await saved()).whiteboards![0].viewport!.zoom).toBeGreaterThan(1), { timeout: SAVE_DELAY_MS * 4 });
  });
});

describe('full screen', () => {
  afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen; });

  it('covers the window and asks the browser for full screen when it can; Esc leaves', () => {
    const request = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = request;
    render(<Host initial={twoBoards()}/>);
    const page = screen.getByRole('region', { name: 'Whiteboard' });
    expect(page).not.toHaveClass('whiteboard-full');
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Full screen' }));
    expect(page).toHaveClass('whiteboard-full');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(page);
    expect(within(openMenu()).getByRole('menuitem', { name: 'Exit full screen' })).toBeInTheDocument();
    // Esc with the menu open closes the menu first, then leaves full screen.
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Whiteboards' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(page).toHaveClass('whiteboard-full');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(page).not.toHaveClass('whiteboard-full');
  });

  it('still covers the window where the browser has no requestFullscreen', () => {
    render(<Host initial={twoBoards()}/>);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Full screen' }));
    expect(screen.getByRole('region', { name: 'Whiteboard' })).toHaveClass('whiteboard-full');
  });
});

describe('the whiteboards in the validator', () => {
  it('accepts a workspace saved before the whiteboard existed', async () => {
    const { drawing: _drawing, ...older } = withDrawing(stroke);
    expect(() => validateWorkspace(older)).not.toThrow();
    await saveWorkspace(older as Workspace);
    expect((await loadWorkspace()).drawing).toBeUndefined();
  });

  it('still accepts an old single drawing, and rejects a malformed one', () => {
    expect(() => validateWorkspace(withDrawing({ elements: [] }))).not.toThrow();
    expect(() => validateWorkspace({ ...initialWorkspace(), drawing: { elements: 'nope' } })).toThrow(/drawing.elements/);
    expect(() => validateWorkspace(withDrawing({ elements: [stroke.elements[0], stroke.elements[0]] }))).toThrow(/duplicate ID/);
    expect(() => validateWorkspace(withDrawing({ elements: [], viewport: { zoom: 0 } }))).toThrow(/drawing.viewport.zoom/);
  });

  it('accepts named boards and rejects malformed ones', () => {
    expect(() => validateWorkspace(twoBoards())).not.toThrow();
    const bad = (whiteboards: unknown, extra: object = {}) => () => validateWorkspace({ ...initialWorkspace(), whiteboards, ...extra });
    expect(bad([board('a', 'A'), board('a', 'B')])).toThrow(/whiteboards\[1\].id.*duplicate ID/);
    expect(bad([board('a', '  ')])).toThrow(/whiteboards\[0\].name/);
    expect(bad([{ ...board('a', 'A'), updated: 'yesterday' }])).toThrow(/whiteboards\[0\].updated/);
    expect(bad([board('a', 'A', { elements: [], viewport: { zoom: -1 } })])).toThrow(/whiteboards\[0\].viewport.zoom/);
    expect(bad([{ ...board('a', 'A'), elements: [{ type: 'freehand' }] }])).toThrow(/whiteboards\[0\].elements\[0\].id/);
    expect(bad([board('a', 'A')], { currentWhiteboard: '' })).toThrow(/currentWhiteboard/);
  });
});
