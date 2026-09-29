// The home page's own search bar (the top bar, and its search, are folded away while the globe is
// the page). One field for two jobs: typing finds files, notes and folders in the workspace graph
// with the same ranking as the Ctrl+K search and the Network tree (searchNodes), and the two upkeep
// skills sit under the hits as commands, Run Clean up and Run Doctor plus. A pick of a file hands
// its id to Home, which opens it in the detail panel and turns the globe to it. A run starts
// through the same endpoint as the Skills page's Run column (POST /api/run with a task id,
// server/runner.mjs), and its status and last lines of output show in a small card with a link to
// the full run on #skills.
//
// Not components/ui/action-searchbar.tsx: that one filters a fixed list of commands by label, and
// here the list is rebuilt from the graph on every keystroke, ranked, not filtered. The rows reuse
// its classes (styles.css), so both searches look alike.
//
// Keys: / focuses the field from anywhere on the page, arrows move the highlight, Enter picks,
// Escape clears the text (and closes the list when it is already empty).
//
// React pattern worth naming: polling with useEffect, as RunPanel.tsx does. While a run is going,
// the effect re-reads /api/tasks every second; its cleanup clears the interval once the run ends.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Loader2, Search, X, Zap } from 'lucide-react';
import { api } from './lib/api';
import { colorOf, searchNodes, type Model } from './lib/network';
import { KindIcon, kindLabel } from './FileViewer';
import { focusRun, statusText, type Task } from './RunPanel';

export const COMMANDS = [
  { id: 'clean-up', label: 'Run Clean up', name: 'Clean up', blurb: 'stray processes and temp files' },
  { id: 'doctor-plus', label: 'Run Doctor plus', name: 'Doctor plus', blurb: 'health check, changes nothing' },
];
type Command = typeof COMMANDS[number];
type Row = { key: string; node: number } | { key: string; command: Command };
type RunState = { command: Command; started: boolean; task: Task | null; error: string };
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function HomeSearch({ model, onPick }: { model: Model | null; onPick: (id: string) => void }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const field = useRef<HTMLInputElement>(null); const listId = useId();
  const hits = useMemo(() => model && query.trim() ? searchNodes(model, query, 6) : [], [model, query]);
  const rows: Row[] = [...hits.map(node => ({ key: model!.nodes[node].id, node })), ...COMMANDS.map(command => ({ key: 'run:' + command.id, command }))];
  useEffect(() => { setActive(0); }, [query]);

  // / focuses the field, unless the key was typed into another field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return; event.preventDefault(); field.current?.focus(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status = run?.task?.run?.status;
  const polling = !!run && run.started && !run.error && (!status || status === 'running');
  useEffect(() => {
    if (!polling || !run) return;
    const id = run.command.id; let live = true;
    const read = async () => { try { const reply = await api<{ tasks?: Task[] }>('tasks'); const task = reply.tasks?.find(item => item.id === id) || null; if (live) setRun(state => state && state.command.id === id ? { ...state, task } : state); } catch { /* the next tick tries again */ } };
    void read(); const timer = setInterval(() => void read(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [polling, run?.command.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(command: Command) {
    setRun({ command, started: false, task: null, error: '' });
    try { await api('run', { id: command.id }); setRun(state => state && state.command.id === command.id ? { ...state, started: true } : state); }
    catch (error) { setRun(state => state && state.command.id === command.id ? { ...state, error: error instanceof Error ? error.message : 'Could not start the run' } : state); }
  }
  function choose(row: Row) {
    setOpen(false); setQuery(''); field.current?.blur();
    if ('node' in row) onPick(model!.nodes[row.node].id); else void start(row.command);
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else { setOpen(false); event.currentTarget.blur(); } return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(i => Math.min(rows.length - 1, i + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); return; }
    if (event.key === 'Enter' && rows[active]) { event.preventDefault(); choose(rows[active]); }
  }

  const where = (index: number) => { const root = model!.roots[model!.nodes[index].root]?.path || ''; const path = model!.paths[index]; return path && root ? path.slice(root.length + 1).split('/').slice(0, -1).join('/') : ''; };
  const lines = (run?.task?.run?.output || '').split('\n').filter(Boolean).slice(-6);
  return <>
    <div className="action-search home-search">
      <div className="action-search-field">
        <input ref={field} role="combobox" aria-label="Search the workspace or run a command" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined} placeholder="Search files and notes, or run a command" value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={keys}/>
        <span className="action-search-glyph" aria-hidden="true">{query ? <kbd>Enter</kbd> : <kbd>/</kbd>}</span>
      </div>
      {open && <div className="action-search-panel panel">
        <ul role="listbox" id={listId} aria-label="Results and commands">
          {query.trim() && !hits.length && <li className="action-search-item action-search-empty" aria-disabled="true"><span className="action-search-icon" aria-hidden="true"><Search size={14}/></span><span className="action-search-label">{model ? `Nothing named "${query.trim()}"` : 'Reading the map of this computer…'}</span></li>}
          {rows.map((row, i) => <li key={row.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="action-search-item" data-active={i === active || undefined} onMouseDown={event => event.preventDefault()} onClick={() => choose(row)} onMouseEnter={() => setActive(i)}>
            {'node' in row ? <>
              <span className="action-search-icon" aria-hidden="true" style={{ color: colorOf(model!.nodes[row.node]) }}><KindIcon node={model!.nodes[row.node]} size={14}/></span>
              <span className="action-search-label">{model!.nodes[row.node].name}</span>
              <span className="action-search-desc">{kindLabel(model!.nodes[row.node])}{where(row.node) ? ` · ${where(row.node)}` : ''}</span>
              <span className="action-search-end">Open</span>
            </> : <>
              <span className="action-search-icon" aria-hidden="true"><Zap size={14}/></span>
              <span className="action-search-label">{row.command.label}</span>
              <span className="action-search-desc">{row.command.blurb}</span>
              <span className="action-search-end">Run</span>
            </>}
          </li>)}
        </ul>
      </div>}
    </div>
    {run && <section className="home-run panel" aria-label={`${run.command.name} run`}>
      <header>
        <strong>{run.command.name}</strong>
        <button type="button" className="icon-button" aria-label="Dismiss run" onClick={() => setRun(null)}><X size={15}/></button>
      </header>
      <p className={`home-run-status ${run.error ? 'failed' : status || ''}`} role="status">
        {!run.error && polling && <Loader2 size={13} className="spin"/>}
        {run.error || (run.task ? statusText(run.task) : 'Starting…')}
      </p>
      {lines.length > 0 && <pre className="home-run-output" aria-label={`${run.command.name} output`}>{lines.join('\n')}</pre>}
      <a href="#skills" onClick={() => focusRun(run.command.id)}>The full run on Skills<ArrowUpRight size={13}/></a>
    </section>}
  </>;
}
