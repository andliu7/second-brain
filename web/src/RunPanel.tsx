// "Run on this computer": the column of run boxes on the Skills page, one box per maintenance
// skill the server can run (server/runner.mjs). The browser only ever sends a task id.
// One click on a box's play button starts the run in place. While it runs, the box shows the
// elapsed time and the output as it arrives; when it ends, the run's own closing summary under
// Takeaways, or why it failed and what to do next.
//
// React pattern worth naming: polling with useEffect. While any run is going, the second effect
// starts an interval that re-reads /api/tasks every second (each reply also moves the elapsed time
// on); its cleanup clears the interval as soon as nothing runs, so an idle page makes no requests.
import { useEffect, useRef, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { api } from './lib/api';
import { Markdown } from './Markdown';

type Run = { status: 'running' | 'done' | 'failed'; started: string; finished: string | null; exit: number | null; output: string; summary?: string | null };
export type Task = { id: string; label: string; blurb: string; command: string; missing: string | null; run: Run | null };

export function statusText(task: Task) {
  if (task.missing) return `${task.missing} is not installed, so this is off`;
  const run = task.run;
  if (!run) return 'Not run yet';
  if (run.status === 'running') return 'Running…';
  const seconds = run.finished ? Math.round((Date.parse(run.finished) - Date.parse(run.started)) / 1000) : 0;
  return run.status === 'done' ? `Done in ${seconds}s` : `Failed (exit ${run.exit})`;
}

const PREVIEW = 3; // lines of a finished run's log the box shows before Show all output

// 42s, or 3m 05s
const elapsed = (since: string) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

// Today's Skill runs rows send you here, to the column, rather than to the skill's pop-up, which
// holds no Run button. The row names the task it came from; the column puts focus on that box's play
// button once the tasks have arrived, so one click from Today lands on an enabled Run and its output.
let wanted = '';
export const focusRun = (id: string) => { wanted = id; };

export function RunColumn() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    // An older server, or a hosted one, has no tasks route; any unexpected reply reads as no tasks,
    // so this column can never take the rest of the page down with it.
    try { const reply = await api<{ tasks?: Task[] }>('tasks'); setTasks(Array.isArray(reply.tasks) ? reply.tasks : []); setError(''); }
    catch (err) { setTasks(list => list || []); setError(err instanceof Error ? err.message : 'Could not load tasks.'); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!tasks || !wanted) return; const id = wanted; wanted = ''; document.getElementById('run-play-' + id)?.focus(); }, [tasks]);

  const busy = !!tasks?.some(task => task.run?.status === 'running');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  async function start(id: string) {
    try { await api('run', { id }); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the run.'); }
  }

  return <aside className="run-column" aria-labelledby="run-column-title">
    <h2 id="run-column-title" className="run-column-title">Run on this computer</h2>
    {error && <p className="error-text" role="alert">{error}</p>}
    {tasks === null && <p className="run-blurb"><Loader2 size={13} className="spin"/> Reading what can run…</p>}
    {tasks?.map(task => <RunBox key={task.id} task={task} start={() => void start(task.id)}/>)}
  </aside>;
}

function RunBox({ task, start }: { task: Task; start: () => void }) {
  const run = task.run;
  const busy = run?.status === 'running';
  // A finished run's log collapses to a short preview, so the box stays compact and the output
  // reads as output, not content; Show all output opens the full scrolling log. While a run is
  // going the log is always open, streaming. The preview holds PREVIEW lines and shows them whole:
  // clipping the whole log instead painted the top of the next line into the box's bottom padding.
  // The lines it shows do not wrap either (skills.css), so a 120 character tool line cannot push the
  // last one past the fold and be sliced through the middle.
  const [showAll, setShowAll] = useState(false);
  const lines = (run?.output || '').split('\n').filter(Boolean);
  const lineCount = lines.length;
  const collapsible = !busy && lineCount > PREVIEW;
  const collapsed = collapsible && !showAll;
  // The newest output line stays in view as lines arrive, as in a terminal; a collapsed preview
  // shows the log from its first line instead.
  const log = useRef<HTMLPreElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = collapsed ? 0 : log.current.scrollHeight; }, [run?.output, collapsed]);
  const summary = run?.summary?.trim();
  return <section className="run-box" aria-labelledby={`run-${task.id}`}>
    <div className="run-box-head">
      <h3 id={`run-${task.id}`}>{task.label}</h3>
      <button type="button" id={`run-play-${task.id}`} className="icon-button run-play" aria-label={`Run ${task.label}`} title={task.missing ? statusText(task) : busy ? 'Running now' : `Run ${task.label}`} disabled={!!task.missing || busy} onClick={start}><Play size={15}/></button>
    </div>
    <p className="run-blurb">{task.blurb}</p>
    <p className={`run-status ${task.missing ? 'failed' : run?.status || ''}`}>{busy && <Loader2 size={13} className="spin"/>}{busy ? `Running · ${elapsed(run.started)}` : statusText(task)}</p>
    {run?.status === 'done' && summary && <div className="run-takeaways"><h4>Takeaways</h4><Markdown content={summary}/></div>}
    {run?.status === 'failed' && <Failure run={run}/>}
    <pre ref={log} id={`run-log-${task.id}`} className={`run-output${collapsed ? ' run-output-collapsed' : ''}${run?.output ? '' : ' run-output-empty'}`} role="log" aria-label={`${task.label} output`}>{collapsed ? lines.slice(0, PREVIEW).join('\n') : run?.output || 'Output appears here.'}</pre>
    {collapsible && <button type="button" className="run-log-toggle" aria-expanded={showAll} aria-controls={`run-log-${task.id}`} onClick={() => setShowAll(open => !open)}>{showAll ? 'Collapse output' : `Show all output (${lineCount} lines)`}</button>}
    <details className="run-command"><summary>Command</summary><code>{task.command}</code></details>
  </section>;
}

// Why a run failed, in words, and what to do next. The reason is the run's closing message when it
// has one (an error result), else the last line it printed. Claude Code's own out-of-credits message
// gets the page where the usage can be checked.
function Failure({ run }: { run: Run }) {
  const reason = (run.summary || run.output).trim().split('\n').pop()?.trim() || '';
  if (/out of usage credits|usage limit/i.test(`${run.summary}\n${run.output}`)) return <div className="run-failure" role="alert">
    <p>Claude Code is out of usage credits, so the run stopped.</p>
    <p>Check the usage at <a href="https://claude.ai/settings/usage" target="_blank" rel="noreferrer">claude.ai/settings/usage</a>, then run it again once it has reset.</p>
  </div>;
  if (run.exit === -1 || /not recognized|could not start claude/i.test(reason)) return <div className="run-failure" role="alert">
    <p>claude could not start on this computer{reason ? `: ${reason}` : '.'}</p>
    <p>Check that Claude Code is installed and that claude runs in a terminal, then run it again.</p>
  </div>;
  return <div className="run-failure" role="alert">
    <p>It stopped with exit {run.exit}{reason ? `: ${reason}` : '.'}</p>
    <p>The output below shows the step it stopped on. Fix that, then run it again.</p>
  </div>;
}
