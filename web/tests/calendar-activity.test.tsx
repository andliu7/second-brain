// Today's "Calendar and activity" card (MiniCalendar in MonthCalendar.tsx): the small month with each day
// shaded by its activity, which Show more (kept) expands into the heat calendar and
// one day's detail. It replaced the separate Activity widget on 2026-09-28.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MiniCalendar } from '../src/MonthCalendar';
import type { Activity, Todos } from '../src/types';

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = key(new Date());
const at = (day: string, i: number): Activity => ({ id: `${day}-${i}`, text: `Did thing ${i}`, page: 'today', created: new Date(`${day}T12:00:00`).toISOString() });
const card = () => screen.getByRole('region', { name: 'Calendar and activity' });
const cell = (day: string) => card().querySelector(`.mini-cal-day[href="#calendar/${day}"]`)!;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ connected: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
});

describe('the calendar and activity card', () => {
  it('shades each day of the month by its activity, relative to the busiest day on screen', () => {
    const first = `${today.slice(0, 7)}-01`;
    const activity = [...[0, 1, 2, 3].map(i => at(today, i)), at(first, 9)];
    render(<MiniCalendar activity={activity}/>);
    expect(cell(today)).toHaveAttribute('data-level', '4');
    if (first !== today) expect(cell(first)).toHaveAttribute('data-level', '1');
    expect(cell(today).getAttribute('aria-label')).toMatch(/, 4 activities$/);
    // Collapsed: no heat calendar and no day detail yet.
    expect(card().querySelector('.heat-grid')).toBeNull();
    expect(card()).not.toHaveAttribute('data-expanded');
  });

  it('Show more opens the heat calendar and today\'s detail, and is remembered; Show less closes it', async () => {
    const user = userEvent.setup();
    const todos: Todos = { day: today, items: [{ id: 'r', text: 'Read for 15 minutes', done: false, category: 'academic' }], history: {}, removedDefaults: [] };
    const { unmount } = render(<MiniCalendar todos={todos} activity={[at(today, 1)]}/>);
    const more = within(card()).getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(card().querySelector('.heat-grid')).not.toBeNull();
    expect(within(card()).getByText(/this week/)).toHaveTextContent('1 this week');
    const detail = card().querySelector('.mini-cal-detail') as HTMLElement;
    expect(within(detail).getByRole('heading', { level: 3 })).toHaveTextContent(/^Today, /);
    expect(within(detail).getByText('Read for 15 minutes')).toBeInTheDocument();
    expect(within(detail).getByText('1 thing logged: Did thing 1')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: /Open this day/ })).toHaveAttribute('href', '#calendar/' + today);
    unmount();
    render(<MiniCalendar activity={[]}/>);                       // a later visit opens as it was left
    expect(card()).toHaveAttribute('data-expanded');
    expect(within(card()).getByText('No activity yet; everything you add or change is logged here.')).toBeInTheDocument();
    await user.click(within(card()).getByRole('button', { name: 'Show less' }));
    expect(card()).not.toHaveAttribute('data-expanded');
  });

  it('a hover changes nothing: only Show more and Show less open and close it', () => {
    // Andrew, 2026-09-29: "the calendar should not change on hover". This replaced a 200ms hover preview.
    // jsdom has no PointerEvent, so without this every pointer event would arrive with no pointerType.
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType: string; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ''; } });
    vi.useFakeTimers();
    render(<MiniCalendar activity={[at(today, 1)]}/>);
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' });
    fireEvent.pointerEnter(cell(today), { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(card()).not.toHaveAttribute('data-expanded');
    expect(card().querySelector('.heat-grid')).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: 'Show more' }));
    expect(card()).toHaveAttribute('data-expanded');
    const other = card().querySelector(`.mini-cal-day:not([href="#calendar/${today}"])`)!;
    fireEvent.pointerEnter(other, { pointerType: 'mouse' });     // nor does a day under the pointer swap the detail
    expect(within(card().querySelector('.mini-cal-detail') as HTMLElement).getByRole('heading', { level: 3 })).toHaveTextContent(/^Today, /);
    fireEvent.pointerLeave(card());                            // leaving does not close it either
    act(() => { vi.advanceTimersByTime(1000); });
    expect(card()).toHaveAttribute('data-expanded');
    vi.useRealTimers();
  });
});
