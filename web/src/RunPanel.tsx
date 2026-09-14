// "Run on this computer": starts one of the server's allowlisted maintenance skills
// (server/runner.mjs) and shows its output. The browser only ever sends a task id.
// It sits on the page of the skill it runs, so the output area is always shown.
//
// React pattern worth naming: polling with useEffect. While the task is running, the
// second effect starts an interval that re-fetches /api/tasks every two seconds; its
// cleanup function clears the interval as soon as it stops, so an idle page makes no requests.
import { useEffect, useState } from 'react';
import { Loader2, Play, TerminalSquare } from 'lucide-react';
import { api } from './lib/api';

type Run = { status: 'running' | 'done' | 'failed'; started: string; finished: string | null; exit: number | null; output: string };
type Task = { id: string; label: string; blurb: string; command: string; missing: string | null; run: Run | null };

function statusText(task: Task) {
  if (task.missing) return `${task.missing} is not installed, so this is off`;
  const run = task.run;
  if (!run) return 'Not run yet';
  if (run.status === 'running') return 'Running…';
  const seconds = run.finished ? Math.round((Date.parse(run.finished) - Date.parse(run.started)) / 1000) : 0;
  return run.status === 'done' ? `Done in ${seconds}s` : `Failed (exit ${run.exit})`;
}

export function RunPanel({ id }: { id: string }) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    // An older server has no tasks route; treat any unexpected reply as no task,
    // so this panel can never take the rest of the page down with it.
    try { const reply = await api<{ tasks?: Task[] }>('tasks'); setTask((Array.isArray(reply.tasks) ? reply.tasks : []).find(item => item.id === id) || null); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load tasks.'); }
  }
  useEffect(() => { void refresh(); }, [id]);

  const busy = task?.run?.status === 'running';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [busy]);

  async function start() {
    try { await api('run', { id }); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the run.'); }
  }

  return (
    <section className="panel run-panel" aria-labelledby="run-panel-title">
      <div className="run-panel-head">
        <TerminalSquare size={18} />
        <h2 id="run-panel-title">Run on this computer</h2>
        <span className="muted">Runs this skill through claude -p, with no chat window.</span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {task && (
        <div className="run-row">
          <div className="run-main">
            <span className="muted">{task.blurb}</span>
            <span className={`run-status ${task.missing ? 'failed' : task.run?.status || ''}`}>
              {busy && <Loader2 size={13} className="spin" />}{statusText(task)}
            </span>
          </div>
          <div className="run-actions">
            <button className="button small" disabled={!!task.missing || busy} onClick={() => void start()}>
              <Play size={14} />{busy ? 'Running' : 'Run'}
            </button>
          </div>
          <pre className="run-output" role="log" aria-label={`${task.label} output`}>{task.run?.output || 'Output appears here once the run starts.'}</pre>
          <code className="run-command">{task.command}</code>
        </div>
      )}
    </section>
  );
}
