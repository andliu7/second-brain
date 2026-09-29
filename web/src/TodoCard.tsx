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
// application/x-brain-todo for the kanban; the todo stays here.
//
// The card is short on purpose (Andrew, 2026-09-29: the calendar and activity card takes the room, the
// todos sit under it): it shows the top three by byPriority (lib/todos.ts) and the add row. "Show more (n)"
// opens the whole list in a large centred <dialog> with every control, and "Earlier" there shows every
// earlier day's completed todos from history, newest first, faded and read only. A todo can carry an
// urgency and an importance, 1 to 5 each; one chip shows both ("4·3") and opens a small editor for them.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarPlus, History, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import type { Todo, Todos, Workspace } from './types';
import { CATEGORIES, categoryOf, type CategoryId } from './lib/categories';
import { today, uid } from './lib/storage';
import { byPriority, rollover, removeTodo, todoPayload, TODO_DRAG_TYPE } from './lib/todos';
import { api } from './lib/api';
import { playReward } from './lib/sounds';
import { AnimatedCheckbox } from '@/components/ui/animated-checkbox';
import { Confetti } from '@/components/ui/confetti';
import './todo.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Patch = (change: (todos: Todos) => Todos, message?: string) => Promise<boolean>;

const dateLabel = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const timeLabel = (at: Date) => at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
// How many todos the card itself shows; the rest are one click away in the full list.
const ON_CARD = 3;

export function TodoCard({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  // Memoised on the stored list so a rollover (which mints ids) happens once per stored value, not per render.
  // Keyed on the local calendar day too, so a card left open past midnight rolls over within the minute
  // (the clock below re-renders it every minute); before, it waited for the next reload or edit.
  const day = today();
  const todos = useMemo(() => rollover(workspace.todos, day), [workspace.todos, day]);
  useEffect(() => { if (todos !== workspace.todos) void commit(w => ({ ...w, todos })); }, [todos, workspace.todos, commit]);
  const patch: Patch = (change, message) => commit(w => ({ ...w, todos: change(w.todos ?? todos) }), message);

  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60000); return () => clearInterval(timer); }, []);
  const [showHistory, setShowHistory] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const allDone = todos.items.length > 0 && todos.items.every(t => t.done);
  // The burst fires on the change to all done, not while it stays that way, so a reload does not re-fire it.
  const [burst, setBurst] = useState(false);
  const wasDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasDone.current) { setBurst(true); const timer = setTimeout(() => setBurst(false), 1800); wasDone.current = true; return () => clearTimeout(timer); }
    wasDone.current = allDone;
  }, [allDone]);

  const add = (text: string, category: CategoryId) => patch(t => ({ ...t, items: [...t.items, { id: uid(), text, done: false, category }] }));
  const change = (id: string, update: Partial<Todo>) => patch(t => ({ ...t, items: t.items.map(item => item.id === id ? { ...item, ...update } : item) }));
  // The card and the full list are two views of one sorted list, so a row renders the same in both.
  const sorted = useMemo(() => byPriority(todos.items), [todos.items]);
  const hidden = sorted.length - ON_CARD;
  const row = (item: Todo) => <TodoRow key={item.id} todo={item} day={todos.day} change={update => change(item.id, update)} remove={() => patch(t => removeTodo(t, item.id), 'Todo removed')}/>;
  const days = Object.keys(todos.history).sort().reverse();

  return <section className="panel todo-card" aria-label="Today's todos">
    <header className="todo-head" data-done={allDone || undefined}>
      <div><h2>{dateLabel(todos.day)}</h2><p className="todo-time">{timeLabel(clock)}{allDone && ' · all done'}</p></div>
    </header>
    <div className="todo-body">
      {burst && <Confetti colors={CATEGORIES.map(c => c.color)}/>}
      {todos.items.length === 0 && <p className="today-note">Nothing on the list. Add one below.</p>}
      <ul className="todo-list">{sorted.slice(0, ON_CARD).map(row)}</ul>
      <TodoAdd add={add}/>
      {/* With nothing hidden it still opens the list, since Earlier lives there. */}
      <button type="button" className="text-button todo-more" aria-haspopup="dialog" onClick={() => setListOpen(true)}>{hidden > 0 ? `Show more (${hidden})` : 'Open list'}</button>
    </div>
    {listOpen && <TodoDialog title={dateLabel(todos.day)} close={() => setListOpen(false)}>
      <div className="todo-body">
        <div className="todo-dialog-tools"><button type="button" className="text-button" aria-pressed={showHistory} onClick={() => setShowHistory(v => !v)}><History size={14}/>Earlier</button></div>
        {todos.items.length === 0 && <p className="today-note">Nothing on the list. Add one below.</p>}
        <ul className="todo-list">{sorted.map(row)}</ul>
        <TodoAdd add={add}/>
        {showHistory && <div className="todo-history" aria-label="Earlier days">
          {days.length === 0 && <p className="today-note">No earlier days yet.</p>}
          {days.map(day => <div key={day}><h3>{dateLabel(day)}</h3><ul className="todo-list">
            {todos.history[day].map(item => <li key={item.id} className="todo-item" data-done style={{ '--cat': categoryOf(item.category)?.color } as CSSProperties}><AnimatedCheckbox checked label={item.text} disabled/><div className="todo-main"><span className="todo-text">{item.text}</span></div></li>)}
          </ul></div>)}
        </div>}
      </div>
    </TodoDialog>}
  </section>;
}

// The add row, on the card and in the full list; each keeps its own draft.
function TodoAdd({ add }: { add: (text: string, category: CategoryId) => void }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim(); if (!value) return;
    add(value, category);
    setText('');
  }
  return <form className="todo-add" onSubmit={submit}>
    <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a todo" aria-label="New todo"/>
    <select value={category} onChange={e => setCategory(e.target.value as CategoryId)} aria-label="Category for the new todo">{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
    <button type="submit" className="icon-button" aria-label="Add todo" disabled={!text.trim()}><Plus size={15}/></button>
  </form>;
}

// The full list: a native <dialog> opened with showModal, so the browser traps focus and makes the page
// behind it inert. Escape is handled on keydown as well as the native cancel, so it behaves the same where
// no cancel event is sent (jsdom in the tests); an open row menu or priority editor takes its own Escape
// first. The effect's cleanup closes the dialog and only then puts focus back where it was (the Show more
// button), because focus cannot land on the inert page while the dialog is still open.
function TodoDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="modal todo-dialog" aria-label="All todos"
    onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } }}
    onClick={event => { if (event.target === ref.current) close(); }}>
    <header className="modal-header"><h2>All todos, {title}</h2><button type="button" className="icon-button" aria-label="Close" title="Close" onClick={close}><X size={18}/></button></header>
    {children}
  </dialog>;
}

function TodoRow({ todo, day, change, remove }: { todo: Todo; day: string; change: (update: Partial<Todo>) => Promise<boolean>; remove: () => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(false);
  const [calendar, setCalendar] = useState<{ text: string; connect?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const cat = categoryOf(todo.category);
  function onDragStart(event: DragEvent) {
    event.dataTransfer.setData(TODO_DRAG_TYPE, JSON.stringify(todoPayload(todo)));
    event.dataTransfer.setData('text/plain', todo.text);
    event.dataTransfer.effectAllowed = 'copy';
  }
  // Escape closes the innermost thing open in the row. preventDefault as well as stopPropagation, so inside
  // the full list's <dialog> the browser does not also treat it as the dialog's own Escape.
  function keys(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !(open || rating)) return;
    event.stopPropagation(); event.preventDefault();
    if (rating) { setRating(false); chip.current?.focus(); } else { setOpen(false); menuButton.current?.focus(); }
  }
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
  const rated = todo.urgency !== undefined || todo.importance !== undefined;
  // The gold coin (lib/sounds.ts, which reads its own on/off setting) rings only when a todo becomes done.
  const tick = () => { const done = !todo.done; if (done) playReward(); void change({ done }); };
  const number = (value: string) => value === '' ? undefined : Math.max(0, Math.round(Number(value)) || 0);
  return <li className="todo-item" data-done={todo.done || undefined} draggable onDragStart={onDragStart} onKeyDown={keys} style={{ '--cat': cat?.color } as CSSProperties}>
    <AnimatedCheckbox checked={todo.done} onChange={tick} label={todo.text}/>
    <div className="todo-main">
      <span className="todo-text">{todo.text}</span>
      <div className="todo-chips">
        <span className="tag todo-cat">{cat?.label}</span>
        {todo.minutes !== undefined && <span className="tag">{todo.minutes} min</span>}
        {todo.goal && <span className="tag">{todo.goal}</span>}
        {todo.time && <span className="tag">{todo.time}</span>}
        {rated && <button ref={chip} type="button" className="todo-prio" data-urgency={todo.urgency} aria-label={priorityLabel(todo)} title={priorityLabel(todo)} aria-expanded={rating} onClick={() => setRating(v => !v)}>
          <span>{todo.urgency ?? '-'}</span><span aria-hidden="true">·</span><span>{todo.importance ?? '-'}</span>
        </button>}
      </div>
      {/* Clear removes the chip itself, so focus goes to the row's options button. */}
      {rating && <PriorityPicker todo={todo} change={change} done={() => { setRating(false); menuButton.current?.focus(); }}/>}
    </div>
    <button ref={menuButton} type="button" className="icon-button" aria-label={`Options for ${todo.text}`} aria-expanded={open} onClick={() => setOpen(v => !v)}><MoreHorizontal size={15}/></button>
    {open && <div className="todo-options" role="group" aria-label={`Options for ${todo.text}`}>
      <label>Category<select value={todo.category} onChange={e => change({ category: e.target.value as CategoryId })}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Minutes<input type="number" min="0" step="5" value={todo.minutes ?? ''} onChange={e => change({ minutes: number(e.target.value) })}/></label>
      <label>Goal<input value={todo.goal ?? ''} onChange={e => change({ goal: e.target.value || undefined })} placeholder="What it is for"/></label>
      <label>Time<input type="time" value={todo.time ?? ''} onChange={e => change({ time: e.target.value || undefined })}/></label>
      {/* An unrated todo has no chip to click, so the pickers are here as well, for every todo. */}
      <PriorityPicker todo={todo} change={change}/>
      <div className="todo-options-actions">
        {todo.time && <button type="button" className="button" onClick={addToCalendar} disabled={busy}><CalendarPlus size={14}/>Add to calendar</button>}
        <button type="button" className="button" onClick={remove}><Trash2 size={14}/>Delete{todo.defaultKey ? ' for good' : ''}</button>
      </div>
      {calendar && <p className="today-note" role="status">{calendar.text}{calendar.connect && <> <a href="/api/calendar/connect">Connect</a></>}</p>}
    </div>}
  </li>;
}

// Urgency and importance are separate scales but share one chip, so the label spells out which is which.
const priorityLabel = (todo: Todo) => `Urgency ${todo.urgency ? `${todo.urgency} of 5` : 'not set'}, importance ${todo.importance ? `${todo.importance} of 5` : 'not set'}`;

// Two 1 to 5 segmented pickers and Clear. Each number is a toggle button (aria-pressed) named "Urgency 4",
// so a screen reader hears the scale with the number. done, when given, closes the editor after Clear.
function PriorityPicker({ todo, change, done }: { todo: Todo; change: (update: Partial<Todo>) => Promise<boolean>; done?: () => void }) {
  const scale = (label: 'Urgency' | 'Importance', field: 'urgency' | 'importance') => <div className="todo-scale" role="group" aria-label={label}>
    <span aria-hidden="true">{label}</span>
    {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" aria-label={`${label} ${n}`} aria-pressed={todo[field] === n} onClick={() => change({ [field]: n })}>{n}</button>)}
  </div>;
  return <div className="todo-priority" role="group" aria-label={`Priority for ${todo.text}`}>
    {scale('Urgency', 'urgency')}
    {scale('Importance', 'importance')}
    {(todo.urgency !== undefined || todo.importance !== undefined) && <button type="button" className="text-button" onClick={() => { void change({ urgency: undefined, importance: undefined }); done?.(); }}>Clear</button>}
  </div>;
}
