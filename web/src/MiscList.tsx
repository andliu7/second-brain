// MiscList: the brainstorm list on the Kanban page, for anything that is not a card yet. Props:
//   workspace: the Workspace; the list is workspace.misc, empty when a saved workspace predates it
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mount from App.tsx with one line:
//   <MiscList workspace={workspace} commit={commit}/>
//
// One box, Enter adds, newest first. Each line is a task, an idea or a note: pick the kind before
// adding, or click an item's kind to change it. A task gets a checkbox. "To board" turns a line into a
// card in the board's first column and takes it off this list, so a thought can grow into work
// without being typed twice. Click a line's text to edit it; Enter saves, Escape cancels.
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUpRight, Lightbulb, ListTodo, StickyNote, Trash2 } from 'lucide-react';
import type { MiscItem, Workspace } from './types';
import { defaultBoard, uid } from './lib/storage';
import { AnimatedCheckbox } from '@/components/ui/animated-checkbox';
import './misc.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Kind = MiscItem['kind'];
const KINDS: { id: Kind; label: string; Icon: typeof Lightbulb }[] = [
  { id: 'task', label: 'Task', Icon: ListTodo },
  { id: 'idea', label: 'Idea', Icon: Lightbulb },
  { id: 'note', label: 'Note', Icon: StickyNote },
];
const kindOf = (id: Kind) => KINDS.find(k => k.id === id)!;
const nextKind = (id: Kind): Kind => KINDS[(KINDS.findIndex(k => k.id === id) + 1) % KINDS.length].id;

export function MiscList({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const items = workspace.misc ?? [];
  const patch = (change: (items: MiscItem[]) => MiscItem[], message?: string) => commit(w => ({ ...w, misc: change(w.misc ?? []) }), message);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('idea');
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    const value = text.trim(); if (!value) return;
    void patch(list => [{ id: uid(), text: value, kind, done: false, created: new Date().toISOString() }, ...list]);
    setText('');
  }
  const change = (id: string, update: Partial<MiscItem>) => patch(list => list.map(item => item.id === id ? { ...item, ...update } : item));
  function saveEdit() {
    if (!editing) return;
    const value = editing.text.trim();
    if (value) void change(editing.id, { text: value });
    setEditing(null);
  }
  function editKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); saveEdit(); }
    if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
  }
  // One commit for both halves, so the card never exists while the line is still here, or the reverse.
  function toBoard(item: MiscItem) {
    void commit(w => {
      const board = w.board ?? defaultBoard();
      const card = { id: uid(), title: item.text, notes: '', column: board.columns[0]?.id ?? 'todo', checklist: [], attachments: [] };
      return { ...w, board: { ...board, cards: [...board.cards, card] }, misc: (w.misc ?? []).filter(m => m.id !== item.id) };
    }, 'Moved to the board');
  }

  const shown = filter === 'all' ? items : items.filter(item => item.kind === filter);
  return <section className="panel misc-list" aria-label="Brainstorm">
    <div className="section-heading"><h2>Brainstorm</h2><span className="muted">{items.length}</span></div>
    <form className="misc-add" onSubmit={add}>
      <div className="misc-kinds" role="group" aria-label="Kind for the new line">
        {KINDS.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} title={label}><Icon size={14}/>{label}</button>)}
      </div>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Anything: a task, an idea, a note. Enter adds it" aria-label="New brainstorm line"/>
    </form>
    {items.length > 0 && <div className="misc-filter" role="group" aria-label="Show">
      {(['all', ...KINDS.map(k => k.id)] as const).map(id => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{id === 'all' ? 'All' : kindOf(id).label + 's'}</button>)}
    </div>}
    {items.length === 0 && <p className="today-note">Empty. Type anything above; sort it out later.</p>}
    <ul className="misc-items">
      {shown.map(item => {
        const { Icon, label } = kindOf(item.kind);
        return <li key={item.id} className="misc-item" data-kind={item.kind} data-done={item.done || undefined}>
          {item.kind === 'task'
            ? <AnimatedCheckbox checked={item.done} label={item.text} onChange={() => void change(item.id, { done: !item.done })}/>
            : <span className="misc-bullet" aria-hidden="true"/>}
          {editing?.id === item.id
            ? <input className="misc-edit" autoFocus value={editing.text} aria-label="Edit line" onChange={e => setEditing({ id: item.id, text: e.target.value })} onKeyDown={editKeys} onBlur={saveEdit}/>
            : <button type="button" className="misc-text" onClick={() => setEditing({ id: item.id, text: item.text })} title="Click to edit">{item.text}</button>}
          <button type="button" className="misc-kind" onClick={() => void change(item.id, { kind: nextKind(item.kind) })} aria-label={`${label}, change kind`} title="Change kind"><Icon size={13}/>{label}</button>
          <button type="button" className="icon-button" onClick={() => toBoard(item)} aria-label={`Move ${item.text} to the board`} title="To board"><ArrowUpRight size={15}/></button>
          <button type="button" className="icon-button" onClick={() => void patch(list => list.filter(m => m.id !== item.id), 'Line removed')} aria-label={`Delete ${item.text}`} title="Delete"><Trash2 size={14}/></button>
        </li>;
      })}
    </ul>
  </section>;
}
