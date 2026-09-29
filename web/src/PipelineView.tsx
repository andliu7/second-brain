// The Pipeline view of a board project: its stages drawn by ProcessingTimeline instead of StageTimeline,
// switched on per project (card.pipeline.enabled) from the project drawer (Kanban.tsx ProjectPanel) and
// from Projects. It is the same checklist either way, so switching back and forth loses nothing.
//   PipelineSwitch: the "Pipeline view" switch (name: its accessible name where several share a page). Off by default; on, it also shares the pipeline with
//     Claude Code through the server mirror (lib/pipeline-sync.ts); off again, it takes it back out.
//   PipelineView: the timeline, its job and stage actions (retry, skip, cancel, restart), an "Edit pipeline"
//     mode to build the stages out, and a line saying whether Claude Code can see it.
// Every change is a function of the card handed to `change`, which the caller routes through the board's
// own patch path (boardPatch), so the pipeline is saved, validated and backed up like any card edit.
import { useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Plus, SquarePen, Trash2 } from 'lucide-react';
import type { Card, ChecklistItem, PipelineSettings, StageStatus } from './types';
import { ProcessingTimeline, statusLabel } from '@/components/ui/processing-timeline';
import { addStage, appendLog, cancel, editStage, LIMITS, makeCurrent, moveStage, removeStage, restart, retry, setStatus, skip, statusOf, STATUSES, toTimelineStage } from './lib/pipeline';
import { unsharePipeline, usePipelineSync, type SyncState } from './lib/pipeline-sync';
import './pipeline-view.css';

type Change = (update: (card: Card) => Card, message?: string) => void;
type Stages = ChecklistItem[];
const settingsOf = (card: Card): PipelineSettings => card.pipeline ?? { enabled: false, layout: 'vertical' };

export function PipelineSwitch({ card, change, name }: { card: Card; change: Change; name?: string }) {
  const on = Boolean(card.pipeline?.enabled);
  function flip() {
    change(c => ({ ...c, pipeline: { ...settingsOf(c), enabled: !on } }), on ? undefined : 'Pipeline view on');
    if (on) void unsharePipeline(card.id);
  }
  return <button type="button" role="switch" aria-checked={on} aria-label={name} className="pipeline-switch" onClick={flip}>
    <span className="pipeline-switch-track" aria-hidden="true"><span/></span>Pipeline view
  </button>;
}

const SYNC_TEXT: Record<SyncState, string> = {
  off: '', connecting: 'Connecting to Claude Code',
  shared: 'Claude Code can read and update this pipeline',
  offline: 'In this browser only: Claude Code sees it while the app runs with npm run dev',
};

export function PipelineView({ card, change, titleId }: { card: Card; change: Change; titleId?: string }) {
  const [editing, setEditing] = useState(false);
  const sync = usePipelineSync(card, change);
  const settings = settingsOf(card);
  const set = (update: (stages: Stages) => Stages, message?: string) => change(c => ({ ...c, checklist: update(c.checklist) }), message);
  const setSettings = (fields: Partial<PipelineSettings>) => change(c => ({ ...c, pipeline: { ...settingsOf(c), ...fields } }));
  const toolbar = <>
    <button type="button" className="button small" aria-pressed={editing} onClick={() => setEditing(value => !value)}><SquarePen size={14}/>Edit pipeline</button>
    {SYNC_TEXT[sync] && <span className="pipeline-sync" data-state={sync}>{SYNC_TEXT[sync]}</span>}
  </>;
  return <div className="pipeline-view">
    {editing && <div className="pipeline-settings">
      {/* Saved on blur, like the stage notes: one save per edit. Keyed on the saved value so a change
          made elsewhere (Claude, another tab) replaces what is shown. */}
      <label>Subtitle<input key={'s' + (settings.subtitle ?? '')} defaultValue={settings.subtitle ?? ''} maxLength={LIMITS.subtitle} placeholder="What this pipeline is for"
        onBlur={event => { const subtitle = event.target.value.trim() || undefined; if (subtitle !== settings.subtitle) setSettings({ subtitle }); }}/></label>
      <label>Layout<select value={settings.layout} onChange={event => setSettings({ layout: event.target.value as PipelineSettings['layout'] })}>
        <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
      </select></label>
    </div>}
    <ProcessingTimeline title={card.title} subtitle={settings.subtitle} stages={card.checklist.map(toTimelineStage)} layout={settings.layout} titleId={titleId} toolbar={toolbar}
      onRetry={id => set(stages => retry(stages, id), 'Stage retried')} onSkip={id => set(stages => skip(stages, id))}
      onCancel={() => set(cancel, 'Pipeline cancelled')} onRestart={() => set(restart, 'Pipeline restarted')}
      editor={editing ? (_stage, index) => card.checklist[index] && <StageEditor key={card.checklist[index].id} item={card.checklist[index]} index={index} count={card.checklist.length} set={set}/> : undefined}/>
    {editing && <AddStage add={title => set(stages => addStage(stages, title))}/>}
  </div>;
}

function AddStage({ add }: { add: (title: string) => void }) {
  const [draft, setDraft] = useState('');
  // Not a <form>: the drawer is a <dialog>, and a form inside it is how the card dialog's Enter bug started.
  function submit() { const title = draft.trim(); if (!title) return; add(title); setDraft(''); }
  return <div className="pipeline-add">
    <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} placeholder="Add a stage" aria-label="New pipeline stage" maxLength={LIMITS.title}/>
    <button type="button" className="button small" disabled={!draft.trim()} onClick={submit}><Plus size={14}/>Add stage</button>
  </div>;
}

// One stage's editing controls, inside its details. Text saves on blur; the status menu, the progress
// slider (on release), skippable and the buttons save at once.
function StageEditor({ item, index, count, set }: { item: ChecklistItem; index: number; count: number; set: (update: (stages: Stages) => Stages, message?: string) => void }) {
  const status = statusOf(item), name = item.title;
  // The progress field shows the saved number, or what is being typed or dragged (draft) until it is saved.
  // Derived rather than copied into state, so a number Claude Code reports shows at once.
  const [draft, setDraft] = useState<string | null>(null);
  const progress = draft ?? (item.progress === undefined ? '' : String(item.progress));
  const [log, setLog] = useState('');
  const edit = (fields: Parameters<typeof editStage>[2]) => set(stages => editStage(stages, item.id, fields));
  function commitProgress(value: string) {
    const number = value.trim() === '' ? undefined : Math.min(100, Math.max(0, Math.round(Number(value))));
    setDraft(null);
    if (number !== undefined && !Number.isFinite(number)) return;
    if (number !== item.progress) edit({ progress: number });
  }
  const commitDraft = (value: string) => { if (draft !== null) commitProgress(value); };
  function addLog() { const line = log.trim(); if (!line) return; set(stages => appendLog(stages, item.id, line)); setLog(''); }
  const text = (field: 'detail' | 'warning' | 'error' | 'output', label: string, max: number, rows = 2) =>
    <label>{label}<textarea key={field + (item[field] ?? '')} rows={rows} maxLength={max} defaultValue={item[field] ?? ''} aria-label={`${label} of ${name}`}
      onBlur={event => { if (event.target.value !== (item[field] ?? '')) edit({ [field]: event.target.value }); }}/></label>;
  const logKeys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); addLog(); } };
  return <fieldset className="pipeline-editor">
    <legend>Edit stage</legend>
    <div className="pipeline-editor-row">
      <label className="pipeline-grow">Title<input key={'t' + name} defaultValue={name} maxLength={LIMITS.title} aria-label={`Title of ${name}`}
        onBlur={event => { const title = event.target.value.trim(); if (title && title !== name) edit({ title }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>
      <label>Status<select value={status} aria-label={`Status of ${name}`} onChange={event => set(stages => setStatus(stages, item.id, event.target.value as StageStatus))}>
        {STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
      </select></label>
    </div>
    {/* The owner's own number, never an estimate: empty means no bar at all. It is drawn while the stage is
        running or paused. */}
    <div className="pipeline-editor-row pipeline-progress">
      <label className="pipeline-grow">Progress<input type="range" min={0} max={100} step={1} value={progress === '' ? 0 : Number(progress)} aria-label={`Progress of ${name}`}
        onChange={event => setDraft(event.target.value)} onPointerUp={event => commitDraft(event.currentTarget.value)} onKeyUp={event => commitDraft(event.currentTarget.value)} onBlur={event => commitDraft(event.target.value)}/></label>
      <input type="number" min={0} max={100} value={progress} placeholder="None" aria-label={`Progress percent of ${name}`} onChange={event => setDraft(event.target.value)}
        onBlur={event => commitDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitDraft(event.currentTarget.value); }}/>
      {item.progress !== undefined && <button type="button" className="text-button" onClick={() => commitProgress('')}>Clear</button>}
    </div>
    {text('detail', 'Description', 1024 * 1024, 3)}
    {text('warning', 'Warning', LIMITS.text)}
    {text('error', 'Error', LIMITS.text)}
    {text('output', 'Output', LIMITS.output, 3)}
    <div className="pipeline-editor-row">
      <input className="pipeline-grow" value={log} onChange={event => setLog(event.target.value)} onKeyDown={logKeys} maxLength={LIMITS.logLine} placeholder="Add a log line" aria-label={`New log line for ${name}`}/>
      <button type="button" className="button small" disabled={!log.trim()} onClick={addLog}>Append</button>
    </div>
    <div className="pipeline-editor-row pipeline-editor-tools">
      <label className="pipeline-check"><input type="checkbox" checked={Boolean(item.skippable)} onChange={event => edit({ skippable: event.target.checked })}/>Can be skipped</label>
      <button type="button" className="button small" disabled={status === 'active'} onClick={() => set(stages => makeCurrent(stages, item.id))}><Crosshair size={14}/>Make current</button>
      <span className="pipeline-grow"/>
      <button type="button" className="icon-button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => set(stages => moveStage(stages, item.id, -1))}><ChevronUp size={15}/></button>
      <button type="button" className="icon-button" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => set(stages => moveStage(stages, item.id, 1))}><ChevronDown size={15}/></button>
      <button type="button" className="icon-button" aria-label={`Delete ${name}`} onClick={() => set(stages => removeStage(stages, item.id), 'Stage deleted')}><Trash2 size={15}/></button>
    </div>
  </fieldset>;
}
