// The Docs page's left pane: the fixed views (All notes, Journal, Ideas, Pinned), then the notebooks with
// their counts and the controls to make, rename and delete one, then every typed tag. Props:
//   view, setView: the view the middle list shows (lib/docs-kinds.ts View)
//   notebooks, counts: workspace.notebooks and how many notes each holds
//   tags: each typed tag with its count
//   actions: create, rename and remove a notebook; each resolves to whether the save worked
// Buttons, not a list of <li>: the middle pane's list items are the notes, and keeping the two apart
// keeps "every list item is a note" true for the page and its tests.
import { useState } from 'react';
import { BookOpen, Check, Hash, Lightbulb, NotebookPen, Pencil, Pin, Plus, StickyNote, Trash2, X } from 'lucide-react';
import type { Notebook } from './types';
import type { View } from './lib/docs-kinds';

type Actions = { create: (name: string) => Promise<boolean>; rename: (id: string, name: string) => Promise<boolean>; remove: (id: string) => Promise<boolean> };
const FIXED: { view: View; label: string; icon: typeof Pin }[] = [
  { view: 'all', label: 'All notes', icon: StickyNote },
  { view: 'journal', label: 'Journal', icon: NotebookPen },
  { view: 'ideas', label: 'Ideas', icon: Lightbulb },
  { view: 'pinned', label: 'Pinned', icon: Pin },
];

export function DocsNav({ view, setView, notebooks, counts, tags, actions }: { view: View; setView: (view: View) => void; notebooks: Notebook[]; counts: Record<string, number>; tags: { tag: string; count: number }[]; actions: Actions }) {
  // One small form at a time: naming a new notebook, renaming one, or confirming a delete.
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const current = (target: View) => view === target ? 'true' : undefined;

  return <nav className="docs-nav panel" aria-label="Notebooks and tags">
    {FIXED.map(({ view: target, label, icon: Icon }) => <button key={target} type="button" className="docs-nav-item" aria-current={current(target)} onClick={() => setView(target)}><Icon size={15} aria-hidden="true"/>{label}</button>)}

    <div className="docs-nav-head"><h2>Notebooks</h2><button type="button" className="icon-button" aria-label="New notebook" title="New notebook" onClick={() => { setCreating(true); setRenaming(null); setDeleting(null); }}><Plus size={14}/></button></div>
    {creating && <NameField label="New notebook name" initial="" save={async name => { if (await actions.create(name)) setCreating(false); }} cancel={() => setCreating(false)}/>}
    {notebooks.map(notebook => renaming === notebook.id
      ? <NameField key={notebook.id} label={`Rename ${notebook.name}`} initial={notebook.name} save={async name => { if (await actions.rename(notebook.id, name)) setRenaming(null); }} cancel={() => setRenaming(null)}/>
      : <div key={notebook.id} className="docs-nav-row">
        <button type="button" className="docs-nav-item" aria-current={current(`notebook:${notebook.id}`)} onClick={() => setView(`notebook:${notebook.id}`)}><BookOpen size={15} aria-hidden="true"/><span>{notebook.name}</span><small>{counts[notebook.id] ?? 0}</small></button>
        <span className="docs-nav-tools">
          <button type="button" className="icon-button" aria-label={`Rename ${notebook.name}`} title="Rename" onClick={() => { setRenaming(notebook.id); setDeleting(null); setCreating(false); }}><Pencil size={13}/></button>
          <button type="button" className="icon-button" aria-label={`Delete ${notebook.name}`} title="Delete" onClick={() => { setDeleting(notebook.id); setRenaming(null); setCreating(false); }}><Trash2 size={13}/></button>
        </span>
        {deleting === notebook.id && <div className="inline-confirm docs-nav-confirm" role="group" aria-label={`Delete ${notebook.name}?`}>
          <span>Delete this notebook? Its notes stay, under All notes.</span>
          <button type="button" className="text-button" onClick={async () => { if (await actions.remove(notebook.id)) setDeleting(null); }}>Delete notebook</button>
          <button type="button" className="text-button" onClick={() => setDeleting(null)}>Cancel</button>
        </div>}
      </div>)}
    {!notebooks.length && !creating && <p className="docs-nav-note">No notebooks yet.</p>}

    {tags.length > 0 && <>
      <div className="docs-nav-head"><h2>Tags</h2></div>
      {tags.map(({ tag, count }) => <button key={tag} type="button" className="docs-nav-item" aria-current={current(`tag:${tag}`)} onClick={() => setView(`tag:${tag}`)}><Hash size={15} aria-hidden="true"/><span>{tag}</span><small>{count}</small></button>)}
    </>}
  </nav>;
}

// A one-line name field: Enter or the tick saves a non-empty name, Escape or the cross cancels.
function NameField({ label, initial, save, cancel }: { label: string; initial: string; save: (name: string) => void; cancel: () => void }) {
  const [name, setName] = useState(initial);
  const submit = () => { if (name.trim()) save(name.trim()); };
  return <div className="docs-nav-field">
    <input autoFocus aria-label={label} value={name} maxLength={256} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') cancel(); }}/>
    <button type="button" className="icon-button" aria-label="Save name" onClick={submit}><Check size={13}/></button>
    <button type="button" className="icon-button" aria-label="Cancel" onClick={cancel}><X size={13}/></button>
  </div>;
}
