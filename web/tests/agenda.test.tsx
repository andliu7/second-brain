// The shell after the 2026-09-24 restructure: Today (#agenda) composed of the finished pieces, Board
// and Buy as pages of their own, Files and Generate gone from the address, every nav row reachable.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url);
    const reply = path.includes('/calendar/status') ? { connected: false, reason: 'not connected yet' }
      : path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} }
      : path.endsWith('/projects') ? { repos: [], courses: [], blueberry: null, routines: [] } : path.endsWith('/tasks') ? { tasks: [] } : path.endsWith('/skills') ? { skills: [] } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
const columns = () => screen.getAllByRole('region').map(el => el.getAttribute('aria-label')).filter(name => ['To do', 'Doing', 'Done'].includes(name || ''));

describe('the shell after the restructure', () => {
  it('#agenda stacks the quote board, the todo card with its two defaults, no kanban, the calendar card and the heat calendar', async () => {
    location.hash = '#agenda';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Quote of the day' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Write for 15 minutes' })).toBeInTheDocument();
    // 2026-09-28: the board left Today ("remove kanban from today"); it is on #board only.
    expect(columns()).toEqual([]);
    // 2026-09-28: Today carries a small calendar card; the full month is its own page, #calendar.
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(calendar).toHaveClass('mini-cal');
    expect(within(calendar).getByText(new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))).toBeInTheDocument();
    expect(await within(calendar).findByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/api/calendar/connect');
    expect(document.querySelector('.heat-grid')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
    // The old page is still there under the new pieces, and Projects is a row at the end, not a nav item.
    expect(screen.getByLabelText('Your quick thought')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Projects/ })).toHaveAttribute('href', '#projects');
    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: 'Projects' })).toBeNull();
  });

  it('#board is the same kanban as a page of its own, and #buy is the buy list', async () => {
    location.hash = '#board';
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
    expect(columns()).toEqual(['To do', 'Doing', 'Done']);
    unmount();
    location.hash = '#buy';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Buy' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'To buy' })).toBeInTheDocument();
  });

  it('every nav row navigates, and the removed #files and #generate fall through to the home page', async () => {
    const user = userEvent.setup();
    // A bookmark to a removed page opens on the home globe, as any unknown hash does.
    for (const hash of ['#files', '#generate']) {
      location.hash = hash;
      const { unmount } = render(<App />);
      await waitFor(() => expect(document.querySelector('.app-shell')).toHaveClass('app-home'));
      unmount();
    }
    location.hash = '#agenda';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const nav = within(screen.getByRole('navigation'));
    // 2026-09-25: Buy and Goals live inside the Kanban page, Chat is andliu.ai, Network is not a tab.
    for (const [label, hash] of [['Kanban', '#board'], ['Skills', '#skills'], ['andliu.ai', '#chat'], ['Today', '#agenda']]) {
      await user.click(nav.getByRole('button', { name: new RegExp('^' + label) }));
      expect(location.hash).toBe(hash);
    }
    // Generate lives inside Chat, behind the Chat | Generate control.
    await user.click(nav.getByRole('button', { name: /^andliu\.ai/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Generate' })).toBeInTheDocument();
    expect(location.hash).toBe('#chat');
  });

  it('Today shows the small calendar card, not the big grid, and its link and days open #calendar', async () => {
    location.hash = '#agenda';
    render(<App />);
    const card = await screen.findByRole('region', { name: 'Calendar' });
    expect(document.querySelector('.month-grid')).toBeNull();
    expect(card.querySelectorAll('.mini-cal-day')).toHaveLength(42);
    expect(card.querySelectorAll('.mini-cal-day[data-today]')).toHaveLength(1);
    // Today has the two default todos, so today carries a dot.
    expect(card.querySelector('.mini-cal-day[data-today]')).toHaveAttribute('data-marked');
    expect(within(card).getByRole('link', { name: /Open calendar/ })).toHaveAttribute('href', '#calendar');
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(card.querySelector('.mini-cal-day[data-today]')).toHaveAttribute('href', '#calendar/' + day);
  });

  it('#calendar is the full month as a page with a way back to Today, and #calendar/<day> opens on that day', async () => {
    location.hash = '#calendar';
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(calendar).toHaveClass('month');
    expect(calendar.querySelectorAll('.month-day')).toHaveLength(42);
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '#agenda');
    unmount();
    location.hash = '#calendar/2025-03-14';
    render(<App />);
    const focused = await screen.findByRole('region', { name: 'Calendar' });
    expect(within(focused).getByRole('heading', { level: 2, name: new Date(2025, 2, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })).toBeInTheDocument();
    expect(focused.querySelector('.month-day[data-focus] .month-date')).toHaveTextContent('14');
  });
});
