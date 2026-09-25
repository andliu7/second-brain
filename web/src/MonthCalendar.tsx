// MonthCalendar: one month as a grid, Sunday first, six rows, today marked, with the Google Calendar
// events of the next 60 days (GET /api/calendar/events, server/calendar.mjs) as chips on their days.
// A view, not a scheduler: nothing here adds or moves an event. Native Date only. Reads the calendar
// the way the kanban import does: status first, then events only when connected, and when it is not,
// one quiet line with the Connect link. No props.
// Mount from Today.tsx with one line:
//   <MonthCalendar/>
import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from './lib/api';
import type { CalendarEvent } from './Kanban';
import './month.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// An all-day event's start is already a local date; a timed one is an instant, read in local time.
const dayOf = (event: CalendarEvent) => event.allDay ? event.start.slice(0, 10) : key(new Date(event.start));
const timeOf = (event: CalendarEvent) => event.allDay ? '' : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const firstOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

export function MonthCalendar() {
  const [month, setMonth] = useState(() => firstOf(new Date()));
  const [status, setStatus] = useState<{ connected: boolean } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { (async () => { try { const reply = await api<{ connected: boolean }>('calendar/status'); setStatus(reply); if (reply.connected) setEvents((await api<{ events: CalendarEvent[] }>('calendar/events?days=60')).events || []); } catch (e) { setError(e instanceof Error ? e.message : 'Calendar unavailable'); } })(); }, []);

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) { const day = dayOf(event); byDay.set(day, [...(byDay.get(day) || []), event]); }
  // Six rows of seven from the Sunday on or before the 1st, so every month has the same height.
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = key(new Date());
  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const step = (by: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + by, 1));

  return <section className="panel month" aria-label="Calendar">
    <div className="section-heading">
      <h2><CalendarDays size={16}/>{title}</h2>
      <div className="month-nav">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={16}/></button>
        <button type="button" className="text-button" onClick={() => setMonth(firstOf(new Date()))}>This month</button>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={16}/></button>
      </div>
    </div>
    {!status && !error && <p className="today-note"><Loader2 className="spin" size={14}/>Checking the calendar</p>}
    {status && !status.connected && <p className="today-note">No calendar is connected. <a href="/api/calendar/connect">Connect</a></p>}
    {error && <p className="today-note error-text" role="alert">{error}</p>}
    <div className="month-grid">
      {WEEKDAYS.map(day => <span key={day} className="month-weekday">{day}</span>)}
      {cells.map(date => { const k = key(date); return <div key={k} className="month-day" data-today={k === today || undefined} data-outside={date.getMonth() !== month.getMonth() || undefined}>
        <span className="month-date">{date.getDate()}</span>
        {(byDay.get(k) || []).map(event => <span key={event.id} className="month-event" title={event.title}>{timeOf(event) && <small>{timeOf(event)}</small>}{event.title}</span>)}
      </div>; })}
    </div>
  </section>;
}
