// ProcessingTimeline: one subject moving through ordered stages, rebuilt from the 21st.dev "ProcessingTimeline"
// in the app's own tokens and framer-motion (the original's `motion` package and its utils are not added;
// the few helpers it needed are written below). Everything it shows comes in through props, and every
// action goes back out through a callback, so it holds no data of its own: only which stage is open.
// Props:
//   title, subtitle: the header; titleId lets a dialog name itself after the title
//   stages: TimelineStage[], in order. progress is 0 to 100 and only ever what the owner supplied:
//     with none, no bar is drawn, because a bar that moves by itself would be a claim nobody made
//   layout: 'vertical' (a rail of cards, each a disclosure) or 'horizontal' (a row of stages and one
//     detail panel for the selected stage, which stacks under the row when the container is narrow)
//   onRetry(id), onSkip(id): per stage; Retry shows on a failed or cancelled stage, Skip on a skippable
//     unfinished one. onCancel(), onRestart(): for the job. Leave a callback out and its button is not drawn
//   editor(stage, index): optional, rendered inside a stage's details; the Pipeline view's edit mode uses it
//   toolbar: optional, drawn at the end of the header
// Accessibility: a status is always an icon and a word, never colour alone. The current stage carries
// aria-current="step" and a visible "Current stage" label. One polite status region announces a stage
// changing status and nothing else (not progress ticks, not the first render), so a screen reader is not
// flooded while an agent reports 1%, 2%, 3%. Under prefers-reduced-motion nothing animates: bars and
// panels render at their final state.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CheckCircle2, ChevronDown, CircleDashed, Clock3, Loader2, OctagonX, PauseCircle, RotateCcw, SkipForward, TriangleAlert, XCircle } from 'lucide-react';
import './processing-timeline.css';

export type StageStatus = 'pending' | 'queued' | 'active' | 'paused' | 'completed' | 'warning' | 'failed' | 'skipped' | 'cancelled';
export type TimelineStage = {
  id: string; title: string; description?: string; status: StageStatus; progress?: number;
  startedAt?: string; endedAt?: string; duration?: number; attempt?: number;
  error?: string; warning?: string; output?: string; logs?: string[]; metadata?: Record<string, string>; skippable?: boolean;
};
export type JobStatus = 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'warning' | 'failed' | 'cancelled';
type Props = {
  title: string; subtitle?: string; stages: TimelineStage[]; layout?: 'vertical' | 'horizontal'; titleId?: string;
  onRetry?: (id: string) => void; onSkip?: (id: string) => void; onCancel?: () => void; onRestart?: () => void;
  editor?: (stage: TimelineStage, index: number) => ReactNode; toolbar?: ReactNode;
};

// tone picks the colour token in the stylesheet; the word and the icon carry the meaning on their own.
const META: Record<StageStatus, { label: string; icon: typeof Clock3; tone: string }> = {
  pending: { label: 'Pending', icon: CircleDashed, tone: 'idle' },
  queued: { label: 'Queued', icon: Clock3, tone: 'idle' },
  active: { label: 'Running', icon: Loader2, tone: 'acc' },
  paused: { label: 'Paused', icon: PauseCircle, tone: 'amber' },
  completed: { label: 'Completed', icon: CheckCircle2, tone: 'green' },
  warning: { label: 'Completed with warning', icon: TriangleAlert, tone: 'amber' },
  failed: { label: 'Failed', icon: XCircle, tone: 'red' },
  skipped: { label: 'Skipped', icon: SkipForward, tone: 'idle' },
  cancelled: { label: 'Cancelled', icon: Ban, tone: 'idle' },
};
const JOB: Record<JobStatus, { label: string; icon: typeof Clock3; tone: string }> = {
  pending: META.pending, queued: META.queued, running: META.active, paused: META.paused, completed: META.completed,
  warning: { label: 'Completed with warnings', icon: TriangleAlert, tone: 'amber' }, failed: META.failed, cancelled: META.cancelled,
};
export const statusLabel = (status: StageStatus) => META[status].label;
const FINISHED: StageStatus[] = ['completed', 'warning', 'skipped'];
const showsBar = (stage: TimelineStage) => (stage.status === 'active' || stage.status === 'paused') && typeof stage.progress === 'number';
const clamp = (value: number) => Math.min(100, Math.max(0, value));

// The job's status, derived from its stages in order of what matters most: a failure, then a stage
// running, paused or cancelled, then all finished, then waiting.
export function jobStatus(stages: TimelineStage[]): JobStatus {
  const has = (status: StageStatus) => stages.some(stage => stage.status === status);
  if (has('failed')) return 'failed';
  if (has('active')) return 'running';
  if (has('paused')) return 'paused';
  if (has('cancelled')) return 'cancelled';
  if (stages.length && stages.every(stage => FINISHED.includes(stage.status))) return has('warning') ? 'warning' : 'completed';
  if (has('queued')) return 'queued';
  return stages.some(stage => FINISHED.includes(stage.status)) ? 'running' : 'pending';
}
// The stage the job is on: the running one, else a paused one, else a failed one (it is blocking), else
// the first that has not started. None when everything has ended.
export function currentStage(stages: TimelineStage[]) {
  for (const status of ['active', 'paused', 'failed'] as StageStatus[]) { const found = stages.find(stage => stage.status === status); if (found) return found.id; }
  return stages.find(stage => stage.status === 'pending' || stage.status === 'queued')?.id;
}
// Overall progress: finished stages count whole, a running or paused stage counts its own reported
// progress, nothing else counts. So the bar only moves when something really happened.
export function overallProgress(stages: TimelineStage[]) {
  if (!stages.length) return 0;
  const sum = stages.reduce((total, stage) => total + (FINISHED.includes(stage.status) ? 1 : showsBar(stage) ? clamp(stage.progress!) / 100 : 0), 0);
  return Math.round(sum / stages.length * 100);
}
export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
const when = (stamp?: string) => { const date = stamp ? new Date(stamp) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const durationOf = (stage: TimelineStage) => stage.duration ?? (stage.startedAt && stage.endedAt ? Date.parse(stage.endedAt) - Date.parse(stage.startedAt) : undefined);

// Read once per mount from the media query itself, and kept current if the setting changes. Our own hook
// rather than framer-motion's useReducedMotion, which reads the query once for the whole page.
function usePrefersReducedMotion() {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(() => Boolean(query()?.matches));
  useEffect(() => {
    const list = query(); if (!list?.addEventListener) return;
    const update = () => setReduced(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return reduced;
}

// The announcement: compares this render's statuses with the last render's (kept in a ref, which is
// React's way to remember a value across renders without causing one) and names only what changed.
function useTransitionAnnouncement(stages: TimelineStage[]) {
  const previous = useRef<Map<string, StageStatus> | null>(null);
  const [message, setMessage] = useState('');
  const key = stages.map(stage => stage.id + ':' + stage.status).join('|');
  useEffect(() => {
    const before = previous.current, now = new Map(stages.map(stage => [stage.id, stage.status]));
    previous.current = now;
    if (!before) return;
    const changed = stages.filter(stage => before.has(stage.id) && before.get(stage.id) !== stage.status);
    if (changed.length) setMessage(changed.map(stage => `${stage.title}: ${META[stage.status].label}`).join('. '));
  }, [key]);
  return message;
}

function StatusBadge({ status, job }: { status: StageStatus; job?: JobStatus }) {
  const meta = job ? JOB[job] : META[status], Icon = meta.icon;
  return <span className="pt-status" data-tone={meta.tone}><Icon size={14} className={(job ? job === 'running' : status === 'active') ? 'spin' : undefined} aria-hidden="true"/>{meta.label}</span>;
}

function Bar({ value, label, reduced }: { value: number; label: string; reduced: boolean }) {
  return <div className="pt-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}%`}>
    <motion.span className="pt-bar-fill" initial={reduced ? false : { width: 0 }} animate={{ width: `${value}%` }} transition={reduced ? { duration: 0 } : { duration: 0.5, ease: 'easeOut' }}/>
  </div>;
}

function Details({ stage, index, onRetry, onSkip, editor, reduced }: { stage: TimelineStage; index: number; onRetry?: Props['onRetry']; onSkip?: Props['onSkip']; editor?: Props['editor']; reduced: boolean }) {
  const duration = durationOf(stage);
  const facts: [string, string][] = [
    ['Started', when(stage.startedAt)], ['Ended', when(stage.endedAt)], ['Duration', duration === undefined ? '' : formatDuration(duration)],
    ['Attempt', stage.attempt && stage.attempt > 1 ? String(stage.attempt) : ''], ...Object.entries(stage.metadata ?? {}),
  ].filter(([, value]) => value) as [string, string][];
  const canRetry = onRetry && (stage.status === 'failed' || stage.status === 'cancelled');
  const canSkip = onSkip && stage.skippable && !FINISHED.includes(stage.status) && stage.status !== 'cancelled';
  return <div className="pt-details">
    {showsBar(stage) && <Bar value={clamp(stage.progress!)} label={`${stage.title} progress`} reduced={reduced}/>}
    {stage.description && <p className="pt-description">{stage.description}</p>}
    {stage.error && <p className="pt-note" data-tone="red"><OctagonX size={14} aria-hidden="true"/><span><strong>Error</strong> {stage.error}</span></p>}
    {stage.warning && <p className="pt-note" data-tone="amber"><TriangleAlert size={14} aria-hidden="true"/><span><strong>Warning</strong> {stage.warning}</span></p>}
    {facts.length > 0 && <dl className="pt-facts">{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
    {stage.output && <div className="pt-block"><h4>Output</h4><pre>{stage.output}</pre></div>}
    {stage.logs && stage.logs.length > 0 && <div className="pt-block"><h4>Log <span>{stage.logs.length}</span></h4><pre className="pt-logs">{stage.logs.join('\n')}</pre></div>}
    {(canRetry || canSkip) && <div className="pt-stage-actions">
      {canRetry && <button type="button" className="button small" aria-label={`Retry ${stage.title}`} onClick={() => onRetry!(stage.id)}><RotateCcw size={14}/>Retry</button>}
      {canSkip && <button type="button" className="button small" aria-label={`Skip ${stage.title}`} onClick={() => onSkip!(stage.id)}><SkipForward size={14}/>Skip</button>}
    </div>}
    {editor?.(stage, index)}
  </div>;
}

export function ProcessingTimeline({ title, subtitle, stages, layout = 'vertical', titleId, onRetry, onSkip, onCancel, onRestart, editor, toolbar }: Props) {
  const reduced = usePrefersReducedMotion();
  const announcement = useTransitionAnnouncement(stages);
  const [open, setOpen] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const base = useId();
  const job = jobStatus(stages), current = currentStage(stages);
  const finished = stages.filter(stage => FINISHED.includes(stage.status)).length;
  const toggle = (id: string) => setOpen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const canCancel = onCancel && (job === 'running' || job === 'paused' || job === 'queued');
  const canRestart = onRestart && (job === 'completed' || job === 'warning' || job === 'failed' || job === 'cancelled');
  // In the horizontal layout one stage is shown in the panel: the one picked, else the current one.
  const shown = stages.find(stage => stage.id === selected) ?? stages.find(stage => stage.id === current) ?? stages[0];
  const panelMotion = reduced ? { initial: false as const, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0 } } : { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.2 } };

  return <section className="pt" data-layout={layout} aria-labelledby={titleId ?? base + '-title'}>
    <header className="pt-head">
      <div className="pt-heading">
        <h2 id={titleId ?? base + '-title'}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="pt-summary">
        <StatusBadge status="pending" job={job}/>
        <span className="pt-count">{finished} of {stages.length} stages</span>
      </div>
      {stages.length > 0 && <Bar value={overallProgress(stages)} label="Overall progress" reduced={reduced}/>}
      {(canCancel || canRestart || toolbar) && <div className="pt-job-actions">
        {canCancel && <button type="button" className="button small" onClick={onCancel}><Ban size={14}/>Cancel</button>}
        {canRestart && <button type="button" className="button small" onClick={onRestart}><RotateCcw size={14}/>Restart</button>}
        {toolbar}
      </div>}
    </header>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {stages.length === 0 ? <p className="pt-empty">No stages yet.</p> : layout === 'vertical'
      ? <ol className="pt-rail">
        {stages.map((stage, index) => {
          const expanded = open.includes(stage.id), isCurrent = stage.id === current, panel = `${base}-stage-${index}`;
          return <li key={stage.id} className="pt-stage" data-status={stage.status} data-tone={META[stage.status].tone} data-current={isCurrent || undefined} aria-current={isCurrent ? 'step' : undefined}>
            <span className="pt-node" aria-hidden="true">{index + 1}</span>
            <div className="pt-card">
              <button type="button" className="pt-toggle" aria-expanded={expanded} aria-controls={panel} onClick={() => toggle(stage.id)}>
                <span className="pt-title">
                  {isCurrent && <small className="pt-current">Current stage</small>}
                  <strong>{stage.title}</strong>
                </span>
                <StatusBadge status={stage.status}/>
                {showsBar(stage) && <span className="pt-percent">{Math.round(clamp(stage.progress!))}%</span>}
                <ChevronDown size={16} className="pt-chevron" aria-hidden="true"/>
              </button>
              {showsBar(stage) && !expanded && <Bar value={clamp(stage.progress!)} label={`${stage.title} progress`} reduced={reduced}/>}
              <AnimatePresence initial={false}>
                {expanded && <motion.div key="details" id={panel} className="pt-collapse" {...panelMotion}>
                  <Details stage={stage} index={index} onRetry={onRetry} onSkip={onSkip} editor={editor} reduced={reduced}/>
                </motion.div>}
              </AnimatePresence>
            </div>
          </li>;
        })}
      </ol>
      : <div className="pt-horizontal">
        <ol className="pt-row">
          {stages.map((stage, index) => {
            const isCurrent = stage.id === current, isShown = stage.id === shown?.id;
            return <li key={stage.id} className="pt-chip" data-status={stage.status} data-tone={META[stage.status].tone} data-current={isCurrent || undefined} aria-current={isCurrent ? 'step' : undefined}>
              <button type="button" aria-expanded={isShown} aria-controls={`${base}-panel`} onClick={() => setSelected(stage.id)}>
                <span className="pt-node" aria-hidden="true">{index + 1}</span>
                <span className="pt-title">{isCurrent && <small className="pt-current">Current stage</small>}<strong>{stage.title}</strong></span>
                <StatusBadge status={stage.status}/>
              </button>
            </li>;
          })}
        </ol>
        {shown && <div id={`${base}-panel`} className="pt-panel" role="region" aria-label={`Details for ${shown.title}`}>
          <h3>{shown.title}</h3>
          <Details stage={shown} index={stages.indexOf(shown)} onRetry={onRetry} onSkip={onSkip} editor={editor} reduced={reduced}/>
        </div>}
      </div>}
  </section>;
}
