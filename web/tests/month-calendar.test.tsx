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
