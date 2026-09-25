// Today (#agenda): the day's page, top to bottom. The quote board, today's todos, the kanban (the same
// board as #board), this month's calendar, the activity heat map, then the two columns that were the
// whole page before: on the left what needs attention across Andrew's projects, read live from disk
// (/api/projects, the same data as Projects.tsx): repos with uncommitted work, each course's projects,
// and Blueberry's newest STATUS.md entry; on the right quick capture, pinned files and the skills that
// run on this computer (/api/tasks). Last, the Projects row, the only way to #projects since it left the
// nav. No hero, no slogan, no stat cards and no parallax (Andrew's decision of 2026-09-14).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, FolderGit2, GitBranch, GraduationCap, Loader2, Pencil, Pin, Plus, TerminalSquare, Zap } from 'lucide-react';
import type { Doc, Workspace } from './types';
import { api } from './lib/api';
import { Markdown } from './Markdown';
import { focusRun, statusText, type Task } from './RunPanel';
import { ProjectRow, type ProjectsData } from './Projects';
import { QuoteBoard } from './QuoteBoard';
import { TodoCard } from './TodoCard';
import { Kanban } from './Kanban';
import { MonthCalendar } from './MonthCalendar';
import { HeatCalendar } from '@/components/ui/heat-calendar';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Props = { data: ProjectsData | null; error: string; workspace: Workspace; commit: Commit; openDoc: (doc: Doc) => void; newDoc: () => void; capture: (text: string) => Promise<boolean> };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Today({ data, error, workspace, commit, openDoc, newDoc, capture }: Props) {
  const pinned = workspace.docs.filter(doc => doc.pinned);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksError, setTasksError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // A cold open lands with the caret in quick capture, so a thought is typed then Ctrl+Enter. Only
  // when nothing else has focus, so it never takes focus from a control the user just used, and
  // without scrolling, so the page still starts at the top. A layout effect runs in the same commit
  // that adds the box, as React's autoFocus does, so nothing can see the page before the caret is in.
  useLayoutEffect(() => { if (document.activeElement === document.body) box.current?.focus({ preventScroll: true }); }, []);

  // Read once per visit, so a run started in the Skills page's run column shows here when you come back.
  useEffect(() => {
    api<{ tasks?: Task[] }>('tasks').then(
      reply => setTasks(Array.isArray(reply.tasks) ? reply.tasks : []),
      () => { setTasks([]); setTasksError('Could not read skill runs. Open Skills to try again.'); },
    );
  }, []);

  // commit() in App.tsx reports a failed save itself and resolves false, so the text is kept.
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await capture(text.trim())) setText('');
    setBusy(false);
  }

  const repos = data ? [...data.repos, ...data.courses.flatMap(course => course.projects)] : [];
  const uncommitted = repos.filter(repo => repo.dirty).sort((a, b) => (b.dirty || 0) - (a.dirty || 0));
  const entry = data?.blueberry?.entries[0];
  // Until the projects reply arrives, each project section says so, or shows the error.
  const waiting = error ? <p className="today-note error-text" role="alert">{error}</p> : <p className="today-note"><Loader2 className="spin" size={15}/>Reading projects…</p>;

  return <>
    <div className="page-heading"><div><h1>Today</h1></div><div className="heading-actions"><button className="button primary" onClick={newDoc}><Plus size={16}/>Capture a thought</button></div></div>
    <div className="today-stack">
      <QuoteBoard/>
      <TodoCard workspace={workspace} commit={commit}/>
      <div><Kanban workspace={workspace} commit={commit} embedded/></div>
      <MonthCalendar/>
      <section className="panel">
        <div className="section-heading"><h2><Activity size={16}/>Activity</h2></div>
        <div className="today-heat"><HeatCalendar activity={workspace.activity}/></div>
      </section>
    </div>
    <div className="today-grid">
      <div className="today-column">
        <section className="panel">
          <div className="section-heading"><h2><GitBranch size={16}/>Uncommitted work</h2><a className="text-button" href="#projects">All projects<ArrowUpRight size={14}/></a></div>
          {!data ? waiting : uncommitted.length ? uncommitted.map(repo => <ProjectRow key={repo.path} repo={repo}/>) : <p className="today-note">Every repo is committed.</p>}
        </section>
        <section className="panel">
          <div className="section-heading"><h2><GraduationCap size={17}/>Courses</h2></div>
          {!data ? waiting : data.courses.length ? data.courses.map(course => <div className="today-course" key={course.name}><h3>{course.title || course.name}</h3>{course.projects.length ? course.projects.map(repo => <ProjectRow key={repo.path} repo={repo}/>) : <p className="today-note">No project folders in school/{course.name} yet.</p>}</div>) : <p className="today-note">No course folders in school/ yet.</p>}
        </section>
        <section className="panel today-status">
          <div className="section-heading"><h2><BookOpen size={16}/>Blueberry</h2><span className="muted">Newest in STATUS.md</span></div>
          {!data ? waiting : entry ? <div className="today-status-body"><h3>{entry.what}</h3><p className="today-note">{entry.date}</p><Markdown joinLines content={entry.body}/></div> : <p className="today-note">STATUS.md has no dated entries yet.</p>}
        </section>
      </div>
      <div className="today-column">
        <section className="panel capture-panel">
          <div className="section-heading"><h2><Pencil size={16}/>Quick capture</h2></div>
          <label className="sr-only" htmlFor="quick-capture">Your quick thought</label>
          <textarea id="quick-capture" ref={box} value={text} onChange={event => setText(event.target.value)} placeholder="An idea, a link, something to remember…" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save(); }}/>
          <div className="capture-footer"><span>Saved as a note <kbd>Ctrl ↵</kbd></span><button className="button small primary" disabled={!text.trim() || busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" size={14}/> : <Plus size={14}/>}Save note</button></div>
        </section>
        <section className="panel">
          <div className="section-heading"><h2><Pin size={16}/>Pinned</h2></div>
          {pinned.length ? <div className="pinned-list">{pinned.map(doc => <button className="pinned-item" key={doc.id} onClick={() => openDoc(doc)}><span className={`doc-symbol ${doc.kind}`}>{doc.kind === 'skill' ? <Zap size={20}/> : <BookOpen size={20}/>}</span><span><strong>{doc.name}</strong><small>{doc.tags[0] || doc.kind}</small></span><ArrowUpRight size={16}/></button>)}</div> : <p className="today-note">Pin a note from its preview (search with Ctrl K) to keep it here.</p>}
        </section>
        {/* A run row goes to #skills, not to the skill's pop-up: the Run button lives in the run column
            there, and focusRun puts focus on this skill's box when the column arrives (RunPanel.tsx). */}
        <section className="panel">
          <div className="section-heading"><h2><TerminalSquare size={16}/>Skill runs</h2><a className="text-button" href="#skills">All skills<ArrowUpRight size={14}/></a></div>
          {tasks === null ? <p className="today-note"><Loader2 className="spin" size={15}/>Reading runs…</p> : tasksError ? <p className="today-note error-text" role="alert">{tasksError}</p> : tasks.length ? tasks.map(task => <a className="today-run" key={task.id} href="#skills" onClick={() => focusRun(task.id)}>
            <strong>{task.label}</strong>
            <span className="today-run-state"><span className={`run-status ${task.missing ? 'failed' : task.run?.status || ''}`}>{task.run?.status === 'running' && <Loader2 size={13} className="spin"/>}{statusText(task)}</span>{task.run && <time className="muted" dateTime={task.run.started}>{when(task.run.started)}</time>}</span>
          </a>) : <p className="today-note">No skill on this computer has a Run button.</p>}
        </section>
      </div>
    </div>
    <section className="panel today-projects">
      <a className="today-run" href="#projects"><strong><FolderGit2 size={16}/>Projects</strong><span className="today-run-state"><span className="muted">{data ? `${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}` : error ? 'unavailable' : 'reading…'}</span><ArrowUpRight size={16}/></span></a>
    </section>
  </>;
}
