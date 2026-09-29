import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthCalendar } from '../src/MonthCalendar';

const monthTitle = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const at = (daysFromNow: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, 30, 0, 0); return d; };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let requests: string[] = [];
function stubCalendar(connected: boolean, events: object[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url); requests.push(path);
    const reply = path.includes('/calendar/status') ? { connected } : path.includes('/calendar/events') ? { events } : { error: 'unexpected ' + path };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
beforeEach(() => { requests = []; });

describe('the month calendar', () => {
  it('draws this month, six rows of seven with today marked, and the events of the next 60 days as chips', async () => {
    const today = at(0, 14);
    stubCalendar(true, [
      { id: 'e1', title: 'Office hours', start: today.toISOString(), end: at(0, 15).toISOString(), allDay: false },
      { id: 'e2', title: 'Lab due', start: key(at(1, 9)), end: key(at(2, 9)), allDay: true },
    ]);
    render(<MonthCalendar/>);
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(within(calendar).getByRole('heading', { level: 2, name: monthTitle(today) })).toBeInTheDocument();
    expect(calendar.querySelectorAll('.month-weekday')).toHaveLength(7);
    expect(calendar.querySelectorAll('.month-day')).toHaveLength(42);
    expect(calendar.querySelectorAll('.month-day[data-today]')).toHaveLength(1);
    expect(calendar.querySelector('.month-day[data-today] .month-date')).toHaveTextContent(String(today.getDate()));
    const chip = await within(calendar).findByTitle('Office hours');
    expect(chip.closest('.month-day')).toHaveAttribute('data-today');
    expect(chip).toHaveTextContent(today.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(requests.some(url => url.endsWith('/api/calendar/events?days=60'))).toBe(true);
    // An all-day event sits on its own date, with no time. It may fall in next month.
    const user = userEvent.setup();
    if (at(1, 9).getMonth() !== today.getMonth()) await user.click(screen.getByRole('button', { name: 'Next month' }));
    const allDay = within(calendar).getByTitle('Lab due');
    expect(allDay.querySelector('small')).toBeNull();
    expect(allDay.closest('.month-day')?.querySelector('.month-date')).toHaveTextContent(String(at(1, 9).getDate()));
  });

  it('moves a month back and forward, and This month returns', async () => {
    stubCalendar(true);
    const user = userEvent.setup();
    render(<MonthCalendar/>);
    const now = new Date();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { level: 2, name: monthTitle(new Date(now.getFullYear(), now.getMonth() + 1, 1)) })).toBeInTheDocument();
    expect(document.querySelectorAll('.month-day')).toHaveLength(42);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { level: 2, name: monthTitle(new Date(now.getFullYear(), now.getMonth() - 1, 1)) })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByRole('heading', { level: 2, name: monthTitle(now) })).toBeInTheDocument();
  });

  it('says so in one line, with a Connect link, when no calendar is connected, and asks for no events', async () => {
    stubCalendar(false);
    render(<MonthCalendar/>);
    expect(await screen.findByText(/No calendar is connected/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/api/calendar/connect');
    expect(requests.some(url => url.includes('/calendar/events'))).toBe(false);
    expect(document.querySelectorAll('.month-day')).toHaveLength(42);
  });
});

describe('the full calendar, ported from the technical instructions master calendar', () => {
  const todosToday = () => ({ day: key(new Date()), items: [{ id: 't1', text: 'Read 15 minutes', done: false, category: 'academic' as const }, { id: 't2', text: 'Gym', done: true, category: 'fitness' as const }], history: {}, removedDefaults: [] });

  it('shows todos beside the events, opens either in a dialog, and switches to week and list views', async () => {
    stubCalendar(true, [{ id: 'e1', title: 'Office hours', start: at(0, 14).toISOString(), end: at(0, 15).toISOString(), allDay: false, location: 'IRB 1116', link: 'https://calendar.google.com/e1' }]);
    const user = userEvent.setup();
    render(<MonthCalendar todos={todosToday()}/>);
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    await within(calendar).findByTitle('Office hours');
    const todo = within(calendar).getByTitle('Read 15 minutes');
    expect(todo.closest('.month-day')).toHaveAttribute('data-today');
    await user.click(within(calendar).getByTitle('Office hours'));
    const dialog = screen.getByRole('dialog', { name: 'Office hours' });
    expect(dialog).toHaveTextContent('IRB 1116');
    expect(within(dialog).getByRole('link', { name: /Open in Google Calendar/ })).toHaveAttribute('href', 'https://calendar.google.com/e1');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
    expect(calendar.querySelectorAll('.kcal-wcol')).toHaveLength(7);
    expect(calendar.querySelector('.kcal-wcol[data-today]')).toHaveTextContent('Office hours');

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(within(calendar).getByRole('heading', { level: 3, name: /^Today, / })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: /Gym/ })).toHaveTextContent('Fitness');
  });

  it('searches, filters by colour, and says how many are shown', async () => {
    stubCalendar(true, [{ id: 'e1', title: 'Office hours', start: at(0,14).toISOString(), end: at(0, 15).toISOString(), allDay: false }]);
    const user = userEvent.setup();
    render(<MonthCalendar todos={todosToday()}/>);
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    await within(calendar).findByTitle('Office hours');
    await user.type(screen.getByRole('searchbox', { name: 'Search events' }), 'office');
    expect(within(calendar).queryByTitle('Read 15 minutes')).toBeNull();
    expect(screen.getByText(/Showing 1 of 3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    const filters = screen.getByRole('group', { name: 'Filter by colour' });
    await user.click(within(filters).getByRole('button', { name: 'Academic' }));
    expect(within(filters).getByRole('button', { name: 'Academic' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(calendar).getByTitle('Read 15 minutes')).toBeInTheDocument();
    expect(within(calendar).queryByTitle('Office hours')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(calendar).getByTitle('Office hours')).toBeInTheDocument();
  });

  it('has a colour key that names every colour', async () => {
    stubCalendar(false);
    const user = userEvent.setup();
    render(<MonthCalendar/>);
    await user.click(screen.getByRole('button', { name: 'Key' }));
    const key = screen.getByRole('dialog', { name: 'Colour key' });
    for (const label of ['Google Calendar', 'Project', 'Family', 'Academic', 'Professional', 'Fitness', 'Relationships', 'Urgent', 'Other']) expect(key).toHaveTextContent(label);
  });
});
