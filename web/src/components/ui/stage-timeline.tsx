// StageTimeline: a project's stages as one numbered path, top to bottom. Rebuilt from the 21st.dev
// "path-to-resilience-orbital-timeline" look (numbered circles on a thin vertical line, a rounded card per
// stage, a sticky heading column beside it on wide screens) in the app's own tokens, with its data in props
// and without its call to action. Props:
//   stages: the card's ChecklistItem list; a project's stages are its checklist, so nothing is copied
//   aside: optional, the heading column; it sits above the stages, and beside them (sticky) when the
//     container is wide enough, a container query rather than a media query because the drawer is narrower than the page
//   onToggle(id), onEdit(id, change), onMove(id, by), onRemove(id), onAdd(title): every change goes to the caller,
//     which saves it; this component holds only which stages are expanded and the add row's text
// The circle is the stage's checkbox (role=checkbox), so a screen reader hears "Design the units, checkbox,
// not checked" and Space toggles it. The first unfinished stage is the current one (aria-current="step").
// StageProgress is the "3 of 7" line with its bar, shared by the board card, the drawer and Projects so all three agree.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { ChecklistItem } from '../../types';
import './stage-timeline.css';

type Change = Partial<Pick<ChecklistItem, 'title' | 'detail'>>;
type Props = { stages: ChecklistItem[]; aside?: ReactNode; onToggle: (id: string) => void; onEdit: (id: string, change: Change) => void; onMove: (id: string, by: -1 | 1) => void; onRemove: (id: string) => void; onAdd: (title: string) => void };

export function StageProgress({ stages }: { stages: ChecklistItem[] }) {
  const done = stages.filter(stage => stage.done).length;
  return <span className="stage-progress" title={`${done} of ${stages.length} stages done`}>
    <span className="stage-progress-bar" aria-hidden="true"><span style={{ width: stages.length ? `${done / stages.length * 100}%` : 0 }}/></span>
    <span className="stage-progress-text">{done} of {stages.length}</span>
  </span>;
}

export function StageTimeline({ stages, aside, onToggle, onEdit, onMove, onRemove, onAdd }: Props) {
  const [open, setOpen] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const current = stages.find(stage => !stage.done)?.id;
  const expand = (id: string) => setOpen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  // Not a <form>: the drawer may one day sit inside one, and a nested form is what broke the card dialog's checklist.
  function add() { const title = draft.trim(); if (!title) return; onAdd(title); setDraft(''); }
  // Deleting takes the focused button with it, so focus moves first: to the next stage's circle, else the
  // previous one's, else the add field. Otherwise it falls to the page and Esc no longer reaches the drawer.
  function remove(button: HTMLElement, id: string) {
    const item = button.closest('li'), next = item?.nextElementSibling ?? item?.previousElementSibling;
    (next?.querySelector<HTMLElement>('.stage-dot') ?? item?.closest('.stage-main')?.querySelector<HTMLElement>('.stage-add input'))?.focus();
    onRemove(id);
  }
  const addKeys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); add(); } };
  return <div className="stage-timeline">
    {aside && <div className="stage-aside">{aside}</div>}
    <div className="stage-main">
      {stages.length === 0 && <p className="stage-empty">No stages yet. Add the first one below.</p>}
      <ol className="stage-list">
        {stages.map((stage, index) => {
          const expanded = open.includes(stage.id), number = String(index + 1).padStart(2, '0');
          const status = stage.done ? `Done${stage.doneOn ? ` ${stage.doneOn}` : ''}` : stage.id === current ? 'Up next' : '';
          return <li key={stage.id} className="stage" data-done={stage.done || undefined} data-current={stage.id === current || undefined} aria-current={stage.id === current ? 'step' : undefined}>
            <button type="button" role="checkbox" aria-checked={stage.done} aria-label={stage.title} className="stage-dot" onClick={() => onToggle(stage.id)}>{stage.done ? <Check size={15} strokeWidth={2.5}/> : number}</button>
            <div className="stage-card">
              <div className="stage-head">
                <button type="button" className="stage-open" aria-expanded={expanded} aria-label={`Details for ${stage.title}`} onClick={() => expand(stage.id)}>
                  <span className="stage-number">{number}</span>
                  <span className="stage-title"><strong>{stage.title}</strong>{(status || stage.detail) && <small>{status || stage.detail!.split('\n')[0]}</small>}</span>
                </button>
                <div className="stage-tools">
                  <button type="button" className="icon-button" aria-label={`Move ${stage.title} up`} disabled={index === 0} onClick={() => onMove(stage.id, -1)}><ChevronUp size={14}/></button>
                  <button type="button" className="icon-button" aria-label={`Move ${stage.title} down`} disabled={index === stages.length - 1} onClick={() => onMove(stage.id, 1)}><ChevronDown size={14}/></button>
                  <button type="button" className="icon-button" aria-label={`Delete ${stage.title}`} onClick={event => remove(event.currentTarget, stage.id)}><Trash2 size={14}/></button>
                </div>
              </div>
              {/* Saved on blur, like a column's name: one save per edit rather than one per keystroke.
                  Keyed on the saved value so an edit made elsewhere replaces what is shown. */}
              {expanded && <div className="stage-edit">
                <input key={'t' + stage.title} defaultValue={stage.title} aria-label={`Title of ${stage.title}`} onBlur={event => { const title = event.target.value.trim(); if (title && title !== stage.title) onEdit(stage.id, { title }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
                <textarea key={'d' + (stage.detail || '')} rows={4} defaultValue={stage.detail || ''} placeholder="Notes, links, what done looks like" aria-label={`Notes for ${stage.title}`} onBlur={event => { if (event.target.value !== (stage.detail || '')) onEdit(stage.id, { detail: event.target.value }); }}/>
              </div>}
            </div>
          </li>;
        })}
      </ol>
      <div className="stage-add">
        <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={addKeys} placeholder="Add a stage" aria-label="New stage"/>
        <button type="button" className="icon-button" aria-label="Add stage" disabled={!draft.trim()} onClick={add}><Plus size={15}/></button>
      </div>
    </div>
  </div>;
}
