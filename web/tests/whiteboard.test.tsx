import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Whiteboard, SAVE_DELAY_MS } from '../src/Whiteboard';
import { initialWorkspace, loadWorkspace, saveWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Drawing, Workspace } from '../src/types';

// The page is mounted the way App.tsx will mount it, with the real Drawnix (not a stand-in) and a commit
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
const withDrawing = (drawing: Drawing): Workspace => ({ ...initialWorkspace(), drawing });
// The first render waits on the lazy Drawnix chunk, which takes a few seconds cold under Vitest.
const boardReady = (container: HTMLElement) => waitFor(() => expect(container.querySelector('.plait-board-container')).not.toBeNull(), { timeout: 15000 });
// A real change made through Drawnix's own interface: the canvas theme picker in the corner.
const changeSomething = (container: HTMLElement) => fireEvent.change(container.querySelector('.theme-toolbar select')!, { target: { value: 'soft' } });

beforeEach(() => {
  commits = 0;
  // jsdom has no ResizeObserver; the board only uses it to notice the page resizing.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('the whiteboard', () => {
  it('renders the Drawnix board in the page, in English and in the dark theme', async () => {
    const { container } = render(<Host initial={initialWorkspace()}/>);
    expect(screen.getByRole('region', { name: 'Whiteboard' })).toBeInTheDocument();
    await boardReady(container);
    expect(container.querySelector('.plait-board-container')).toHaveClass('theme-dark');
    expect(screen.getByRole('button', { name: 'App Menu' })).toBeInTheDocument();
  });

  it('a saved drawing loads back onto the board', async () => {
    await saveWorkspace(withDrawing(stroke));
    const loaded = await loadWorkspace();
    expect(loaded.drawing).toEqual(stroke);
    const { container } = render(<Host initial={loaded}/>);
    await boardReady(container);
    expect(container.querySelector('[plait-data-id="stroke-1"]')).not.toBeNull();
  });

  it('an edit is saved to the workspace once the board has been still, in one commit', async () => {
    const { container } = render(<Host initial={withDrawing(stroke)}/>);
    await boardReady(container);
    changeSomething(container);
    changeSomething(container);
    expect(commits).toBe(0);
    await waitFor(() => expect(commits).toBe(1), { timeout: SAVE_DELAY_MS * 4 });
    const saved = (await loadWorkspace()).drawing!;
    expect(saved.elements.map(e => e.id)).toEqual(['stroke-1']);
    expect(saved.viewport?.zoom).toBeGreaterThan(0);
  });

  it('leaving the page saves an edit that was still waiting', async () => {
    const { container, unmount } = render(<Host initial={withDrawing(stroke)}/>);
    await boardReady(container);
    changeSomething(container);
    // Plait reports a change on the next microtask, not inside the event; a person leaving the page is a
    // later event, so let the report land, then leave well inside the save delay.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(commits).toBe(0);
    unmount();
    // Straight away, not after the delay: the pending timer would also commit, which proves nothing.
    expect(commits).toBe(1);
    await waitFor(async () => expect((await loadWorkspace()).drawing?.elements.map(e => e.id)).toEqual(['stroke-1']));
    await new Promise(resolve => setTimeout(resolve, SAVE_DELAY_MS * 2));
    expect(commits).toBe(1);
  });
});

describe('the drawing in the validator', () => {
  it('accepts a workspace saved before the whiteboard existed', async () => {
    const { drawing: _drawing, ...older } = withDrawing(stroke);
    expect(() => validateWorkspace(older)).not.toThrow();
    await saveWorkspace(older as Workspace);
    expect((await loadWorkspace()).drawing).toBeUndefined();
  });

  it('accepts an empty drawing and rejects a malformed one', () => {
    expect(() => validateWorkspace(withDrawing({ elements: [] }))).not.toThrow();
    expect(() => validateWorkspace({ ...initialWorkspace(), drawing: { elements: 'nope' } })).toThrow(/drawing.elements/);
    expect(() => validateWorkspace(withDrawing({ elements: [stroke.elements[0], stroke.elements[0]] }))).toThrow(/duplicate ID/);
    expect(() => validateWorkspace(withDrawing({ elements: [], viewport: { zoom: 0 } }))).toThrow(/drawing.viewport.zoom/);
  });
});
