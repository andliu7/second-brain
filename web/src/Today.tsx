// Today (#agenda): the day on one screen. The heading carries the title, the quote board as a small
// box, and a pencil for a new note (NoteComposer.tsx, a small box whose first line is the title). First and
// full width, the "Calendar and activity" card (MiniCalendar: the month shaded by activity, the heat
// calendar and a day's detail, always all three; its "Open calendar" and every day go to #calendar, the
// full month). Andrew, 2026-09-29: the activity card takes the most space and the todos sit under it. So
// below it two columns: today's todos on the left, the wider one (the top three, Show more for the rest;
// the mini kanban left on 2026-09-28: the board is Kanban's alone), and quick capture on the right.
// Then the progress widgets across the full width (TodayWidgets.tsx, draggable once Edit layout is on;
// Andrew, 2026-09-28: "make the progress boxes span the horizontal space"). Last, the Projects row, the
// only way to #projects since it left the nav. Gone on
// 2026-09-28 at Andrew's word: uncommitted work, courses, Blueberry's status, pinned files and skill
// runs ("I don't see their use"); Projects and Skills carry them. No hero, no slogan, no stat cards
// and no parallax (his decision of 2026-09-14).
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, FolderGit2, Loader2, Pencil, Plus } from 'lucide-react';
import type { Doc, Workspace } from './types';
import { type ProjectsData } from './Projects';
import { QuoteBoard } from './QuoteBoard';
import { TodoCard } from './TodoCard';
import { MiniCalendar } from './MonthCalendar';
import { TodayWidgets } from './TodayWidgets';
import { NoteComposer } from './NoteComposer';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Props = { data: ProjectsData | null; error: string; workspace: Workspace; commit: Commit; openDoc: (doc: Doc) => void; capture: (text: string) => Promise<boolean> };

export function Today({ data, error, workspace, commit, capture }: Props) {
  const [text, setText] = useState('');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // A cold open lands with the caret in quick capture, so a thought is typed then Ctrl+Enter. Only
  // when nothing else has focus, so it never takes focus from a control the user just used, and
  // without scrolling, so the page still starts at the top.
  useLayoutEffect(() => { if (document.activeElement === document.body) box.current?.focus({ preventScroll: true }); }, []);
  // commit() in App.tsx reports a failed save itself and resolves false, so the text is kept.
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await capture(text.trim())) setText('');
    setBusy(false);
  }
  const repos = data ? [...data.repos, ...data.courses.flatMap(course => course.projects)] : [];
  return <>
    <div className="page-heading today-heading">
      <div><h1>Today</h1></div>
      <QuoteBoard rows={2} cols={36} byline className="today-quote"/>
      <div className="heading-actions"><button className="button primary icon-only" aria-label="New note" title="New note" aria-haspopup="dialog" onClick={() => setComposing(true)}><Pencil size={17}/></button></div>
    </div>
    {composing && <NoteComposer save={capture} close={() => setComposing(false)}/>}
    <MiniCalendar todos={workspace.todos} activity={workspace.activity}/>
    <div className="today-layout">
      <div className="today-main"><TodoCard workspace={workspace} commit={commit}/></div>
      <aside className="today-side">
        <section className="panel capture-panel">
          <div className="section-heading"><h2>Quick capture</h2></div>
          <label className="sr-only" htmlFor="quick-capture">Your quick thought</label>
          <textarea id="quick-capture" ref={box} value={text} onChange={event => setText(event.target.value)} placeholder="An idea, a link, something to remember…" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save(); }}/>
          <div className="capture-footer"><span>Saved as a note <kbd>Ctrl ↵</kbd></span><button className="button small primary" disabled={!text.trim() || busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" size={14}/> : <Plus size={14}/>}Save note</button></div>
        </section>
      </aside>
    </div>
    <TodayWidgets workspace={workspace} commit={commit}/>
    <section className="panel today-projects">
      <a className="today-run" href="#projects"><strong><FolderGit2 size={16}/>Projects</strong><span className="today-run-state"><span className="muted">{data ? `${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}` : error ? 'unavailable' : 'reading…'}</span><ArrowUpRight size={16}/></span></a>
    </section>
  </>;
}
