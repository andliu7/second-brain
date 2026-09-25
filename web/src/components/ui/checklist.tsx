// Checklist: a card's todo items. Props:
//   items: the ChecklistItem list
//   onToggle(id): flip one item's done state
//   onAdd(title) and onRemove(id): optional; when both are given the list is editable, with an add row
//     and a remove button per item. Without them it is a read-only list of checkboxes, as on a card face.
// The "2 of 5" summary a collapsed card shows is checklistSummary(items), so the card and the dialog agree.
import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { ChecklistItem } from '../../types';

export const checklistSummary = (items: ChecklistItem[]) => `${items.filter(item => item.done).length} of ${items.length}`;

export function Checklist({ items, onToggle, onAdd, onRemove }: { items: ChecklistItem[]; onToggle: (id: string) => void; onAdd?: (title: string) => void; onRemove?: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  function add(event: FormEvent) { event.preventDefault(); const title = draft.trim(); if (!title || !onAdd) return; onAdd(title); setDraft(''); }
  return <div className="checklist">
    {items.map(item => <div key={item.id} className="checklist-item" data-done={item.done || undefined}>
      <label><input type="checkbox" checked={item.done} onChange={() => onToggle(item.id)}/><span>{item.title}</span></label>
      {onRemove && <button type="button" className="icon-button" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.id)}><X size={13}/></button>}
    </div>)}
    {onAdd && <form className="checklist-add" onSubmit={add}>
      <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add an item" aria-label="New checklist item"/>
      <button type="submit" className="icon-button" aria-label="Add checklist item" disabled={!draft.trim()}><Plus size={14}/></button>
    </form>}
  </div>;
}
