// TodoCard: today's todos, one card. Props:
//   workspace: the Workspace; the list is workspace.todos, brought up to date by rollover() (lib/todos.ts)
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mount from Today.tsx with one line:
//   <TodoCard workspace={workspace} commit={commit}/>
//
// The header is the date and the time, and turns green once everything is done, with a confetti
// burst that prefers-reduced-motion switches off. Each todo has a category (its left edge and a chip),
// optional minutes, goal and time of day, all set from the row's options panel. A todo with a time can
// be sent to Google Calendar (POST /api/calendar/todo). Dragging a row out exposes it as
// application/x-brain-todo for the kanban; the todo stays here. "Yesterday" shows earlier days'
// completed todos from history, faded and read only.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { CalendarPlus, History, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import type { Todo, Todos, Workspace } from './types';
import { CATEGORIES, categoryOf, type CategoryId } from './lib/categories';
import { uid } from './lib/storage';
import { rollover, removeTodo, todoPayload, TODO_DRAG_TYPE } from './lib/todos';
import { api } from './lib/api';
import { AnimatedCheckbox } from '@/components/ui/animated-checkbox';
import { Confetti } from '@/components/ui/confetti';
import './todo.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Patch = (change: (todos: Todos) => Todos, message?: string) => Promise<boolean>;

const dateLabel = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const timeLabel = (at: Date) => at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function TodoCard({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  // Memoised on the stored list so a rollover (which mints ids) happens once per stored value, not per render.
  const todos = useMemo(() => rollover(workspace.todos), [workspace.todos]);
  useEffect(() => { if (todos !== workspace.todos) void commit(w => ({ ...w, todos })); }, [todos, workspace.todos, commit]);
  const patch: Patch = (change, message) => commit(w => ({ ...w, todos: change(w.todos ?? todos) }), message);

  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60000); return () => clearInterval(timer); }, []);
  const [showHistory, setShowHistory] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');

  const allDone = todos.items.length > 0 && todos.items.every(t => t.done);
  // The burst fires on the change to all done, not while it stays that way, so a reload does not re-fire it.
  const [burst, setBurst] = useState(false);
  const wasDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasDone.current) { setBurst(true); const timer = setTimeout(() => setBurst(false), 1800); wasDone.current = true; return () => clearTimeout(timer); }
    wasDone.current = allDone;
  }, [allDone]);

  function add(event: FormEvent) {
    event.preventDefault();
    const value = text.trim(); if (!value) return;
    void patch(t => ({ ...t, items: [...t.items, { id: uid(), text: value, done: false, category }] }));
    setText('');
  }
  const change = (id: string, update: Partial<Todo>) => patch(t => ({ ...t, items: t.items.map(item => item.id === id ? { ...item, ...update } : item) }));
  const days = Object.keys(todos.history).sort().reverse();

  return <section className="panel todo-card" aria-label="Today's todos">
    <header className="todo-head" data-done={allDone || undefined}>
      <div><h2>{dateLabel(todos.day)}</h2><p className="todo-time">{timeLabel(clock)}{allDone && ' · all done'}</p></div>
      <button type="button" className="text-button" aria-pressed={showHistory} onClick={() => setShowHistory(v => !v)}><History size={14}/>Yesterday</button>
    </header>
    <div className="todo-body">
      {burst && <Confetti colors={CATEGORIES.map(c => c.color)}/>}
      {todos.items.length === 0 && <p className="today-note">Nothing on the list. Add one below.</p>}
      <ul className="todo-list">
        {todos.items.map(item => <TodoRow key={item.id} todo={item} day={todos.day} change={update => change(item.id, update)} remove={() => patch(t => removeTodo(t, item.id), 'Todo removed')}/>)}
      </ul>
      <form className="todo-add" onSubmit={add}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a todo" aria-label="New todo"/>
        <select value={category} onChange={e => setCategory(e.target.value as CategoryId)} aria-label="Category for the new todo">{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <button type="submit" className="icon-button" aria-label="Add todo" disabled={!text.trim()}><Plus size={15}/></button>
      </form>
      {showHistory && <div className="todo-history" aria-label="Earlier days">
        {days.length === 0 && <p className="today-note">No earlier days yet.</p>}
        {days.map(day => <div key={day}><h3>{dateLabel(day)}</h3><ul className="todo-list">
          {todos.history[day].map(item => <li key={item.id} className="todo-item" data-done style={{ '--cat': categoryOf(item.category)?.color } as CSSProperties}><AnimatedCheckbox checked label={item.text} disabled/><div className="todo-main"><span className="todo-text">{item.text}</span></div></li>)}
        </ul></div>)}
      </div>}
    </div>
  </section>;
}

function TodoRow({ todo, day, change, remove }: { todo: Todo; day: string; change: (update: Partial<Todo>) => Promise<boolean>; remove: () => void }) {
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState<{ text: string; connect?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const cat = categoryOf(todo.category);
  function onDragStart(event: DragEvent) {
    event.dataTransfer.setData(TODO_DRAG_TYPE, JSON.stringify(todoPayload(todo)));
    event.dataTransfer.setData('text/plain', todo.text);
    event.dataTransfer.effectAllowed = 'copy';
  }
  function keys(event: KeyboardEvent) { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); menuButton.current?.focus(); } }
  async function addToCalendar() {
    if (!todo.time || busy) return;
    setBusy(true); setCalendar(null);
    try {
      const status = await api<{ connected: boolean }>('calendar/status');
      if (!status.connected) { setCalendar({ text: 'Google Calendar is not connected.', connect: true }); return; }
      // No estimate means no minutes key at all: the server defaults it, and refuses null.
      const reply = await api<{ ok?: boolean; eventId?: string; error?: string }>('calendar/todo', { title: todo.text, date: day, time: todo.time, minutes: todo.minutes });
      setCalendar({ text: reply.ok ? 'Added to your calendar.' : reply.error || 'The calendar did not accept it.' });
    } catch (error) { setCalendar({ text: String((error as Error).message || 'Could not reach the calendar.') }); }
    finally { setBusy(false); }
  }
  const number = (value: string) => value === '' ? undefined : Math.max(0, Math.round(Number(value)) || 0);
  return <li className="todo-item" data-done={todo.done || undefined} draggable onDragStart={onDragStart} onKeyDown={keys} style={{ '--cat': cat?.color } as CSSProperties}>
    <AnimatedCheckbox checked={todo.done} onChange={() => change({ done: !todo.done })} label={todo.text}/>
    <div className="todo-main">
      <span className="todo-text">{todo.text}</span>
      <div className="todo-chips">
        <span className="tag todo-cat">{cat?.label}</span>
        {todo.minutes !== undefined && <span className="tag">{todo.minutes} min</span>}
        {todo.goal && <span className="tag">{todo.goal}</span>}
        {todo.time && <span className="tag">{todo.time}</span>}
      </div>
    </div>
    <button ref={menuButton} type="button" className="icon-button" aria-label={`Options for ${todo.text}`} aria-expanded={open} onClick={() => setOpen(v => !v)}><MoreHorizontal size={15}/></button>
    {open && <div className="todo-options" role="group" aria-label={`Options for ${todo.text}`}>
      <label>Category<select value={todo.category} onChange={e => change({ category: e.target.value as CategoryId })}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Minutes<input type="number" min="0" step="5" value={todo.minutes ?? ''} onChange={e => change({ minutes: number(e.target.value) })}/></label>
      <label>Goal<input value={todo.goal ?? ''} onChange={e => change({ goal: e.target.value || undefined })} placeholder="What it is for"/></label>
      <label>Time<input type="time" value={todo.time ?? ''} onChange={e => change({ time: e.target.value || undefined })}/></label>
      <div className="todo-options-actions">
        {todo.time && <button type="button" className="button" onClick={addToCalendar} disabled={busy}><CalendarPlus size={14}/>Add to calendar</button>}
        <button type="button" className="button" onClick={remove}><Trash2 size={14}/>Delete{todo.defaultKey ? ' for good' : ''}</button>
      </div>
      {calendar && <p className="today-note" role="status">{calendar.text}{calendar.connect && <> <a href="/api/calendar/connect">Connect</a></>}</p>}
    </div>}
  </li>;
}
