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
  it('#agenda stacks the quote board, the todo card with its two defaults, the kanban, the month calendar and the heat calendar', async () => {
    location.hash = '#agenda';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Quote of the day' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Write for 15 minutes' })).toBeInTheDocument();
    expect(columns()).toEqual(['To do', 'Doing', 'Done']);
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(within(calendar).getByRole('heading', { level: 2, name: new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })).toBeInTheDocument();
    expect(await within(calendar).findByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/api/calendar/connect');
    expect(document.querySelector('.heat-grid')).toBeInTheDocument();
    // One h1 per page: the board's title is a section heading here and the page's h1 on #board.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Board' })).toBeInTheDocument();
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
    for (const [label, hash] of [['Board', '#board'], ['Buy', '#buy'], ['Skills', '#skills'], ['Chat', '#chat'], ['Goals', '#goals'], ['Today', '#agenda']]) {
      await user.click(nav.getByRole('button', { name: new RegExp('^' + label) }));
      expect(location.hash).toBe(hash);
    }
    // Generate lives inside Chat, behind the Chat | Generate control.
    await user.click(nav.getByRole('button', { name: /^Chat/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Generate' })).toBeInTheDocument();
    expect(location.hash).toBe('#chat');
  });
});
