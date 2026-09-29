// Kanban: the board, its sticky-note mode, and the calendar import. Props:
//   workspace: the Workspace; the board is workspace.board, or defaultBoard() when a saved workspace predates it
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mount from App.tsx with one line:
//   {page === 'board' && <Kanban workspace={workspace} commit={commit}/>}
//
// Board mode is native HTML5 drag and drop (the card is draggable, columns are drop targets) with
// framer-motion `layout` animating cards into place. While a card is over a column, an indicator line
// shows the slot it will land in: above the card the pointer is over when the pointer is in its top
// half, below it otherwise, at the end when over empty column space. A delete zone appears under the
// board while dragging. Columns also accept a todo dragged from TodoCard.tsx (TODO_DRAG_TYPE, a JSON
// payload): that is a copy, and a todo already on the board (by sourceTodoId) is not copied twice.
// Sticky mode draws the same cards as freely draggable notes (sticky-note.tsx) and never touches a
// card's column, so switching back restores the board as it was.
// A card can be promoted to a project (card.project): its checklist becomes the project's stages, and
// clicking it opens ProjectPanel, a drawer with the stage timeline, instead of the card dialog. Under the
// board, a Projects section lists them (ProjectList) with a link to the repos at #projects. Projects.tsx
// shows the same list and opens the same drawer, so both save through boardPatch and cannot drift apart.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Columns3, FolderGit2, Image, Loader2, Milestone, MoreHorizontal, Paperclip, Plus, SquarePen, StickyNote as StickyIcon, Trash2, Undo2, X } from 'lucide-react';
import type { Board, Card, ChecklistItem, Doc, Workspace } from './types';
import { activity, defaultBoard, today, uid } from './lib/storage';
import { api } from './lib/api';
import { categoryOf, type CategoryId } from './lib/categories';
import { TODO_DRAG_TYPE, type todoPayload } from './lib/todos';
import { Checklist, checklistSummary } from '@/components/ui/checklist';
import { ColorSwatches } from '@/components/ui/color-swatches';
import { StickyNote, type StickyPosition } from '@/components/ui/sticky-note';
import { StageProgress, StageTimeline } from '@/components/ui/stage-timeline';
import { PipelineSwitch, PipelineView } from './PipelineView';
import './kanban.css';

export type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Patch = (change: (board: Board) => Board, message?: string) => Promise<boolean>;
// Where a dragged card will land: the column, and the card it goes before (null means the end).
type Slot = { column: string; before: string | null };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; link?: string; location?: string };
// What TodoCard.tsx puts on the drag: lib/todos.ts owns the dataTransfer type and the JSON shape under it.
type TodoDrag = ReturnType<typeof todoPayload>;
const CARD_DRAG_TYPE = 'text/card';

export const boardOf = (workspace: Workspace) => workspace.board ?? defaultBoard();
// Every board change goes through this. A change with a message is one worth a line in the activity log
// (the heat calendar on Today reads it).
export const boardPatch = (commit: Commit): Patch => (change, message) => commit(w => ({ ...w, board: change(boardOf(w)), activity: message ? [activity(message, 'board'), ...w.activity].slice(0, 100) : w.activity }), message);
const patchCard = (board: Board, id: string, change: (card: Card) => Card): Board => ({ ...board, cards: board.cards.map(card => card.id === id ? change(card) : card) });
// Ticking an item stamps the day, which a project's stage shows; unticking drops the stamp.
const flip = ({ doneOn: _doneOn, ...item }: ChecklistItem): ChecklistItem => item.done ? { ...item, done: false } : { ...item, done: true, doneOn: today() };
const toggleItem = (card: Card, itemId: string): Card => ({ ...card, checklist: card.checklist.map(item => item.id === itemId ? flip(item) : item) });
// A stage moved up or down one place; the ends stay put.
function shiftItem(items: ChecklistItem[], id: string, by: -1 | 1) { const list = [...items]; const i = list.findIndex(item => item.id === id); const j = i + by; if (i < 0 || j < 0 || j >= list.length) return items; [list[i], list[j]] = [list[j], list[i]]; return list; }
const newCard = (title: string, column: string, extra: Partial<Card> = {}): Card => ({ id: uid(), title, notes: '', column, checklist: [], attachments: [], ...extra });
// Reorder: take the card out, then put it back before `slot.before` in the flat list. The flat order is
// the order within every column, so inserting before a card of the target column lands it there.
export function moveCard(board: Board, id: string, slot: Slot): Board {
  const moving = board.cards.find(card => card.id === id);
  if (!moving || slot.before === id) return board;
  const rest = board.cards.filter(card => card.id !== id);
  const at = slot.before ? rest.findIndex(card => card.id === slot.before) : rest.length;
  return { ...board, cards: [...rest.slice(0, at), { ...moving, column: slot.column }, ...rest.slice(at)] };
}
// A dropped todo becomes a card once. The goal becomes the first checklist item; minutes ride along as a chip.
export function cardFromTodo(board: Board, todo: TodoDrag, column: string): Board {
  if (board.cards.some(card => card.sourceTodoId === todo.id)) return board;
  const extra: Partial<Card> = { sourceTodoId: todo.id, category: categoryOf(todo.category)?.id, minutes: todo.minutes || undefined, checklist: todo.goal ? [{ id: uid(), title: todo.goal, done: false }] : [] };
  return { ...board, cards: [...board.cards, newCard(todo.text, column, extra)] };
}
// A note that was never moved sits in a loose grid, tilted a little, so a fresh sticky canvas already looks like one.
const defaultSticky = (index: number): StickyPosition => ({ x: 24 + (index % 4) * 196, y: 24 + Math.floor(index / 4) * 176, rotate: [-3, 2, -1.5, 3][index % 4] });
const dateOf = (iso: string) => iso.slice(0, 10);
const categoryStyle = (id?: CategoryId) => ({ '--cat': categoryOf(id)?.color } as CSSProperties);

export function Kanban({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const board = boardOf(workspace);
  const patch = boardPatch(commit);
  // The open card, and whether it is in the card dialog: a project opens its drawer, and the drawer's
  // "Edit card" sets dialog to reach the rest of the card (due date, attachments, Back to a card).
  const [open, setOpen] = useState<{ id: string; dialog?: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const openCard = board.cards.find(card => card.id === open?.id);
  const save = (card: Card, message = 'Card saved') => patch(b => patchCard(b, card.id, () => card), message);
  return <>
    <div className="page-heading"><div><h1>Board</h1></div><div className="heading-actions">
      <div className="kanban-switch" role="group" aria-label="View">
        <button type="button" className="icon-button" aria-label="Board view" aria-pressed={board.view === 'board'} onClick={() => patch(b => ({ ...b, view: 'board' }))}><Columns3 size={16}/></button>
        <button type="button" className="icon-button" aria-label="Sticky notes view" aria-pressed={board.view === 'sticky'} onClick={() => patch(b => ({ ...b, view: 'sticky' }))}><StickyIcon size={16}/></button>
      </div>
      <button type="button" className="button" onClick={() => setImporting(true)}><CalendarPlus size={15}/>From calendar</button>
      {board.view === 'board' && <button type="button" className="button" onClick={() => patch(b => ({ ...b, columns: [...b.columns, { id: uid(), name: 'New column' }] }), 'Column added')}><Plus size={15}/>Add column</button>}
    </div></div>
    {board.view === 'board' ? <BoardView board={board} docs={workspace.docs} patch={patch} open={id => setOpen({ id })}/> : <StickyView board={board} patch={patch}/>}
    {/* One list under the board, not a second board. The section has no accessible name on purpose, so it
        is not a region: the columns are the board's only regions. */}
    <section className="kanban-projects">
      <div className="kanban-projects-head"><h2>Projects</h2><a className="text-button" href="#projects"><FolderGit2 size={14}/>Repositories and course projects<ChevronRight size={14}/></a></div>
      <ProjectList board={board} open={id => setOpen({ id })}/>
    </section>
    {openCard && (openCard.project && !open?.dialog
      ? <ProjectPanel card={openCard} patch={patch} close={() => setOpen(null)} edit={() => setOpen({ id: openCard.id, dialog: true })}/>
      : <CardDialog card={openCard} docs={workspace.docs} close={() => setOpen(null)} save={card => save(card)}
        promote={async card => { if (await save(card, card.project ? 'Now a project' : 'Back to a card')) setOpen(card.project ? { id: card.id } : null); }}
        remove={() => { setOpen(null); void patch(b => ({ ...b, cards: b.cards.filter(card => card.id !== openCard.id) }), 'Card deleted'); }}/>)}
    {importing && <CalendarImport board={board} close={() => setImporting(false)} add={cards => patch(b => ({ ...b, cards: [...b.cards, ...cards] }), `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} added`)}/>}
  </>;
}

function BoardView({ board, docs, patch, open }: { board: Board; docs: Doc[]; patch: Patch; open: (id: string) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [burn, setBurn] = useState(false);
  const cardId = (event: DragEvent) => event.dataTransfer.getData(CARD_DRAG_TYPE) || dragging || '';
  function over(event: DragEvent<HTMLElement>, column: string) {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (!target) { setSlot({ column, before: null }); return; }
    if (target.dataset.card === dragging) return;
    const rect = target.getBoundingClientRect();
    const inColumn = board.cards.filter(card => card.column === column);
    const index = inColumn.findIndex(card => card.id === target.dataset.card);
    const before = event.clientY <= rect.top + rect.height / 2 ? inColumn[index] : inColumn[index + 1];
    setSlot({ column, before: before?.id ?? null });
  }
  function drop(event: DragEvent<HTMLElement>, column: string) {
    event.preventDefault();
    const todo = event.dataTransfer.getData(TODO_DRAG_TYPE);
    const id = cardId(event); const target = slot?.column === column ? slot : { column, before: null };
    setSlot(null); setDragging(null);
    if (todo) { const payload = JSON.parse(todo) as TodoDrag; if (payload.type === 'todo' && payload.id && payload.text) void patch(b => cardFromTodo(b, payload, column)); return; }
    if (id) void patch(b => moveCard(b, id, target));
  }
  function burnDrop(event: DragEvent) { event.preventDefault(); const id = cardId(event); setBurn(false); setSlot(null); setDragging(null); if (id) void patch(b => ({ ...b, cards: b.cards.filter(card => card.id !== id) }), 'Card deleted'); }
  function renameColumn(id: string, name: string) { const clean = name.trim(); if (clean && clean !== board.columns.find(c => c.id === id)?.name) void patch(b => ({ ...b, columns: b.columns.map(c => c.id === id ? { ...c, name: clean } : c) })); }
  function shiftColumn(id: string, by: -1 | 1) { void patch(b => { const columns = [...b.columns]; const i = columns.findIndex(c => c.id === id); const j = i + by; if (j < 0 || j >= columns.length) return b; [columns[i], columns[j]] = [columns[j], columns[i]]; return { ...b, columns }; }); }
  // Deleting a column keeps its cards: they move to the first column that is left.
  function removeColumn(id: string) { void patch(b => { const columns = b.columns.filter(c => c.id !== id); return { ...b, columns, cards: b.cards.map(card => card.column === id ? { ...card, column: columns[0].id } : card) }; }, 'Column deleted'); }
  const indicator = (column: string, before: string | null) => <div className="kanban-slot" data-active={slot?.column === column && slot.before === before || undefined} aria-hidden="true"/>;
  return <>
    <div className="kanban-board" style={{ '--columns': board.columns.length } as CSSProperties} onDragEnd={() => { setDragging(null); setSlot(null); setBurn(false); }}>
      {board.columns.map((column, index) => {
        const cards = board.cards.filter(card => card.column === column.id);
        return <section key={column.id} className="kanban-column" aria-label={column.name} onDragOver={event => over(event, column.id)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSlot(null); }} onDrop={event => drop(event, column.id)}>
          <header className="kanban-column-head">
            <input className="kanban-column-name" defaultValue={column.name} key={column.name} aria-label={`Column name: ${column.name}`} onBlur={event => renameColumn(column.id, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
            <span className="kanban-column-count">{cards.length}</span>
            <ColumnMenu name={column.name} cards={cards.length} first={index === 0} last={index === board.columns.length - 1} only={board.columns.length === 1} move={by => shiftColumn(column.id, by)} remove={() => removeColumn(column.id)}/>
          </header>
          <div className="kanban-cards">
            {cards.map(card => <div key={card.id}>{indicator(column.id, card.id)}<BoardCard card={card} docs={docs} dragging={dragging === card.id} patch={patch} open={() => open(card.id)} onDragStart={event => { event.dataTransfer.setData(CARD_DRAG_TYPE, card.id); event.dataTransfer.effectAllowed = 'move'; setDragging(card.id); }}/></div>)}
            {indicator(column.id, null)}
          </div>
          <AddCard add={title => patch(b => ({ ...b, cards: [...b.cards, newCard(title, column.id)] }), 'Card added')}/>
        </section>;
      })}
    </div>
    {dragging && <div className="kanban-burn" data-active={burn || undefined} aria-label="Drop here to delete" onDragOver={event => { event.preventDefault(); setBurn(true); setSlot(null); }} onDragLeave={() => setBurn(false)} onDrop={burnDrop}><Trash2 size={18}/>Drop here to delete</div>}
  </>;
}

function BoardCard({ card, docs, dragging, patch, open, onDragStart }: { card: Card; docs: Doc[]; dragging: boolean; patch: Patch; open: () => void; onDragStart: (event: DragEvent<HTMLDivElement>) => void }) {
  const [showList, setShowList] = useState(false);
  const [showColours, setShowColours] = useState(false);
  const attached = card.attachments.map(id => docs.find(doc => doc.id === id)).filter((doc): doc is Doc => !!doc);
  const cover = attached.find(doc => doc.mime?.startsWith('image/') && doc.data);
  const overdue = !!card.due && card.due < dateOf(new Date().toISOString());
  const isControl = (target: EventTarget) => (target as HTMLElement).closest('button, input, label, a');
  function keys(event: KeyboardEvent<HTMLDivElement>) { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') open(); if (event.key === 'Escape') { setShowColours(false); setShowList(false); } }
  // motion.div animates the card into its new place (layout); the plain div inside owns the native drag,
  // because motion.div would take onDragStart for its own pointer-drag gesture.
  return <motion.div layout layoutId={card.id} transition={{ duration: 0.18 }}><div className="kanban-card" data-card={card.id} data-category={card.category} data-project={card.project || undefined} data-dragging={dragging || undefined} style={categoryStyle(card.category)} draggable tabIndex={0} role="button" aria-label={card.title} onDragStart={onDragStart} onClick={event => { if (!isControl(event.target)) open(); }} onKeyDown={keys}>
    {cover && <img className="kanban-cover" src={cover.data} alt={cover.name}/>}
    <div className="kanban-card-body">
      {card.project && <span className="kanban-project-mark"><Milestone size={12}/>Project</span>}
      <strong>{card.title}</strong>
      {card.notes && <p>{card.notes.split('\n')[0]}</p>}
      {card.project && <StageProgress stages={card.checklist}/>}
      {attached.filter(doc => doc !== cover).map(doc => <span key={doc.id} className="tag kanban-chip"><Paperclip size={11}/>{doc.name}</span>)}
      <div className="kanban-card-meta">
        {card.due && <span className="kanban-due" data-overdue={overdue || undefined} title={overdue ? 'Overdue' : 'Due'}><CalendarDays size={12}/>{card.due}</span>}
        {card.minutes !== undefined && <span className="kanban-due" title="Estimate"><Clock3 size={12}/>{card.minutes} min</span>}
        {!card.project && card.checklist.length > 0 && <button type="button" className="kanban-meta-button" aria-expanded={showList} aria-label={`Checklist, ${checklistSummary(card.checklist)} done`} onClick={() => setShowList(s => !s)}>{checklistSummary(card.checklist)}{showList ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}</button>}
        {/* The category colour picker. With no category it is an empty dashed circle, so the tooltip says what it does. */}
        <button type="button" className="kanban-dot" aria-label={`Category: ${categoryOf(card.category)?.label || 'none'}`} title={card.category ? `Category: ${categoryOf(card.category)?.label}. Click to change it` : 'No category. Click to pick a colour'} aria-expanded={showColours} onClick={() => setShowColours(s => !s)}/>
      </div>
      {showColours && <ColorSwatches value={card.category} onChange={id => { setShowColours(false); void patch(b => patchCard(b, card.id, c => ({ ...c, category: id }))); }}/>}
      {showList && <Checklist items={card.checklist} onToggle={id => patch(b => patchCard(b, card.id, c => toggleItem(c, id)))}/>}
    </div>
  </div></motion.div>;
}

// The column's actions behind one "..." button, so delete is never a stray click beside the move arrows.
// Deleting a column that holds cards asks first, inside the menu; its cards move to the first column left.
// The menu is role=menu with menuitems, and Escape or a click outside closes it.
function ColumnMenu({ name, cards, first, last, only, move, remove }: { name: string; cards: number; first: boolean; last: boolean; only: boolean; move: (by: -1 | 1) => void; remove: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = () => { setOpen(false); setConfirming(false); };
  const act = (fn: () => void) => { fn(); close(); };
  return <div className="kanban-column-menu" onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-button" aria-label={`Column actions: ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><MoreHorizontal size={16}/></button>
    {open && <>
      <div className="kanban-menu-layer" onClick={close}/>
      <div className="kanban-menu" role="menu" aria-label={`Actions for ${name}`}>
        {confirming ? <div className="kanban-menu-confirm" role="alert">
          <p>Delete {name}? Its {cards} {cards === 1 ? 'card moves' : 'cards move'} to the first column.</p>
          <div><button type="button" className="text-button" onClick={() => setConfirming(false)}>Keep it</button><button type="button" className="button small danger" onClick={() => act(remove)}>Delete column</button></div>
        </div> : <>
          <button type="button" role="menuitem" disabled={first} onClick={() => act(() => move(-1))}><ChevronLeft size={14}/>Move left</button>
          <button type="button" role="menuitem" disabled={last} onClick={() => act(() => move(1))}><ChevronRight size={14}/>Move right</button>
          <button type="button" role="menuitem" className="danger" disabled={only} onClick={() => cards ? setConfirming(true) : act(remove)}><Trash2 size={14}/>Delete column</button>
        </>}
      </div>
    </>}
  </div>;
}

function AddCard({ add }: { add: (title: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  async function submit(event: FormEvent | KeyboardEvent) { event.preventDefault(); const clean = title.trim(); if (!clean) return; if (await add(clean)) { setTitle(''); setEditing(false); } }
  if (!editing) return <button type="button" className="text-button kanban-add" onClick={() => setEditing(true)}><Plus size={14}/>Add card</button>;
  return <form className="kanban-add-form" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') setEditing(false); }}>
    <textarea autoFocus rows={2} value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="New card title" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) void submit(event); }}/>
    <div className="kanban-add-actions"><button type="button" className="text-button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="button primary" disabled={!title.trim()}>Add</button></div>
  </form>;
}

// The card's editor, a <dialog> like the skill pop-up. Edits are a draft until Save. Make it a project and
// Back to a card save the draft with the flag flipped straight away, since each is its own action; the
// checklist is kept either way, so undoing a promotion loses nothing.
function CardDialog({ card, docs, close, save, promote, remove }: { card: Card; docs: Doc[]; close: () => void; save: (card: Card) => Promise<boolean>; promote: (card: Card) => Promise<void>; remove: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(card);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const set = (change: Partial<Card>) => setDraft(d => ({ ...d, ...change }));
  const unattached = docs.filter(doc => !draft.attachments.includes(doc.id));
  async function submit(event: FormEvent) { event.preventDefault(); if (!draft.title.trim()) return; if (await save({ ...draft, title: draft.title.trim() })) close(); }
  function flipProject() { if (!draft.title.trim()) return; const { project, ...rest } = draft; void promote(project ? { ...rest, title: draft.title.trim() } : { ...rest, title: draft.title.trim(), project: true }); }
  return <dialog ref={dialog} className="kanban-dialog" aria-labelledby="kanban-dialog-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <form onSubmit={submit}>
      <div className="kanban-dialog-head"><h2 id="kanban-dialog-title">Card</h2><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={16}/></button></div>
      <label className="kanban-field">Title<input value={draft.title} onChange={event => set({ title: event.target.value })} required/></label>
      <label className="kanban-field">Notes<textarea rows={4} value={draft.notes} onChange={event => set({ notes: event.target.value })}/></label>
      <div className="kanban-dialog-row">
        <label className="kanban-field">Due<input type="date" value={draft.due || ''} onChange={event => set({ due: event.target.value || undefined })}/></label>
        <div className="kanban-field"><span>Category</span><ColorSwatches value={draft.category} onChange={id => set({ category: id })}/></div>
      </div>
      <div className="kanban-field"><span>{draft.project ? 'Stages' : 'Checklist'}</span>
        <Checklist items={draft.checklist} onToggle={id => setDraft(d => toggleItem(d, id))} onAdd={title => set({ checklist: [...draft.checklist, { id: uid(), title, done: false }] })} onRemove={id => set({ checklist: draft.checklist.filter(item => item.id !== id) })}/>
      </div>
      <div className="kanban-field"><span>Attachments</span>
        <div className="kanban-attachments">
          {draft.attachments.map(id => { const doc = docs.find(d => d.id === id); return doc && <span key={id} className="tag kanban-chip">{doc.mime?.startsWith('image/') ? <Image size={11}/> : <Paperclip size={11}/>}{doc.name}<button type="button" aria-label={`Remove ${doc.name}`} onClick={() => set({ attachments: draft.attachments.filter(a => a !== id) })}><X size={11}/></button></span>; })}
          {unattached.length > 0 && <select value="" aria-label="Attach a file or note" onChange={event => { if (event.target.value) set({ attachments: [...draft.attachments, event.target.value] }); }}><option value="">Attach a file or note</option>{unattached.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select>}
        </div>
      </div>
      <div className="kanban-project-action">
        <button type="button" className="button" onClick={flipProject}>{draft.project ? <><Undo2 size={14}/>Back to a card</> : <><Milestone size={14}/>Make it a project</>}</button>
        <small>{draft.project ? 'Keeps its stages as a plain checklist.' : 'Its checklist becomes the stages, tracked in a side panel.'}</small>
      </div>
      <div className="kanban-dialog-foot"><button type="button" className="button danger" onClick={remove}><Trash2 size={14}/>Delete</button><span/><button type="button" className="text-button" onClick={close}>Cancel</button><button type="submit" className="button primary">Save</button></div>
    </form>
  </dialog>;
}

// The promoted cards, one row each: title, the column it is in, and its progress. Each row opens the drawer.
export function ProjectList({ board, open }: { board: Board; open: (id: string) => void }) {
  const projects = board.cards.filter(card => card.project);
  if (!projects.length) return <p className="board-projects-empty">None yet. Open a card on the board and choose Make it a project.</p>;
  return <div className="board-projects-list">
    {projects.map(card => <button key={card.id} type="button" className="board-project-row" onClick={() => open(card.id)}>
      <span className="board-project-name"><strong>{card.title}</strong><small>{board.columns.find(column => column.id === card.column)?.name}</small></span>
      <StageProgress stages={card.checklist}/>
    </button>)}
  </div>;
}

// A project's drawer: a <dialog> over the right edge, opened with showModal() so the page behind is inert
// and Tab stays inside it (the browser's own focus trap, which the card dialog relies on too). Esc or
// Close shut it, and focus goes back to whatever opened it. Every stage edit is saved at once through
// patch, the board's own path, so there is no draft and nothing to lose. edit is Kanban's way to the full
// card dialog; Projects.tsx leaves it out. The Pipeline view switch in the bar swaps the stage timeline for
// PipelineView (the same stages with statuses, progress and logs, shared with Claude Code); its title
// then names the dialog, so the aside's heading is not drawn twice.
export function ProjectPanel({ card, patch, close, edit }: { card: Card; patch: Patch; close: () => void; edit?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal(); element.focus({ preventScroll: true });
    return () => { element.close(); if (back?.isConnected) back.focus(); };
  }, []);
  // Blur first, so a stage note still being typed is saved (notes save on blur) before the drawer goes.
  function dismiss() { if (dialog.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); close(); }
  const change = (update: (card: Card) => Card, message?: string) => void patch(b => patchCard(b, card.id, update), message);
  const done = card.checklist.filter(stage => stage.done).length;
  const aside = <>
    <span className="kanban-project-mark"><Milestone size={12}/>Project</span>
    <h2 id="project-panel-title">{card.title}</h2>
    <StageProgress stages={card.checklist}/>
    <p className="project-panel-count">{card.checklist.length === 0 ? 'No stages yet' : done === card.checklist.length ? 'Every stage done' : `${card.checklist.length - done} to go`}</p>
    {card.notes && <p className="project-panel-notes">{card.notes}</p>}
  </>;
  return <dialog ref={dialog} className="project-panel" aria-labelledby="project-panel-title" tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } }}
    onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target === dialog.current) dismiss(); }}>
    <div className="project-panel-bar">
      {edit && <button type="button" className="text-button" onClick={edit}><SquarePen size={14}/>Edit card</button>}
      <PipelineSwitch card={card} change={change}/>
      <span className="project-panel-hint">Esc closes this panel</span>
      <button type="button" className="icon-button" aria-label="Close" title="Close (Esc)" onClick={dismiss}><X size={16}/></button>
    </div>
    <div className="project-panel-body">
      {card.pipeline?.enabled ? <PipelineView card={card} change={change} titleId="project-panel-title"/> : <StageTimeline stages={card.checklist} aside={aside}
        onToggle={id => change(c => toggleItem(c, id), card.checklist.find(stage => stage.id === id)?.done ? undefined : 'Stage done')}
        onEdit={(id, edits) => change(c => ({ ...c, checklist: c.checklist.map(stage => stage.id === id ? { ...stage, ...edits } : stage) }))}
        onMove={(id, by) => change(c => ({ ...c, checklist: shiftItem(c.checklist, id, by) }))}
        onRemove={id => change(c => ({ ...c, checklist: c.checklist.filter(stage => stage.id !== id) }), 'Stage deleted')}
        onAdd={title => change(c => ({ ...c, checklist: [...c.checklist, { id: uid(), title, done: false }] }))}/>}
    </div>
  </dialog>;
}

function StickyView({ board, patch }: { board: Board; patch: Patch }) {
  const canvas = useRef<HTMLDivElement>(null);
  const place = (card: Card, index: number): StickyPosition => card.sticky ?? defaultSticky(index);
  return <>
    {board.cards.length > 0 && <p className="sticky-hint">Right-click a note, or focus it and press Enter, to rotate, flip, recolour or delete it.</p>}
    <div className="sticky-canvas" ref={canvas} aria-label="Sticky notes">
      {board.cards.length === 0 && <p className="kanban-empty">No cards yet. Switch to the board view to add some.</p>}
      {board.cards.map((card, index) => <StickyNote key={card.id} card={card} position={place(card, index)} canvas={canvas}
        onMove={(x, y) => patch(b => patchCard(b, card.id, c => ({ ...c, sticky: { ...place(c, index), x, y } })))}
        onRotate={() => patch(b => patchCard(b, card.id, c => { const at = place(c, index); return { ...c, sticky: { ...at, rotate: at.rotate + 45 } }; }))}
        onCategory={id => patch(b => patchCard(b, card.id, c => ({ ...c, category: id })))}
        onToggle={id => patch(b => patchCard(b, card.id, c => toggleItem(c, id)))}
        onDelete={() => patch(b => ({ ...b, cards: b.cards.filter(c => c.id !== card.id) }), 'Card deleted')}/>)}
    </div>
  </>;
}

// The calendar import: upcoming events from /api/calendar, chosen with checkboxes, become cards in the
// first column. An event already on the board (by its id) is shown but cannot be added again.
function CalendarImport({ board, close, add }: { board: Board; close: () => void; add: (cards: Card[]) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => { (async () => { try { const reply = await api<{ connected: boolean; email?: string }>('calendar/status'); setStatus(reply); if (reply.connected) setEvents((await api<{ events: CalendarEvent[] }>('calendar/events?days=14')).events || []); } catch (e) { setError(e instanceof Error ? e.message : 'Calendar unavailable'); } })(); }, []);
  const imported = new Set(board.cards.map(card => card.eventId).filter(Boolean));
  const first = board.columns[0];
  const fresh = chosen.filter(id => !imported.has(id));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const cards = (events || []).filter(e => fresh.includes(e.id)).map(e => newCard(e.title, first.id, { eventId: e.id, due: dateOf(e.start), notes: e.link || '' }));
    if (!cards.length || await add(cards)) close();
  }
  const toggle = (id: string) => setChosen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const when = (e: CalendarEvent) => e.allDay ? dateOf(e.start) : new Date(e.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <dialog ref={dialog} className="kanban-dialog" aria-labelledby="kanban-import-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <form onSubmit={submit}>
      <div className="kanban-dialog-head"><h2 id="kanban-import-title">From calendar</h2><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={16}/></button></div>
      {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
      {!status && !error && <p className="kanban-empty"><Loader2 className="spin" size={14}/>Checking the calendar</p>}
      {status && !status.connected && <p className="kanban-empty">No calendar is connected. <a className="button" href="/api/calendar/connect">Connect</a></p>}
      {status?.connected && events && (events.length === 0 ? <p className="kanban-empty">Nothing in the next 14 days{status.email ? ` for ${status.email}` : ''}.</p> : <div className="kanban-events">
        {events.map(e => { const done = imported.has(e.id); return <label key={e.id} className="kanban-event" data-imported={done || undefined}>
          <input type="checkbox" aria-label={e.title} checked={done || chosen.includes(e.id)} disabled={done} onChange={() => toggle(e.id)}/>
          <span><strong>{e.title}</strong><small>{when(e)}{e.location ? `, ${e.location}` : ''}{done ? ', already on the board' : ''}</small></span>
        </label>; })}
      </div>)}
      <div className="kanban-dialog-foot"><span/><button type="button" className="text-button" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!fresh.length}>Add {fresh.length || ''} to {first.name}</button></div>
    </form>
  </dialog>;
}
