// MonthCalendar: the full calendar page (#calendar), a port of ff_technical_instructions' master calendar
// (its .kcal block): month, week and list views, a search box, filter chips by colour, a colour key and an
// event dialog. It shows what the app already has: the Google Calendar events of the next 60 days
// (GET /api/calendar/events, server/calendar.mjs) and the todos in this browser (today's list and the kept
// history). A view, not a scheduler: nothing here adds or moves an event. Native Date only. Reads the calendar
// the way the kanban import does: status first, then events only when connected, and when it is not, one
// quiet line with the Connect link. Props:
//   focus: optional YYYY-MM-DD; the grid opens on that day's month with the day outlined
//   todos: workspace.todos, drawn as chips in their category colour
// Mount from App.tsx as the #calendar page (#calendar/<day> sets focus):
//   <MonthCalendar focus={day} todos={workspace.todos}/>
// MiniCalendar is Today's "Calendar and activity" card (Andrew, 2026-09-28: "calendar combine it with
// activity just make them expand when you click/hover"). It is always the full card since 2026-09-29 (Andrew:
// the "Show more" version "fills in the empty space"), so Show more, Show less and their remembered state
// are gone; a stale 'brain-calendar-expanded' value in localStorage is simply never read. Three parts: the
// month (arrows, today marked, each day shaded by how much was logged that day, the heat calendar's levels,
// with a dot under days with events or todos, each day a link to #calendar/<day>); this week's activity
// count and the heat calendar; and the detail of one day (today, or the day with keyboard focus).
// A hover changes nothing (Andrew, 2026-09-29: "the calendar should not change on hover"). Props:
//   todos: workspace.todos, whose days (today's list and history) get a dot
//   activity: workspace.activity, the log the shading and the heat calendar count
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, KeyRound, Loader2, Search, X } from 'lucide-react';
import { api } from './lib/api';
import { CATEGORIES, categoryOf, type CategoryId } from './lib/categories';
import { weekCounts, trend } from './lib/progress';
import { HeatCalendar, activityCounts, levelOf } from '@/components/ui/heat-calendar';
import type { CalendarEvent } from './Kanban';
import type { Activity, Todo, Todos } from './types';
import './month.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateOf = (day: string) => new Date(day + 'T12:00:00');
// An all-day event's start is already a local date; a timed one is an instant, read in local time.
const dayOf = (event: CalendarEvent) => event.allDay ? event.start.slice(0, 10) : key(new Date(event.start));
const timeOf = (event: CalendarEvent) => event.allDay ? '' : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const firstOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addDays = (date: Date, by: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + by);
const sundayOf = (date: Date) => addDays(date, -date.getDay());
// Six rows of seven from the Sunday on or before the 1st, so every month has the same height.
const monthCells = (month: Date) => Array.from({ length: 42 }, (_, i) => addDays(sundayOf(month), i));
const monthTitle = (month: Date) => month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const longDay = (day: string) => dateOf(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

// Both views read the calendar the same way: status, then the events only when connected.
function useCalendar() {
  const [status, setStatus] = useState<{ connected: boolean } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { (async () => { try { const reply = await api<{ connected: boolean }>('calendar/status'); setStatus(reply); if (reply.connected) setEvents((await api<{ events: CalendarEvent[] }>('calendar/events?days=60')).events || []); } catch (e) { setError(e instanceof Error ? e.message : 'Calendar unavailable'); } })(); }, []);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) { const day = dayOf(event); byDay.set(day, [...(byDay.get(day) || []), event]); }
  return { status, error, events, byDay };
}

// One thing on the calendar, whichever source it came from. kind is the filter and colour key: 'calendar'
// for a Google event, otherwise the todo's category.
type Kind = 'calendar' | CategoryId;
type Item = { id: string; title: string; day: string; time: string; order: string; kind: Kind; event?: CalendarEvent; todo?: Todo };

// A todo with a time is also sent to Google Calendar (TodoCard), so the same thing can arrive twice; the
// Google copy wins, since it is the one with a link.
function itemsOf(events: CalendarEvent[], todos?: Todos): Item[] {
  const items: Item[] = events.map(event => ({ id: 'e:' + event.id, title: event.title, day: dayOf(event), time: timeOf(event), order: event.allDay ? '' : event.start, kind: 'calendar', event }));
  const seen = new Set(items.map(item => item.day + '|' + item.title.toLowerCase()));
  const lists: [string, Todo[]][] = todos ? [...Object.entries(todos.history), [todos.day, todos.items]] : [];
  for (const [day, list] of lists) for (const todo of list) {
    if (seen.has(day + '|' + todo.text.toLowerCase())) continue;
    const time = todo.time ? new Date(`${day}T${todo.time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    items.push({ id: 't:' + day + ':' + todo.id, title: todo.text, day, time, order: todo.time ? `${day}T${todo.time}` : '', kind: todo.category, todo });
  }
  // All-day first, then by start time, the order a day reads in.
  return items.sort((a, b) => a.day.localeCompare(b.day) || (a.order ? 1 : 0) - (b.order ? 1 : 0) || a.order.localeCompare(b.order));
}

// The key: Google events in the accent, todos in their category colour. --c is the chip's pale fill and --d its
// stripe, the reference's two chip variables, mixed from one colour so they hold in both themes.
const KINDS: { id: Kind; label: string; color: string; note: string }[] = [
  { id: 'calendar', label: 'Google Calendar', color: 'var(--acc-fill)', note: 'Events from your connected Google Calendar, the next 60 days' },
  ...CATEGORIES.map(c => ({ id: c.id as Kind, label: c.label, color: c.color, note: `Todos in ${c.label}, from Today` })),
];
const kindOf = (id: Kind) => KINDS.find(k => k.id === id)!;
const swatch = (id: Kind) => ({ '--d': kindOf(id).color, '--c': `color-mix(in srgb,${kindOf(id).color} 18%,var(--sheet))` }) as CSSProperties;

type View = 'month' | 'week' | 'list';

export function MonthCalendar({ focus, todos }: { focus?: string; todos?: Todos }) {
  const focused = focus && /^\d{4}-\d{2}-\d{2}$/.test(focus) ? focus : undefined;
  const [anchor, setAnchor] = useState(() => focused ? dateOf(focused) : new Date());
  const [view, setView] = useState<View>('month');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Kind[]>([]);
  const [open, setOpen] = useState<Item | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const { status, error, events } = useCalendar();
  const today = key(new Date());
  const month = firstOf(anchor);

  const all = itemsOf(events, todos);
  const present = KINDS.filter(k => k.id === 'calendar' ? status?.connected : all.some(item => item.kind === k.id));
  const q = query.trim().toLowerCase();
  const shown = all.filter(item => (!filters.length || filters.includes(item.kind)) && (!q || item.title.toLowerCase().includes(q) || item.event?.location?.toLowerCase().includes(q)));
  const byDay = new Map<string, Item[]>();
  for (const item of shown) byDay.set(item.day, [...(byDay.get(item.day) || []), item]);

  // Month and list step a month; week steps seven days. "This" returns to today in either.
  const unit = view === 'week' ? 'week' : 'month';
  const step = (by: number) => setAnchor(a => view === 'week' ? addDays(a, 7 * by) : new Date(a.getFullYear(), a.getMonth() + by, 1));
  const week = Array.from({ length: 7 }, (_, i) => addDays(sundayOf(anchor), i));
  const title = view === 'week' ? `Week of ${week[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : monthTitle(month);
  const toggle = (id: Kind) => setFilters(list => list.includes(id) ? list.filter(k => k !== id) : [...list, id]);
  const monthItems = [...byDay.entries()].filter(([day]) => day.slice(0, 7) === key(month).slice(0, 7));

  const chip = (item: Item, className: string) => <button type="button" key={item.id} className={className} style={swatch(item.kind)} title={item.title} data-done={item.todo?.done || undefined} onClick={() => setOpen(item)}>
    {item.time && <small>{item.time}</small>}{item.title}
  </button>;

  return <section className="panel month kcal" aria-label="Calendar">
    <div className="kcal-head">
      <h2 className="kcal-title">{title}</h2>
      <div className="kcal-nav">
        <button type="button" className="icon-button" aria-label={`Previous ${unit}`} onClick={() => step(-1)}><ChevronLeft size={16}/></button>
        <button type="button" className="button small" onClick={() => setAnchor(new Date())}>This {unit}</button>
        <button type="button" className="icon-button" aria-label={`Next ${unit}`} onClick={() => step(1)}><ChevronRight size={16}/></button>
      </div>
      <div className="kcal-views" role="group" aria-label="View">
        {(['month', 'week', 'list'] as View[]).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
      </div>
      <button type="button" className="button small" onClick={() => setKeyOpen(true)}><KeyRound size={14}/>Key</button>
    </div>

    <div className="kcal-tools">
      <label className="kcal-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search events" placeholder="Search events and todos" value={query} onChange={e => setQuery(e.target.value)}/>
        {query && <button type="button" className="kcal-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}
      </label>
      {present.length > 0 && <div className="kcal-cats" role="group" aria-label="Filter by colour">
        {present.map(k => <button key={k.id} type="button" className="kcal-cat" style={swatch(k.id)} aria-pressed={filters.includes(k.id)} onClick={() => toggle(k.id)}><span className="dot" aria-hidden="true"/>{k.label}</button>)}
      </div>}
    </div>
    {(filters.length > 0 || q) && <p className="kcal-active">Showing {shown.length} of {all.length}<button type="button" className="text-button" onClick={() => { setFilters([]); setQuery(''); }}>Clear filters</button></p>}

    {!status && !error && <p className="today-note"><Loader2 className="spin" size={14}/>Checking the calendar</p>}
    {status && !status.connected && <p className="today-note">No calendar is connected. <a href="/api/calendar/connect">Connect</a></p>}
    {error && <p className="today-note error-text" role="alert">{error}</p>}

    {view === 'month' && <div className="month-grid">
      {WEEKDAYS.map(day => <span key={day} className="month-weekday">{day}</span>)}
      {monthCells(month).map(date => { const k = key(date); const list = byDay.get(k) || []; return <div key={k} className="month-day" data-today={k === today || undefined} data-focus={k === focused || undefined} data-outside={date.getMonth() !== month.getMonth() || undefined}>
        <span className="month-date">{date.getDate()}</span>
        {list.slice(0, 3).map(item => chip(item, 'month-event'))}
        {list.length > 3 && <button type="button" className="kcal-more" onClick={() => { setAnchor(date); setView('week'); }}>+{list.length - 3} more</button>}
      </div>; })}
    </div>}

    {view === 'week' && <div className="kcal-week">
      {week.map(date => { const k = key(date); const list = byDay.get(k) || []; return <div key={k} className="kcal-wcol" data-today={k === today || undefined}>
        <div className="kcal-wh">{WEEKDAYS[date.getDay()]}<b>{date.getDate()}</b></div>
        {list.map(item => chip(item, 'kcal-card'))}
        {!list.length && <p className="kcal-none">Nothing</p>}
      </div>; })}
    </div>}

    {view === 'list' && <div className="kcal-list">
      {monthItems.length ? monthItems.map(([day, list]) => <div key={day} className="kcal-lday" data-today={day === today || undefined}>
        <h3>{day === today ? 'Today, ' : ''}{longDay(day)}</h3>
        {list.map(item => <button type="button" key={item.id} className="kcal-row" style={swatch(item.kind)} onClick={() => setOpen(item)}>
          <span className="dot" aria-hidden="true"/>
          <span className="body"><b data-done={item.todo?.done || undefined}>{item.title}</b><span className="meta">{item.time || 'All day'}{item.event?.location ? ` · ${item.event.location}` : ''}</span></span>
          <span className="kcal-tag">{kindOf(item.kind).label}</span>
        </button>)}
      </div>) : <p className="kcal-empty">{q || filters.length ? 'Nothing matches in ' : 'Nothing in '}{monthTitle(month)}.</p>}
    </div>}

    <p className="kcal-foot">{status?.connected ? `Google Calendar connected, ${events.length} event${events.length === 1 ? '' : 's'} in the next 60 days.` : 'Google Calendar not connected.'} Todos come from Today, in this browser.</p>

    {open && <ItemDialog item={open} close={() => setOpen(null)}/>}
    {keyOpen && <KeyDialog close={() => setKeyOpen(false)}/>}
  </section>;
}

// Native <dialog> opened with showModal, so Escape and the backdrop behave the way the browser's own do.
function useModal(close: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return { ref, onCancel: (e: SyntheticEvent) => { e.preventDefault(); close(); }, onClick: (e: MouseEvent) => { if (e.target === ref.current) close(); } };
}

function ItemDialog({ item, close }: { item: Item; close: () => void }) {
  const modal = useModal(close);
  const kind = kindOf(item.kind);
  return <dialog className="kcal-dialog" aria-label={item.title} {...modal}>
    <div className="kcal-dh" style={swatch(item.kind)}><span className="dot" aria-hidden="true"/><h3>{item.title}</h3><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={16}/></button></div>
    <div className="kcal-db">
      <p className="lbl">When</p><p className="val">{longDay(item.day)}{item.time ? `, ${item.time}` : item.event ? ', all day' : ''}</p>
      <p className="lbl">From</p><p className="val">{item.event ? 'Google Calendar' : `Todo, ${categoryOf(item.todo!.category)?.label || kind.label}`}</p>
      {item.event?.location && <><p className="lbl">Where</p><p className="val">{item.event.location}</p></>}
      {item.todo && <><p className="lbl">Status</p><p className="val">{item.todo.done ? 'Done' : 'Not done yet'}{item.todo.minutes ? `, ${item.todo.minutes} minutes` : ''}</p></>}
    </div>
    <div className="kcal-df">
      {item.event?.link && <a className="button" href={item.event.link} target="_blank" rel="noreferrer">Open in Google Calendar<ArrowUpRight size={14}/></a>}
      {item.todo && <a className="button" href="#agenda" onClick={close}>Open Today</a>}
      <button type="button" className="button primary" onClick={close}>Done</button>
    </div>
  </dialog>;
}

function KeyDialog({ close }: { close: () => void }) {
  const modal = useModal(close);
  return <dialog className="kcal-dialog" aria-label="Colour key" {...modal}>
    <div className="kcal-dh"><h3>Colour key</h3><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={16}/></button></div>
    <div className="kcal-db"><ul className="kcal-key">
      {KINDS.map(k => <li key={k.id} style={swatch(k.id)}><span className="sw" aria-hidden="true"/><span><b>{k.label}</b><span>{k.note}</span></span></li>)}
    </ul></div>
    <div className="kcal-df"><button type="button" className="button primary" onClick={close}>Done</button></div>
  </dialog>;
}

const ARROWS = { up: '↑', down: '↓', flat: '→' };

export function MiniCalendar({ todos, activity = [] }: { todos?: Todos; activity?: Activity[] }) {
  const [month, setMonth] = useState(() => firstOf(new Date()));
  const { status, error, byDay } = useCalendar();
  const today = key(new Date());
  const [day, setDay] = useState(today);

  const todosOn = (k: string): Todo[] => todos ? (k === todos.day ? todos.items : todos.history[k] || []) : [];
  const counts = activityCounts(activity);
  const cells = monthCells(month);
  // Levels are relative to the busiest day in the month on screen, so a quiet month still shows its shape.
  const max = Math.max(1, ...cells.map(date => counts.get(key(date)) || 0));
  const step = (by: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const week = weekCounts(activity);
  const change = trend(week.thisWeek, week.lastWeek, 'last week');
  const logged = activity.filter(entry => key(new Date(entry.created)) === day);
  const planned = [
    ...(byDay.get(day) || []).map(event => ({ id: 'e:' + event.id, text: event.title, time: timeOf(event), done: false })),
    ...todosOn(day).map(todo => ({ id: 't:' + todo.id, text: todo.text, time: '', done: todo.done })),
  ];

  return <section className="panel mini-cal" aria-label="Calendar and activity">
    <div className="section-heading">
      <h2><CalendarDays size={16}/>Calendar and activity</h2>
      <a className="text-button" href="#calendar">Open calendar<ArrowUpRight size={14}/></a>
    </div>
    <div className="mini-cal-body">
      <div className="mini-cal-month">
        <div className="mini-cal-nav">
          <button type="button" className="icon-button" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={15}/></button>
          <strong aria-live="polite">{monthTitle(month)}</strong>
          <button type="button" className="icon-button" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={15}/></button>
        </div>
        <div className="mini-cal-grid">
          {WEEKDAYS.map(name => <span key={name} className="mini-cal-weekday" aria-hidden="true">{name.slice(0, 2)}</span>)}
          {cells.map(date => {
            const k = key(date);
            const marked = byDay.has(k) || todosOn(k).length > 0;
            const count = counts.get(k) || 0;
            const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + (marked ? ', has events or todos' : '') + (count ? `, ${count} ${count === 1 ? 'activity' : 'activities'}` : '');
            return <a key={k} href={'#calendar/' + k} className="mini-cal-day" aria-label={label} onFocus={() => setDay(k)}
              data-today={k === today || undefined} data-outside={date.getMonth() !== month.getMonth() || undefined} data-marked={marked || undefined} data-level={levelOf(count, max)} data-shown={k === day || undefined}>{date.getDate()}</a>;
          })}
        </div>
        {status && !status.connected && <p className="today-note">No calendar is connected. <a href="/api/calendar/connect">Connect</a></p>}
        {error && <p className="today-note error-text" role="alert">{error}</p>}
      </div>
      <div className="mini-cal-more">
        <div className="mini-cal-activity">
          <h3>Activity</h3>
          {activity.length ? <>
            <p className="mini-cal-big"><strong>{week.thisWeek}</strong> this week <span className="mini-cal-change" data-dir={change.dir}><span aria-hidden="true">{ARROWS[change.dir]}</span> {change.text}</span></p>
            <HeatCalendar activity={activity} weeks={16}/>
          </> : <p className="mini-cal-empty">No activity yet; everything you add or change is logged here.</p>}
        </div>
        <div className="mini-cal-detail" aria-live="polite">
          <h3>{day === today ? 'Today, ' : ''}{longDay(day)}</h3>
          {planned.length ? <ul>{planned.map(item => <li key={item.id} data-done={item.done || undefined}>{item.time && <small>{item.time}</small>}{item.text}</li>)}</ul> : <p className="mini-cal-empty">No events or todos.</p>}
          <p className="mini-cal-logged">{logged.length ? `${logged.length} ${logged.length === 1 ? 'thing' : 'things'} logged: ${logged.slice(0, 3).map(entry => entry.text).join('; ')}${logged.length > 3 ? '; and more' : ''}` : 'Nothing logged.'}</p>
          <a className="text-button" href={'#calendar/' + day}>Open this day<ArrowUpRight size={14}/></a>
        </div>
      </div>
    </div>
  </section>;
}
