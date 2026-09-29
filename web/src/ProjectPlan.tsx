// A project's plan on the Projects page: its walkthrough and its delivery pipeline, read from
// ~/.brain/project-plans through server/project-plans.mjs (lib/project-plans.ts has the calls).
//   usePlanSummaries + PlanSummaryLine: the "5 of 9 stages · 1 active" line under a project row.
//   ProjectPlan: the two tabs on a project's page. Walkthrough is the plan's markdown in the app's
//     Markdown component; Pipeline is the same ProcessingTimeline the Board's Pipeline view draws, with an
//     "Edit pipeline" mode in the same controls (PipelineView.tsx), saving each change to the server.
// The plan is server data, not workspace data, so unlike PipelineView nothing here goes through the
// board's patch path: every save is one PUT or POST, and the page shows the plan the server sends back.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Loader2, SquarePen } from 'lucide-react';
import { ProcessingTimeline, statusLabel, type TimelineStage } from '@/components/ui/processing-timeline';
import { Markdown } from './Markdown';
import { AddStage } from './PipelineView';
import { LIMITS, STATUSES } from './lib/pipeline';
import { addPlanStage, fetchPlan, fetchPlanSummaries, planFile, saveStage, summaryText, type PlanStage, type PlanSummary, type ProjectPlan as Plan, type StageFields } from './lib/project-plans';
import type { StageStatus } from './types';
import './pipeline-view.css';
import './project-plan.css';

// Every plan's summary by key, fetched once per visit. Empty on a hosted deploy or when there are none,
// which simply means no row shows a summary.
export function usePlanSummaries() {
  const [plans, setPlans] = useState<Record<string, PlanSummary>>({});
  useEffect(() => {
    let live = true;
    fetchPlanSummaries().then(list => { if (live) setPlans(Object.fromEntries(list.map(plan => [plan.key, plan]))); }, () => {});
    return () => { live = false; };
  }, []);
  return plans;
}

export const PlanSummaryLine = ({ plan }: { plan?: PlanSummary }) => plan ? <small className="plan-summary">Pipeline: {summaryText(plan)}</small> : null;

const toTimeline = (stage: PlanStage): TimelineStage => ({ id: stage.id, title: stage.title, description: stage.detail, status: stage.status, progress: stage.progress, output: stage.output, startedAt: stage.startedAt, endedAt: stage.endedAt });
type Tab = 'walkthrough' | 'pipeline';

export function ProjectPlan({ projectKey }: { projectKey: string }) {
  // undefined while loading, null when the project has no plan file yet.
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('walkthrough');
  const base = useId();
  useEffect(() => {
    let live = true; setPlan(undefined); setError('');
    fetchPlan(projectKey).then(found => { if (live) setPlan(found); }, failure => { if (live) { setPlan(null); setError(failure instanceof Error ? failure.message : 'Could not read the plan.'); } });
    return () => { live = false; };
  }, [projectKey]);

  if (plan === undefined) return <div className="panel project-empty plan-block"><Loader2 className="spin" size={16}/>Reading the project plan…</div>;
  if (!plan) return <div className="panel project-empty plan-block" role={error ? 'alert' : undefined}>{error || <>No plan yet. Its walkthrough and pipeline go in <code>{planFile(projectKey)}</code>.</>}</div>;
  // Two tabs, so either arrow key moves to the other one, as a tab list is expected to.
  const keys = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTab(tab === 'walkthrough' ? 'pipeline' : 'walkthrough'); } };
  const tabs: [Tab, string][] = [['walkthrough', 'Walkthrough'], ['pipeline', 'Pipeline']];
  return <section className="plan-block" aria-label="Project plan">
    <div className="tabs" role="tablist" aria-label="Project plan" onKeyDown={keys}>
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`${base}-${id}`} aria-controls={`${base}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${tab}`} className="plan-panel">
      {tab === 'walkthrough'
        ? <div className="panel plan-walkthrough">{plan.walkthrough.trim() ? <Markdown content={plan.walkthrough}/> : <p className="project-empty">This plan has no walkthrough yet.</p>}</div>
        : <PlanPipeline plan={plan} setPlan={setPlan}/>}
    </div>
  </section>;
}

function PlanPipeline({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const stages = plan.pipeline.stages;
  // Each save replaces the plan with the server's copy, so what shows is what was written to disk.
  async function run(work: () => Promise<Plan>) {
    try { setPlan(await work()); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'The change could not be saved.'); }
  }
  const toolbar = <button type="button" className="button small" aria-pressed={editing} onClick={() => setEditing(value => !value)}><SquarePen size={14}/>Edit pipeline</button>;
  return <div className="pipeline-view">
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    <ProcessingTimeline title="Delivery pipeline" subtitle={plan.pipeline.subtitle || undefined} stages={stages.map(toTimeline)} layout={plan.pipeline.layout} toolbar={toolbar}
      editor={editing ? (_stage, index) => stages[index] && <PlanStageEditor key={stages[index].id} stage={stages[index]} save={fields => run(() => saveStage(plan.key, stages[index].id, fields))}/> : undefined}/>
    {editing && <AddStage add={title => void run(() => addPlanStage(plan.key, title))}/>}
  </div>;
}

// One stage's controls, the PipelineView editor's subset the plan routes accept: status saves at once,
// progress on release (or Enter, or leaving the box), description and output on blur.
function PlanStageEditor({ stage, save }: { stage: PlanStage; save: (fields: StageFields) => void }) {
  const name = stage.title;
  const [draft, setDraft] = useState<string | null>(null);
  const progress = draft ?? (stage.progress === undefined ? '' : String(stage.progress));
  function commitProgress(value: string) {
    setDraft(null);
    const number = value.trim() === '' ? null : Math.min(100, Math.max(0, Math.round(Number(value))));
    if (number !== null && !Number.isFinite(number)) return;
    if (number !== (stage.progress ?? null)) save({ progress: number });
  }
  const commitDraft = (value: string) => { if (draft !== null) commitProgress(value); };
  const text = (field: 'detail' | 'output', label: string, max: number) =>
    <label>{label}<textarea key={field + (stage[field] ?? '')} rows={3} maxLength={max} defaultValue={stage[field] ?? ''} aria-label={`${label} of ${name}`}
      onBlur={event => { if (event.target.value !== (stage[field] ?? '')) save({ [field]: event.target.value }); }}/></label>;
  return <fieldset className="pipeline-editor">
    <legend>Edit stage</legend>
    <div className="pipeline-editor-row">
      <label>Status<select value={stage.status} aria-label={`Status of ${name}`} onChange={event => save({ status: event.target.value as StageStatus })}>
        {STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
      </select></label>
    </div>
    <div className="pipeline-editor-row pipeline-progress">
      <label className="pipeline-grow">Progress<input type="range" min={0} max={100} step={1} value={progress === '' ? 0 : Number(progress)} aria-label={`Progress of ${name}`}
        onChange={event => setDraft(event.target.value)} onPointerUp={event => commitDraft(event.currentTarget.value)} onKeyUp={event => commitDraft(event.currentTarget.value)} onBlur={event => commitDraft(event.target.value)}/></label>
      <input type="number" min={0} max={100} value={progress} placeholder="None" aria-label={`Progress percent of ${name}`} onChange={event => setDraft(event.target.value)}
        onBlur={event => commitDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitDraft(event.currentTarget.value); }}/>
      {stage.progress !== undefined && <button type="button" className="text-button" onClick={() => commitProgress('')}>Clear</button>}
    </div>
    {text('detail', 'Description', 64 * 1024)}
    {text('output', 'Output', LIMITS.output)}
  </fieldset>;
}
