import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { initialWorkspace, makeDoc, saveWorkspace } from '../src/lib/storage';

// The full screen page, #write/<docId> (Write.tsx), mounted through App so the address, the missing shell
// and the way back to #docs are all the real ones. Every /api call is stubbed with an empty answer.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url);
    const reply = path.includes('/status') ? { local: true, authRequired: false, providers: {}, models: {} } : path.includes('/skills') ? { skills: [] } : path.includes('/projects') ? { repos: [], courses: [] } : {};
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
// The browser full screen API is stubbed per test; jsdom has none of it.
afterEach(() => { delete (document.documentElement as Partial<HTMLElement>).requestFullscreen; });

// Fresh notes (fresh ids) for each test: Docs remembers the last open note for the visit, and a test
// must not inherit the one the test before it opened.
const note = (name: string, content: string, when: string) => ({ ...makeDoc(name, content, 'note', ['Note']), created: when, updated: when });
let alpha = note('Alpha', 'Older note body', '2026-09-20T10:00:00.000Z'), beta = alpha;
beforeEach(() => { alpha = note('Alpha', 'Older note body', '2026-09-20T10:00:00.000Z'); beta = note('Beta', 'Newest note', '2026-09-28T10:00:00.000Z'); });
async function openAt(hash: string) {
  await saveWorkspace({ ...initialWorkspace(), docs: [alpha, beta] });
  window.location.hash = hash;
  render(<App/>);
}
const body = () => screen.findByRole('textbox', { name: 'Document body' }, { timeout: 10000 });

describe('the full screen writing page', () => {
  it('a reload of #write/<id> opens that note on its own: no sidebar, no top bar, the same editor', async () => {
    await openAt('write/' + alpha.id);
    expect(await body()).toHaveTextContent('Older note body');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Alpha');
    expect(screen.queryByRole('complementary', { name: 'Workspace navigation' })).toBeNull();
    expect(document.querySelector('.app-shell, .topbar, .sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByText('3 words')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
  it('edits save, and Back returns to #docs with that note selected', async () => {
    const user = userEvent.setup();
    await openAt('write/' + alpha.id);
    await body();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' draft');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(window.location.hash).toBe('#docs'));
    // Alpha is the older note, so it is selected because Back asked for it, not because it is first.
    expect(await screen.findByRole('button', { name: /Alpha draft/ }, { timeout: 10000 })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Alpha draft');
    expect(screen.getByRole('complementary', { name: 'Workspace navigation' })).toBeInTheDocument();
  });
  it('Ctrl+Shift+F on Docs opens the open note full screen, and Escape comes back', async () => {
    await openAt('docs');
    await body();
    fireEvent.keyDown(document.body, { key: 'F', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#write/' + beta.id));
    await waitFor(() => expect(document.querySelector('.app-shell')).toBeNull());
    expect(await body()).toHaveTextContent('Newest note');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(window.location.hash).toBe('#docs'));
  });
  it('asks the browser for full screen when it can, and shows no button when it cannot', async () => {
    const user = userEvent.setup();
    await openAt('write/' + alpha.id);
    await body();
    expect(screen.queryByRole('button', { name: 'Browser full screen' })).toBeNull();
    const request = vi.fn(async () => {});
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    // Another note re-renders the strip, which checks again for the API.
    window.location.hash = 'write/' + beta.id;
    await user.click(await screen.findByRole('button', { name: 'Browser full screen' }));
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('Escape in the browser full screen leaves it first, and only the next Escape goes Back', async () => {
    await openAt('write/' + alpha.id);
    await body();
    const exit = vi.fn(async () => { Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true }); });
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
    try {
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
      expect(window.location.hash).toBe('#write/' + alpha.id);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(window.location.hash).toBe('#docs'));
    } finally {
      delete (document as Partial<Document>).fullscreenElement;
      delete (document as Partial<Document>).exitFullscreen;
    }
  });
  it('Save as PDF on the page prints the note, marked for the print rules, with its title as a heading', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    await openAt('write/' + alpha.id);
    await body();
    expect(screen.getByRole('main')).toHaveClass('note-print');
    expect(document.querySelector('.note-print .print-title')?.textContent).toBe('Alpha');
    await user.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
  it('a note that no longer exists says so and still has Back', async () => {
    await openAt('write/not-a-note');
    expect(await screen.findByText(/This note is not in your workspace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
