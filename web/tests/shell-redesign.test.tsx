import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../src/App';

// The 2026-09-25 shell: one Kanban page, andliu.ai, the welcome as a notification, and a chat that asks the
// brain index before the provider. Every /api call is stubbed; the order of calls is what some tests check.
const calls: { path: string; body: any }[] = [];
const skill = { name: 'calibrate', slug: 'calibrate', description: 'Run a calibration roundtable.', skill: '# calibrate', readme: null, files: ['SKILL.md'], path: 'calibrate', source: 'installed', task: null };
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) : undefined; calls.push({ path, body });
    const reply = path.includes('/status') ? { local: true, authRequired: false, providers: { claude: true }, models: { claude: 'claude-sonnet-5' } }
      : path.includes('/projects') ? { repos: [], courses: [], blueberry: null } : path.includes('/tasks') ? { tasks: [] } : path.includes('/skills') ? { skills: [skill] }
      : path.includes('/brain') ? { status: 'ok', question: 'x', ms: 65, winner: { path: 'C:/Projects/grignard/STATUS.md', heading: 'STATUS.md > newest', confidence: 'EXTRACTED' }, evidence: 'The newest entry is dated 2026-09-13.' }
      : path.includes('/chat') ? { text: 'It is in grignard/grignard-app-source/documentation/STATUS.md.' } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

describe('the redesigned shell', () => {
  it('has one Kanban page in the navigation, andliu.ai, and no Network, Goals or Buy tabs', async () => {
    window.location.hash = 'board';
    render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent?.replace(/\d+|AI/g, '').trim())).toEqual(['Second Brain.', 'Today', 'Kanban', 'Skills', 'andliu.ai', 'Docs', 'Whiteboard', 'Health', 'Settings', 'Hide sidebar', 'Auto-hide']); // 2026-09-29: Health joined the nav. 2026-09-28: Resume left the nav for Docs (a note of kind Resume; #resume still opens). Docs, Whiteboard and Resume joined the nav; PDF tools joined after them, then folded into Docs (#pdf still opens)
    // The Kanban page carries the board, the day's todos, the buy list and the goals together.
    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'To buy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Goals' })).toBeInTheDocument(); // one h1 per page: Goals is a block here
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // The profile moved from the sidebar foot to the top bar (2026-09-28); its "Local storage" line went with it.
    expect(screen.getByRole('button', { name: /^Profile(, |$)/ })).toBeInTheDocument();  // unnamed by default since 2026-09-29
    expect(nav).not.toHaveTextContent('Local storage');
  });

  it('shows the welcome as a notification with a ping and a banner, and Got it marks it read for this browser', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    render(<App/>);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    expect(screen.getByRole('note', { name: 'Unread notification' })).toHaveTextContent('Welcome to my second brain');
    await user.click(bell);
    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByRole('heading', { name: 'Welcome to my second brain' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Unread notification' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('brain-notifications-read') || '[]')).toEqual(['welcome']);
    // A fresh workspace has no files: the welcome is not a doc any more.
    expect(screen.queryByText('Welcome to your second brain')).not.toBeInTheDocument();
  });

  it('asks the brain index before the provider, sends the evidence as context, and answers as andliu.ai', async () => {
    const user = userEvent.setup();
    window.location.hash = 'chat';
    render(<App/>);
    expect(await screen.findByRole('heading', { level: 1, name: 'andliu.ai' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Brain/ })).toBeChecked();
    // 2026-09-28: the model is picked in a menu inside the message box, named for people, not a select above it.
    expect(screen.getByRole('button', { name: /^Chat model/ })).toHaveTextContent(/^Claude Sonnet 5$/);
    await screen.findByRole('option', { name: 'calibrate' });
    await user.type(await screen.findByLabelText('Message'), 'where is the blueberry status file');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText(/grignard-app-source/);
    const brain = calls.findIndex(c => c.path.includes('/brain?q=')); const chat = calls.findIndex(c => c.path.endsWith('/chat'));
    expect(brain).toBeGreaterThan(-1); expect(chat).toBeGreaterThan(brain);
    expect(decodeURIComponent(calls[brain].path.split('q=')[1])).toBe('where is the blueberry status file');
    expect(calls[chat].body.context[0].name).toBe('Brain evidence: STATUS.md > newest');
    expect(calls[chat].body.context[0].content).toContain('The newest entry is dated 2026-09-13.');
    expect(screen.getAllByText('andliu.ai').length).toBeGreaterThan(1);
    expect(screen.getByText('65 ms')).toBeInTheDocument();
  });

  it('attaches a skill from the chat dropdown', async () => {
    const user = userEvent.setup();
    window.location.hash = 'chat';
    render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'andliu.ai' });
    await screen.findByRole('option', { name: 'calibrate' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Attach a skill' }), 'calibrate');
    expect(await screen.findByText('calibrate attached to Chat')).toBeInTheDocument();
  });

  it('puts the focus timer in the top bar beside the theme button, not floating over the page', async () => {
    window.location.hash = 'board';
    render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'Board' });
    const focus = within(document.querySelector<HTMLElement>('header.topbar')!).getByRole('button', { name: 'Focus' });
    expect(focus.closest('.focus-timer')?.nextElementSibling).toHaveClass('theme-button');
  });
});

// Andrew, 2026-09-28: the sidebar hides away behind a burger or slides away on its own (it replaced the
// icon rail the same day), and the Kanban page is the board first, full width, with the other lists under it.
describe('the hideable sidebar and the Kanban page layout', () => {
  beforeEach(() => localStorage.clear());

  it('hides entirely from its button, remembers the choice, and the burger brings it back', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    const { unmount } = render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    const shell = nav.closest('.app-shell')!;
    expect(shell).toHaveClass('sidebar-open');
    await user.click(within(nav).getByRole('button', { name: 'Hide sidebar' }));
    expect(shell).toHaveClass('sidebar-hidden', 'sidebar-away');
    expect(localStorage.getItem('brain-sidebar-mode')).toBe('hidden');
    unmount();
    // A reload opens hidden.
    render(<App/>);
    const again = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    expect(again.closest('.app-shell')).toHaveClass('sidebar-hidden', 'sidebar-away');
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(again.closest('.app-shell')).toHaveClass('sidebar-open');
    expect(again.closest('.app-shell')).not.toHaveClass('sidebar-away');
    expect(localStorage.getItem('brain-sidebar-mode')).toBe('open');
  });

  it('Auto-hide is a pressed toggle that puts the shell in auto mode', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    const auto = within(nav).getByRole('button', { name: 'Auto-hide' });
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    await user.click(auto);
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(nav.closest('.app-shell')).toHaveClass('sidebar-auto');
    await user.click(auto);
    expect(nav.closest('.app-shell')).toHaveClass('sidebar-open');
  });

  it('Ctrl B toggles it anywhere except while typing in a field', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    const shell = nav.closest('.app-shell')!;
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).toHaveClass('sidebar-hidden');
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).not.toHaveClass('sidebar-hidden');
    await user.click(screen.getByRole('textbox', { name: 'New todo' }));
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).not.toHaveClass('sidebar-hidden');
  });

  it('puts the board first and full width, with the todos, the buy list and the goals after it', async () => {
    window.location.hash = 'board';
    render(<App/>);
    const board = (await screen.findByRole('heading', { level: 1, name: 'Board' })).closest('.bento-cell') as HTMLElement;
    expect(board).toHaveClass('bento-wide');
    const cells = Array.from(document.querySelectorAll('.kanban-bento > .bento-cell'));
    expect(cells[0]).toBe(board);
    const after = (el: Element) => cells.indexOf(el.closest('.bento-cell')!);
    expect(after(screen.getByRole('checkbox', { name: 'Read for 15 minutes' }))).toBeGreaterThan(0);
    expect(after(screen.getByRole('heading', { level: 2, name: 'To buy' }))).toBeGreaterThan(0);
    expect(after(screen.getByRole('heading', { level: 2, name: 'Goals' }))).toBeGreaterThan(0);
  });
});

// Andrew, 2026-09-28: arriving on Today sweeps the page in; 2026-09-29: "for every new page", so every page
// change sweeps except into or out of the home globe, a canvas that copies blank. The overlay is only a copy
// of the page, so it needs WebGL2 and motion allowed (tests/setup.ts turns reduced motion on); without them
// the page just swaps.
describe('the page sweep', () => {
  const motionAllowed = () => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const withWebGL2 = () => {
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'webgl2' ? ({} as RenderingContext) : null) as HTMLCanvasElement['getContext']);
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom's fake context: the engine reports it and the safety timer settles
  };
  const nav = (name: string) => within(screen.getByRole('complementary', { name: 'Workspace navigation' })).getByRole('button', { name });
  const fromKanban = async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'Board' });
    return user;
  };
  const kanbanToToday = async () => { const user = await fromKanban(); await user.click(nav('Today')); };

  it('does not mount the overlay without WebGL2', async () => {
    motionAllowed();
    await kanbanToToday();
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
  });

  it('mounts it, over a copy of the Kanban page, when WebGL2 exists', async () => {
    motionAllowed();
    withWebGL2();
    await kanbanToToday();
    const layer = document.querySelector('.page-sweep-layer');
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute('inert');
    expect(layer!.textContent).toContain('Board');
  });

  it('sweeps any other page change too, Kanban to Docs', async () => {
    motionAllowed();
    withWebGL2();
    const user = await fromKanban();
    await user.click(nav('Docs'));
    expect(document.querySelector('.page-sweep-layer')?.textContent).toContain('Board');
  });

  it('never sweeps into or out of the home globe', async () => {
    motionAllowed();
    withWebGL2();
    const user = await fromKanban();
    await user.click(screen.getByRole('button', { name: /Second Brain/ }));
    expect(window.location.hash).toBe('#today');
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
    await user.click(nav('Today'));
    expect(document.querySelector('.page-sweep-layer')).toBeNull();
  });
});

// The top bar is sticky with a z-index, so it is a stacking context: its menus can only rise above the
// andliu.ai panel if the bar itself does. jsdom does not lay out, so this reads the rules themselves.
describe('top-bar menus over the andliu.ai panel', () => {
  const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src', file), 'utf8');
  const z = (text: string, selector: RegExp) => Number(text.match(selector)?.[1]);
  it('lifts the top bar above the panel while any of its popovers is open', () => {
    const styles = css('styles.css');
    const panel = z(css('chat.css'), /\.ai-panel\{[^}]*z-index:(\d+)/);
    const bar = z(styles, /^\.topbar\{position:sticky[^}]*z-index:(\d+)/m);
    const lifted = styles.match(/\.topbar:has\(([^)]*)\)\{z-index:(\d+)\}/);
    const sidebar = z(styles, /^\.sidebar\{[^}]*z-index:(\d+)/m);
    expect(bar).toBeLessThan(panel); // at rest the panel covers the bar, as before
    expect(lifted?.[1].split(',')).toEqual(expect.arrayContaining(['.pf-menu', '.notif-panel', '.focus-card', '.action-search-panel']));
    expect(Number(lifted?.[2])).toBeGreaterThan(panel);
    expect(Number(lifted?.[2])).toBeLessThan(sidebar);
  });
});
