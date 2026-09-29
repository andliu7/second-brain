// HomeToday: "Today at a glance" on the home globe. A Today tab at the bottom left opens a card
// over the globe's left side, in the place the categories panel holds (Home.tsx hides the
// categories while it is open, so the two never stack). Props:
//   workspace, commit: App's, as TodoCard takes them; a tick commits the whole todo list
//   capture: App's captureNote, the same quick capture the Today page uses
//   open, setOpen: owned by Home, which remembers the choice beside the title and categories
//   crowded: the side panel (tree or file) is open, so a narrow screen has no room for this card as well
// The plain version of the "Peel" Andrew asked for (the page peeling back to show a layer under
// it): Peel needed a Chrome-only API and outside code, so this is a CSS slide and nothing else.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { Workspace } from './types';
import type { CalendarEvent } from './Kanban';
import { byPriority, rollover } from './lib/todos';
import { today } from './lib/storage';
import { api } from './lib/api';
import { AnimatedCheckbox } from '@/components/ui/animated-checkbox';
import './todo.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Props = { workspace: Workspace; commit: Commit; capture: (text: string) => Promise<boolean>; open: boolean; setOpen: (open: boolean) => void; crowded: boolean };

const whenOf = (event: CalendarEvent) => event.allDay
  ? new Date(event.start.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  : new Date(event.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function HomeToday({ workspace, commit, capture, open, setOpen, crowded }: Props) {
  const tab = useRef<HTMLButtonElement>(null);
  // Memoised on the stored list, as in TodoCard, so the ids rollover mints for a returning default hold still between renders.
  // Keyed on the local day as well, so any render after midnight (opening the card, a tick) shows the new day.
  const day = today();
  const todos = useMemo(() => rollover(workspace.todos, day), [workspace.todos, day]);
  const [next, setNext] = useState<CalendarEvent | null>(null);
  const [text, setText] = useState(''); const [saving, setSaving] = useState(false);

  // The calendar is read as MonthCalendar reads it, status and then events only when connected,
  // and only while the card is open. Not connected, unreachable, or nothing ahead: no line at all.
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      try {
        const status = await api<{ connected?: boolean }>('calendar/status'); if (!status.connected) return;
        const reply = await api<{ events?: CalendarEvent[] }>('calendar/events?days=14'); const now = Date.now();
        const soonest = (reply.events || []).filter(event => new Date(event.end).getTime() > now).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
        if (live) setNext(soonest ?? null);
      } catch { /* no calendar, no line */ }
    })();
    return () => { live = false; };
  }, [open]);

  // The list as shown is the base, unless the store moved on since this render: rollover run again
  // on the same stored list would mint new ids for its defaults, and the one ticked would be lost.
  const tick = (id: string) => commit(w => { const base = w.todos === workspace.todos ? todos : rollover(w.todos); return { ...w, todos: { ...base, items: base.items.map(t => t.id === id ? { ...t, done: !t.done } : t) } }; });
  async function save() {
    const value = text.trim(); if (!value || saving) return;
    setSaving(true); if (await capture(value)) setText(''); setSaving(false);
  }
  // Escape closes the card from anywhere inside it or on the tab, and stops there, so the detail
  // panel's own Escape (a listener on window) does not close as well.
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation(); event.preventDefault(); setOpen(false); tab.current?.focus();
  }

  return <div className={`home-today ${crowded ? 'home-today-crowded' : ''}`} onKeyDown={onKey}>
    {open && <aside className="home-today-card" id="home-today" aria-label="Today at a glance">
      <h2>{new Date(todos.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      {todos.items.length === 0 ? <p className="muted">Nothing on the list.</p>
        : <ul className="home-today-todos">{byPriority(todos.items).map(item => <li key={item.id} data-done={item.done || undefined}>
          <AnimatedCheckbox checked={item.done} onChange={() => void tick(item.id)} label={item.text}/><span>{item.text}</span>
        </li>)}</ul>}
      {next && <p className="home-today-next"><CalendarDays size={14}/><span>{next.title}</span><small>{whenOf(next)}</small></p>}
      <label className="sr-only" htmlFor="home-today-capture">Quick capture</label>
      <textarea id="home-today-capture" value={text} onChange={event => setText(event.target.value)} placeholder="A thought, Ctrl+Enter to save" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }}/>
      <button type="button" className="button small primary" onClick={() => void save()} disabled={!text.trim() || saving}>{saving && <Loader2 className="spin" size={14}/>}Save</button>
    </aside>}
    <button ref={tab} type="button" className="button small home-today-tab" aria-expanded={open} aria-controls="home-today" aria-label="Today at a glance" title="Today at a glance" onClick={() => setOpen(!open)}>Today{open ? <ChevronLeft size={14}/> : <ChevronRight size={14}/>}</button>
  </div>;
}
