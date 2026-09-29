import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(within(nav).getAllByRole('button').map(b => b.textContent?.replace(/\d+|AI/g, '').trim())).toEqual(['Second Brain.', 'Today', 'Kanban', 'Skills', 'andliu.ai', 'Docs', 'Whiteboard', 'PDF tools', 'Settings', 'Collapse sidebar']); // 2026-09-28: Resume left the nav for Docs (a note of kind Resume; #resume still opens). Docs, Whiteboard and Resume joined the nav; PDF tools joined after them
    // The Kanban page carries the board, the day's todos, the buy list and the goals together.
    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'To buy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Goals' })).toBeInTheDocument(); // one h1 per page: Goals is a block here
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
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
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveValue('claude-sonnet-5');
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

// Andrew, 2026-09-28: the sidebar folds to an icon rail on every page, and the Kanban page is the board
// first, full width, with the other lists under it.
describe('the collapsible sidebar and the Kanban page layout', () => {
  beforeEach(() => localStorage.clear());

  it('folds to an icon rail from its button, keeps every name, and remembers the choice', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    const { unmount } = render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    const shell = nav.closest('.app-shell')!;
    expect(shell).not.toHaveClass('sidebar-collapsed');
    await user.click(within(nav).getByRole('button', { name: 'Collapse sidebar' }));
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(localStorage.getItem('brain-sidebar-collapsed')).toBe('1');
    // Icons only, but each button keeps its accessible name and gets a tooltip.
    expect(within(nav).getByRole('button', { name: 'Kanban' })).toHaveAttribute('title', 'Kanban');
    expect(within(nav).getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings');
    expect(within(nav).getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    // A reload opens folded.
    render(<App/>);
    const again = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    expect(again.closest('.app-shell')).toHaveClass('sidebar-collapsed');
    await user.click(within(again).getByRole('button', { name: 'Expand sidebar' }));
    expect(again.closest('.app-shell')).not.toHaveClass('sidebar-collapsed');
    expect(localStorage.getItem('brain-sidebar-collapsed')).toBe('0');
  });

  it('Ctrl B toggles it anywhere except while typing in a field', async () => {
    const user = userEvent.setup();
    window.location.hash = 'board';
    render(<App/>);
    const nav = await screen.findByRole('complementary', { name: 'Workspace navigation' });
    const shell = nav.closest('.app-shell')!;
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).toHaveClass('sidebar-collapsed');
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).not.toHaveClass('sidebar-collapsed');
    await user.click(screen.getByRole('textbox', { name: 'New todo' }));
    await user.keyboard('{Control>}b{/Control}');
    expect(shell).not.toHaveClass('sidebar-collapsed');
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
