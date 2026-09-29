// Docs: notes, a journal and ideas, written in a calm rich text editor and kept as markdown. Props:
//   workspace: the Workspace; the page lists and edits workspace.docs of kind 'note'
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
//   remove: App's deleteDoc, which asks before deleting (optional; no Delete button without it)
// Mount from App.tsx with one line:
//   {page === 'docs' && <Docs workspace={workspace} commit={commit} remove={deleteDoc}/>}
//
// Three panes, the way Notesnook lays out a notebook app (an idea only; Notesnook is GPL-3.0 and none of
// its code is here). Left (DocsNav.tsx): All notes, Journal, Ideas, Pinned, then notebooks and tags.
// Middle: the notes in that view with a search, each with its title, a two-line preview, the date and a
// pin mark; the Journal view groups entries by month instead, with Today's entry and On this day at the
// top. Right: the open note, its title, a row of settings (kind, notebook, tags, words, saved, pin,
// full screen, delete) and the body editor. At phone width the panes stack and the list and the note
// take turns, with a back arrow.
//
// Edits save by themselves 600 ms after the last keystroke, and at once when another note is opened or
// the page is left (useDocSaver, below, shared with the full screen page in Write.tsx). Content stays
// markdown in Doc.content, so Markdown.tsx, search and Chat context all still read it. The editor is
// TipTap, loaded with React.lazy (components/ui/doc-editor.tsx) so it is its own chunk.
//
// Full screen (the button, or Ctrl+Shift+F outside a plain text field) opens the note at #write/<id>,
// which App.tsx draws without its shell. Save as PDF is window.print(): the print rules at the end of
// docs.css print the open note alone (the element marked note-print), and the browser's Save as PDF
// makes the file, the way Resume.tsx prints, so no PDF library ships.
//
// New has a menu beside it for the other kinds, Resume among them. The resume is a note of kind Resume
// that shows the resume editor (Resume.tsx) in the right pane instead of the text editor; there is one
// resume, workspace.resume, so New > Resume opens it when it exists.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, FileText, Loader2, Maximize2, Pin, PinOff, Plus, Printer, Search, Trash2 } from 'lucide-react';
import type { Doc, Notebook, Workspace } from './types';
import { now, uid } from './lib/storage';
import { DOC_KINDS, TEXT_KINDS, UNTITLED, allUserTags, journalMonths, kindOf, listDocs, newDocFor, notebookOf, onThisDay, previewOf, userTags, viewDocs, withNotebook, withUserTags, wordCount, type DocKind, type View } from './lib/docs-kinds';
import { DocsNav } from './DocsNav';
import { Resume } from './Resume';
import './docs.css';

export const DocEditor = lazy(() => import('@/components/ui/doc-editor'));

export type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
export type Change = { name?: string; content?: string; tags?: string[]; pinned?: boolean };
export type SaveStatus = 'saved' | 'saving';
const SAVE_DELAY = 600;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const NEW_MENU: [DocKind, string][] = [['Note', 'Note'], ['Journal', 'Journal entry'], ['Idea', 'Idea'], ['Resume', 'Resume, from a template']];
const printNote = () => window.print();

// The note the page last had open, for this visit. Module scope, not state, because it has to outlive
// the page: Back on the write page calls rememberOpen, so #docs comes back with that note selected,
// and at phone width showing the note rather than the list (cameBack, read once when Docs mounts).
let lastOpen: string | null = null;
let cameBack = false;
export const rememberOpen = (id: string) => { lastOpen = id; cameBack = true; };

// A custom hook: the save-after-a-pause logic, with its refs and its status, so the Docs page and the
// write page save the same way. edit() queues a change; flush() writes what is queued now.
export function useDocSaver(commit: Commit) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  // Unsaved edits wait here until the timer fires. Refs, not state: they change on every keystroke
  // and nothing on screen reads them, so they must not re-render the page.
  const pending = useRef<{ id: string; change: Change } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; }, [commit]);

  // flush reads only refs, so an event listener holding an older copy of it still saves the latest edit.
  // It resolves once the save lands (true when nothing was waiting). Moving between Docs and the write
  // page waits for it: the editor reads a note's content once, when it opens, so opening the same note
  // before the save lands would show the older text and then save over the newer.
  function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    const waiting = pending.current;
    if (!waiting) return Promise.resolve(true);
    pending.current = null;
    const { name, ...rest } = waiting.change;
    const change = name === undefined ? rest : { ...rest, name: name.trim() || UNTITLED };
    // A failed save stays at Saving; App's commit has already shown the error.
    return commitRef.current(w => ({ ...w, docs: w.docs.map(doc => doc.id === waiting.id ? { ...doc, ...change, updated: now() } : doc) }))
      .then(ok => { if (ok && !pending.current) setStatus('saved'); return ok; });
  }
  // Typing waits for a pause; a click (kind, notebook, tags, pin: atOnce = true) saves straight away.
  function edit(id: string, change: Change, atOnce = false) {
    if (pending.current && pending.current.id !== id) flush();
    pending.current = { id, change: { ...pending.current?.change, ...change } };
    setStatus('saving');
    clearTimeout(timer.current);
    if (atOnce) void flush(); else timer.current = setTimeout(flush, SAVE_DELAY);
  }
  // Leaving the page saves what is waiting. The empty dependency list runs the cleanup once, on unmount.
  useEffect(() => () => { void flush(); }, []);
  return { status, edit, flush };
}

// Opens a note as its own page. App.tsx listens for the address change and draws Write.tsx.
export const openFullScreen = (id: string) => { location.hash = 'write/' + id; };

export function Docs({ workspace, commit, remove }: { workspace: Workspace; commit: Commit; remove?: (doc: Doc) => void }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('all');
  const notebooks = workspace.notebooks ?? [];
  const shown = viewDocs(workspace.docs, view, query);
  const [openId, setOpenId] = useState<string | null>(() => workspace.docs.some(doc => doc.id === lastOpen) ? lastOpen : listDocs(workspace.docs, null, '')[0]?.id ?? null);
  const open = workspace.docs.find(doc => doc.id === openId && doc.kind === 'note') ?? null;
  // Phone width only: which of the list and the note is showing. CSS ignores it on a wide screen.
  const [pane, setPane] = useState<'list' | 'note'>(() => cameBack && openId === lastOpen ? 'note' : 'list');
  const { status, edit, flush } = useDocSaver(commit);
  useEffect(() => { cameBack = false; }, []);
  useEffect(() => { if (openId) lastOpen = openId; }, [openId]);

  // A failed save keeps the note here, where the error toast and the unsaved text both are.
  async function full(id: string) { if (await flush()) openFullScreen(id); }
  // Ctrl+Shift+F opens the open note full screen. Not from a plain input or a select, where the keys may
  // mean something else; the body editor is contenteditable, so it works while writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'f' || !open || kindOf(open) === 'Resume') return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
      event.preventDefault();
      full(open.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open?.id]);

  function select(id: string) { flush(); setOpenId(id); setPane('note'); }
  // New follows the view: the Journal's button opens today's entry, Ideas makes an idea, and a notebook
  // or a tag view files the new note there.
  const newKind: DocKind = view === 'journal' ? 'Journal' : view === 'ideas' ? 'Idea' : 'Note';
  const newLabel = view === 'journal' ? "Today's entry" : view === 'ideas' ? 'New idea' : 'New note';
  const [menuOpen, setMenuOpen] = useState(false);
  async function create(kind: DocKind) {
    flush();
    setMenuOpen(false);
    const made = newDocFor(kind, workspace.docs);
    let doc = made.doc;
    if (!made.existing) {
      doc = view.startsWith('notebook:') ? { ...doc, tags: withNotebook(doc.tags, view.slice('notebook:'.length)) }
        : view.startsWith('tag:') ? { ...doc, tags: [...doc.tags, view.slice('tag:'.length)] } : doc;
      if (!await commit(w => ({ ...w, docs: [doc, ...w.docs] }))) return;
    }
    // A kind from the menu may not belong in the view on screen (a Resume made from Ideas); then the
    // list moves to where the new document is, so it is not open but missing from the list.
    if (!viewDocs([doc], view, '').length) setView(kind === 'Journal' ? 'journal' : kind === 'Idea' ? 'ideas' : 'all');
    setOpenId(doc.id); setPane('note');
  }

  // Notebooks: a name in workspace.notebooks, joined by a tag on each note. Deleting one drops the tag
  // from its notes and keeps the notes, which then sit under All notes.
  const notes = workspace.docs.filter(doc => doc.kind === 'note');
  const counts = Object.fromEntries(notebooks.map(notebook => [notebook.id, notes.filter(doc => notebookOf(doc) === notebook.id).length]));
  const tags = allUserTags(notes).map(tag => ({ tag, count: notes.filter(doc => doc.tags.includes(tag)).length }));
  const setNotebooks = (update: (list: Notebook[]) => Notebook[]) => commit(w => ({ ...w, notebooks: update(w.notebooks ?? []) }));
  const notebookActions = {
    create: (name: string) => setNotebooks(list => [...list, { id: uid(), name }]),
    rename: (id: string, name: string) => setNotebooks(list => list.map(notebook => notebook.id === id ? { ...notebook, name } : notebook)),
    remove: async (id: string) => {
      flush();
      const ok = await commit(w => ({ ...w, notebooks: (w.notebooks ?? []).filter(notebook => notebook.id !== id), docs: w.docs.map(doc => notebookOf(doc) === id ? { ...doc, tags: withNotebook(doc.tags, null) } : doc) }));
      if (ok && view === 'notebook:' + id) setView('all');
      return ok;
    },
  };

  const journal = view === 'journal' && !query.trim();
  const earlier = journal ? onThisDay(workspace.docs) : [];
  const item = (doc: Doc) => <DocItem key={doc.id} doc={doc} selected={doc.id === openId} open={() => select(doc.id)}/>;
  const empty = query || view !== 'all' ? 'Nothing matches.' : 'No documents yet.';

  return <div className="docs-page" data-pane={pane}>
    <DocsNav view={view} setView={next => { setView(next); setPane('list'); }} notebooks={notebooks} counts={counts} tags={tags} actions={notebookActions}/>
    <aside className="docs-list panel" aria-label="Documents">
      <div className="docs-list-top">
        <label className="docs-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label="Search documents" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="docs-new-row" onKeyDown={event => { if (event.key === 'Escape') setMenuOpen(false); }}>
          <button type="button" className="button primary docs-new" onClick={() => void create(newKind)}><Plus size={15}/>{newLabel}</button>
          <button type="button" className="button primary docs-new-more" aria-label="New, other kinds" title="Other kinds" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><ChevronDown size={15}/></button>
          {menuOpen && <div className="docs-new-menu panel" role="menu" aria-label="New document">
            {NEW_MENU.map(([kind, label]) => <button key={kind} type="button" role="menuitem" onClick={() => void create(kind)}>{label}</button>)}
          </div>}
        </div>
      </div>
      {!shown.length ? <p className="docs-empty-list">{empty}</p>
        : journal ? <div className="docs-journal">
          {earlier.length > 0 && <section aria-label="On this day"><h3 className="docs-group">On this day</h3><ul className="docs-items">{earlier.map(item)}</ul></section>}
          {journalMonths(shown).map(group => <section key={group.month} aria-label={group.month}><h3 className="docs-group">{group.month}</h3><ul className="docs-items">{group.entries.map(item)}</ul></section>)}
        </div>
        : <ul className="docs-items">{shown.map(item)}</ul>}
    </aside>
    {/* note-print marks what Save as PDF prints (docs.css). The resume prints its own page instead. */}
    <section className={`docs-editor panel ${open && kindOf(open) !== 'Resume' ? 'note-print' : ''}`} aria-label="Editor">
      {!open ? <div className="docs-empty"><FileText size={26} aria-hidden="true"/><p>Pick a document on the left, or start a new one.</p></div>
        : kindOf(open) === 'Resume'
          ? <ResumePane key={open.id} doc={open} status={status} edit={(change, atOnce) => edit(open.id, change, atOnce)} back={() => setPane('list')} remove={remove && (() => { flush(); remove(open); })}>
            <Resume workspace={workspace} commit={commit}/>
          </ResumePane>
          : <DocPane key={open.id} doc={open} notebooks={notebooks} status={status} edit={(change, atOnce) => edit(open.id, change, atOnce)} full={() => full(open.id)} back={() => setPane('list')} remove={remove && (() => { flush(); remove(open); })}/>}
    </section>
  </div>;
}

function DocItem({ doc, selected, open }: { doc: Doc; selected: boolean; open: () => void }) {
  const preview = previewOf(doc.content);
  return <li>
    <button type="button" className={selected ? 'selected' : ''} aria-current={selected ? 'true' : undefined} onClick={open}>
      <span className="docs-item-top"><strong>{doc.name}</strong>{doc.pinned && <Pin className="docs-pin" size={12} aria-label="Pinned"/>}</span>
      {preview && <span className="docs-item-preview">{preview}</span>}
      <span className="docs-item-meta">{kindOf(doc)} · {shortDate(doc.updated)}</span>
    </button>
  </li>;
}

// One open document. key={doc.id} on it (above) gives each document a fresh title field and editor,
// so nothing from the last document can leak into the next one.
function DocPane({ doc, notebooks, status, edit, full, back, remove }: { doc: Doc; notebooks: Notebook[]; status: SaveStatus; edit: (change: Change, atOnce?: boolean) => void; full: () => void; back: () => void; remove?: () => void }) {
  const [title, setTitle] = useState(doc.name === UNTITLED ? '' : doc.name);
  // The body's word count follows the editor as it types, ahead of the save.
  const [words, setWords] = useState(() => wordCount(doc.content));
  const [tagText, setTagText] = useState(() => userTags(doc.tags).join(', '));
  const kind = kindOf(doc);
  const setKind = (next: DocKind) => edit({ tags: [...doc.tags.filter(tag => !(DOC_KINDS as readonly string[]).includes(tag)), next] }, true);
  // Tags save when the field is left or Enter is pressed, not per keystroke, so a half-typed tag does
  // not flash into the left pane.
  const saveTags = () => { const next = withUserTags(doc.tags, tagText.split(',')); if (next.join('\n') !== doc.tags.join('\n')) edit({ tags: next }, true); };
  const notebook = notebookOf(doc);
  return <>
    <button type="button" className="text-button docs-back" onClick={back}><ArrowLeft size={15}/>All documents</button>
    <input className="docs-title" aria-label="Title" placeholder={UNTITLED} value={title} maxLength={1024} onChange={event => { setTitle(event.target.value); edit({ name: event.target.value }); }}/>
    {/* The title as a heading for the printed page only; a text field does not print well. */}
    <h1 className="print-title">{title.trim() || UNTITLED}</h1>
    <div className="docs-meta">
      <select aria-label="Kind" value={kind} onChange={event => setKind(event.target.value as DocKind)}>{TEXT_KINDS.map(item => <option key={item}>{item}</option>)}</select>
      <select aria-label="Notebook" value={notebook && notebooks.some(n => n.id === notebook) ? notebook : ''} onChange={event => edit({ tags: withNotebook(doc.tags, event.target.value || null) }, true)}>
        <option value="">No notebook</option>
        {notebooks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <input className="docs-tags" aria-label="Tags" placeholder="Tags, comma separated" value={tagText} onChange={event => setTagText(event.target.value)} onBlur={saveTags} onKeyDown={event => { if (event.key === 'Enter') saveTags(); }}/>
      <span>{plural(words, 'word')}</span>
      <span role="status">{status === 'saving' ? 'Saving' : 'Saved'}</span>
      <span className="docs-meta-actions">
        <button type="button" className="icon-button" aria-pressed={doc.pinned} onClick={() => edit({ pinned: !doc.pinned }, true)} aria-label={doc.pinned ? 'Unpin this document' : 'Pin this document'} title={doc.pinned ? 'Unpin' : 'Pin to the top, and to Today'}>{doc.pinned ? <PinOff size={15}/> : <Pin size={15}/>}</button>
        <button type="button" className="icon-button" onClick={printNote} aria-label="Save as PDF" title="Save as PDF (opens the print dialog; choose Save as PDF)"><Printer size={15}/></button>
        <button type="button" className="button docs-full" onClick={full} title="Full screen (Ctrl+Shift+F)"><Maximize2 size={14}/>Full screen</button>
        {remove && <button type="button" className="icon-button" onClick={remove} aria-label="Delete this document" title="Delete"><Trash2 size={15}/></button>}
      </span>
    </div>
    <Suspense fallback={<div className="docs-loading"><Loader2 className="spin" size={16}/>Opening the editor</div>}>
      <DocEditor markdown={doc.content} onChange={content => { setWords(wordCount(content)); edit({ content }); }}/>
    </Suspense>
  </>;
}

// The resume, as a note of kind Resume: its title, pin and delete, then the resume editor itself, which
// saves workspace.resume on its own and has its own Download PDF and Template menu.
function ResumePane({ doc, status, edit, back, remove, children }: { doc: Doc; status: SaveStatus; edit: (change: Change, atOnce?: boolean) => void; back: () => void; remove?: () => void; children: ReactNode }) {
  const [title, setTitle] = useState(doc.name === UNTITLED ? '' : doc.name);
  return <div className="docs-resume">
    <button type="button" className="text-button docs-back" onClick={back}><ArrowLeft size={15}/>All documents</button>
    <input className="docs-title" aria-label="Title" placeholder={UNTITLED} value={title} maxLength={1024} onChange={event => { setTitle(event.target.value); edit({ name: event.target.value }); }}/>
    <div className="docs-meta">
      <span>Resume</span>
      <span role="status">{status === 'saving' ? 'Saving' : 'Saved'}</span>
      <span className="docs-meta-actions">
        <button type="button" className="icon-button" aria-pressed={doc.pinned} onClick={() => edit({ pinned: !doc.pinned }, true)} aria-label={doc.pinned ? 'Unpin this document' : 'Pin this document'} title={doc.pinned ? 'Unpin' : 'Pin to the top, and to Today'}>{doc.pinned ? <PinOff size={15}/> : <Pin size={15}/>}</button>
        {remove && <button type="button" className="icon-button" onClick={remove} aria-label="Delete this document" title="Delete this entry (the resume itself stays, and New > Resume brings it back)"><Trash2 size={15}/></button>}
      </span>
    </div>
    {children}
  </div>;
}
