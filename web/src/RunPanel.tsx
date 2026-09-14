// "Run on this computer": starts the server's allowlisted maintenance skills
// (server/runner.mjs) and shows their output. The browser only ever sends a task id.
//
// React pattern worth naming: polling with useEffect. While any task is running, the
// second effect starts an interval that re-fetches /api/tasks every two seconds; its
// cleanup function clears the interval as soon as nothing is running, so an idle page
// makes no requests.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play, TerminalSquare } from 'lucide-react';
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

export function RunPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null); // the task whose output is shown

  async function refresh() {
    // An older server has no tasks route; treat any unexpected reply as an empty list,
    // so this panel can never take the rest of the page down with it.
    try { const reply = await api<{ tasks?: Task[] }>('tasks'); setTasks(Array.isArray(reply.tasks) ? reply.tasks : []); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load tasks.'); }
  }
  useEffect(() => { void refresh(); }, []);

  const running = tasks.some(task => task.run?.status === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [running]);

  async function start(id: string) {
    try { await api('run', { id }); setOpen(id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the run.'); }
  }

  return (
    <section className="panel run-panel" aria-labelledby="run-panel-title">
      <div className="run-panel-head">
        <TerminalSquare size={18} />
        <h2 id="run-panel-title">Run on this computer</h2>
        <span className="muted">Each runs one skill through claude -p, with no chat window.</span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {tasks.map(task => {
        const busy = task.run?.status === 'running';
        const shown = open === task.id && task.run;
        return (
          <div className="run-row" key={task.id}>
            <div className="run-main">
              <strong>{task.label}</strong>
              <span className="muted">{task.blurb}</span>
              <span className={`run-status ${task.missing ? 'failed' : task.run?.status || ''}`}>
                {busy && <Loader2 size={13} className="spin" />}{statusText(task)}
              </span>
            </div>
            <div className="run-actions">
              {task.run && (
                <button className="text-button" onClick={() => setOpen(shown ? null : task.id)} aria-expanded={!!shown}>
                  {shown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Output
                </button>
              )}
              <button className="button small" disabled={!!task.missing || busy} onClick={() => void start(task.id)}>
                <Play size={14} />{busy ? 'Running' : 'Run'}
              </button>
            </div>
            {shown && <pre className="run-output">{task.run!.output || 'No output yet.'}</pre>}
            <code className="run-command">{task.command}</code>
          </div>
        );
      })}
    </section>
  );
}
