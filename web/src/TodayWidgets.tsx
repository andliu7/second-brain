// Today's progress dashboard: widgets over the workspace's own records, in a WidgetGrid the user can
// rearrange and resize (Edit layout). Every number comes from lib/progress.ts; nothing is sampled or
// invented, and a widget with nothing to show says so and says what will fill it. Each widget is a title,
// one big number, a change against the period before said in words with an arrow (never colour alone),
// and a chart with a text alternative. Where the records carry no dates (board cards, goal milestones)
// the widget is a snapshot and its change line says why there is nothing to compare.
//
// No focus-time widget: useFocusTimer keeps only the running session's minutes in localStorage and a
// reset clears them, so there is no per-day record to chart.
//
// The order and sizes persist as workspace.todayLayout, so they travel with backups. Widgets added in
// later versions are appended to a saved layout, and ids the code no longer knows are dropped: that is how
// a layout saved with the Activity widget still loads, since the heat map moved into Today's "Calendar
// and activity" card (MiniCalendar in MonthCalendar.tsx) on 2026-09-28.
//
// The grid spans the page's full width (Andrew: "make the progress boxes span the horizontal space"), so
// it may use up to MAX_COLUMNS columns; WidgetGrid fits as many cells of at least MIN_CELL px as the
// width allows and sizes them to fill it.
import { useState, type ReactNode } from 'react';
import { Activity, CalendarCheck, CheckCircle2, Columns3, Flag, FolderGit2, Lightbulb, Target, type LucideIcon } from 'lucide-react';
import type { Workspace } from './types';
import type { Commit } from './Kanban';
import { WidgetGrid, type GridItem, type WidgetSize } from '@/components/ui/widget-grid';
import { boardSnapshot, goalProgress, miscByKind, projectProgress, stagesPerWeek, streakYesterday, todoSeries, todoStreak, trend, weekCounts, lastDays, doneByDay, type Trend } from './lib/progress';
import './today-widgets.css';

type WidgetId = 'todos' | 'streak' | 'stages' | 'projects' | 'board' | 'goals' | 'misc';
const TITLES: Record<WidgetId, string> = { todos: 'Todos done', streak: 'Streak', stages: 'Stages finished', projects: 'Projects', board: 'Board progress', goals: 'Goals', misc: 'Brainstorm' };
export const DEFAULT_LAYOUT: GridItem[] = [
  { id: 'todos', size: 'wide' }, { id: 'streak', size: 'sm' }, { id: 'stages', size: 'sm' },
  { id: 'projects', size: 'tall' }, { id: 'board', size: 'wide' }, { id: 'goals', size: 'sm' },
  { id: 'misc', size: 'sm' },
];
const MAX_COLUMNS = 8;
const MIN_CELL = 180;
// The small muted mark an empty widget shows above its line, so a blank card reads as meant.
const ICONS: Record<WidgetId, LucideIcon> = { todos: CheckCircle2, streak: CalendarCheck, stages: Flag, projects: FolderGit2, board: Columns3, goals: Target, misc: Lightbulb };
const known = (id: string): id is WidgetId => id in TITLES;

export function normalizeLayout(saved: Workspace['todayLayout']): GridItem[] {
  if (!saved) return DEFAULT_LAYOUT;
  const kept = saved.filter(item => known(item.id));
  return [...kept, ...DEFAULT_LAYOUT.filter(d => !kept.some(k => k.id === d.id))];
}

export function TodayWidgets({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const [editing, setEditing] = useState(false);
  const layout = normalizeLayout(workspace.todayLayout);
  const save = (items: GridItem[]) => void commit(w => ({ ...w, todayLayout: items.map(({ id, size }) => ({ id, size })) }));
  return <section className="tw" aria-labelledby="tw-heading">
    <div className="tw-head">
      <h2 id="tw-heading">Progress</h2>
      <button type="button" className="button small" aria-pressed={editing} onClick={() => setEditing(e => !e)}>Edit layout</button>
    </div>
    <WidgetGrid items={layout} editing={editing} onChange={save} ariaLabel="Progress widgets" maxColumns={MAX_COLUMNS} minCell={MIN_CELL} label={id => TITLES[id as WidgetId] ?? id}
      render={item => <Widget id={item.id as WidgetId} size={item.size} workspace={workspace}/>}/>
  </section>;
}

// The frame every widget shares. An empty line, when given, replaces everything below the title and
// sits centred under the widget's icon; with emptyHref the line is a link to the page it names.
function Card({ title, big, caption, change, empty, emptyHref, icon: Icon = Activity, children }: { title: string; big?: ReactNode; caption?: string; change?: Trend | { dir: 'none'; text: string }; empty?: string; emptyHref?: string; icon?: LucideIcon; children?: ReactNode }) {
  return <article className="tw-card" data-empty={empty ? true : undefined}>
    <h3 className="tw-title">{title}</h3>
    {empty ? <div className="tw-empty"><Icon size={18} aria-hidden="true"/><p>{emptyHref ? <a href={emptyHref}>{empty}</a> : empty}</p></div> : <>
      <p className="tw-big"><span className="tw-num">{big}</span>{caption && <span className="tw-caption"> {caption}</span>}</p>
      {change && <p className="tw-change" data-dir={change.dir}><span aria-hidden="true">{ARROWS[change.dir]}</span> {change.text}</p>}
      <div className="tw-chart">{children}</div>
    </>}
  </article>;
}
const ARROWS = { up: '↑', down: '↓', flat: '→', none: '·' };

// Vertical bars scaled to the tallest; the SVG stretches to the widget, the label says it in words.
function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return <svg className="tw-bars" role="img" aria-label={label} viewBox={`0 0 ${values.length} 100`} preserveAspectRatio="none">
    {values.map((v, i) => <rect key={i} x={i + 0.15} width={0.7} y={100 - v / max * 100} height={v / max * 100} data-value={v}/>)}
  </svg>;
}
// A labelled progress row: the words are visible, and the track repeats them for assistive technology.
function Meter({ name, done, total, unit }: { name: string; done: number; total: number; unit: string }) {
  const pct = total ? Math.round(done / total * 100) : 0;
  return <li className="tw-meter">
    <span className="tw-meter-name">{name}</span><span className="tw-meter-count">{done}/{total}</span>
    <span className="tw-track" role="img" aria-label={`${name}: ${done} of ${total} ${unit}`}><span style={{ width: `${pct}%` }}/></span>
  </li>;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const wideish = (size: WidgetSize) => size === 'wide' || size === 'lg';

function Widget({ id, size, workspace }: { id: WidgetId; size: WidgetSize; workspace: Workspace }) {
  const title = TITLES[id];
  if (id === 'todos') {
    const days = wideish(size) ? 30 : 14;
    const s = todoSeries(workspace.todos, days);
    if (!s.ever) return <Card title={title} icon={ICONS[id]} empty="No todos finished yet; the chart starts with your first."/>;
    return <Card title={title} big={s.total} caption={`in ${days} days`} change={trend(s.total, s.previous, `the ${days} days before`)}>
      <Bars values={s.bars.map(b => b.count)} label={`Todos finished per day, ${s.bars[0].day} to ${s.bars[s.bars.length - 1].day}: ${s.bars.map(b => b.count).join(', ')}`}/>
    </Card>;
  }
  if (id === 'streak') {
    const streak = todoStreak(workspace.todos);
    const counts = doneByDay(workspace.todos);
    if (!counts.size) return <Card title={title} icon={ICONS[id]} empty="No streak yet; it starts the first day you finish a todo."/>;
    const days = lastDays(14);
    const hit = days.filter(d => (counts.get(d) ?? 0) > 0).length;
    return <Card title={title} big={streak} caption={streak === 1 ? 'day' : 'days'} change={trend(streak, streakYesterday(workspace.todos), 'yesterday')}>
      <div className="tw-dots" role="img" aria-label={`Days with at least one todo done in the last 14: ${hit}`}>
        {days.map(d => <span key={d} data-on={(counts.get(d) ?? 0) > 0 || undefined} title={d}/>)}
      </div>
    </Card>;
  }
  if (id === 'stages') {
    const weeks = wideish(size) ? 12 : 8;
    const s = stagesPerWeek(workspace.board, weeks);
    const any = s.bars.some(b => b.count) || s.undated;
    if (!any) return <Card title={title} icon={ICONS[id]} empty="No stages ticked yet; the chart starts with your first."/>;
    return <Card title={title} big={s.thisWeek} caption="this week" change={trend(s.thisWeek, s.lastWeek, 'last week')}>
      <Bars values={s.bars.map(b => b.count)} label={`Stages ticked per week, the last ${weeks} weeks, oldest first: ${s.bars.map(b => b.count).join(', ')}`}/>
      {s.undated > 0 && <p className="tw-note">{plural(s.undated, 'stage')} ticked before days were kept, not charted.</p>}
    </Card>;
  }
  if (id === 'projects') {
    const projects = projectProgress(workspace.board);
    if (!projects.length) return <Card title={title} icon={ICONS[id]} empty="No projects yet; make a card a project on Kanban and its stages show here." emptyHref="#board"/>;
    const ids = new Set(projects.map(p => p.id));
    const s = stagesPerWeek({ columns: [], view: 'board', cards: (workspace.board?.cards ?? []).filter(c => ids.has(c.id)) }, 2);
    return <Card title={title} big={projects.length} caption={projects.length === 1 ? 'project' : 'projects'} change={{ ...trend(s.thisWeek, s.lastWeek, 'last week'), text: `${plural(s.thisWeek, 'stage')} this week; ${trend(s.thisWeek, s.lastWeek, 'last week').text.toLowerCase()}` }}>
      <ul className="tw-meters">{projects.map(p => <Meter key={p.id} name={p.title} done={p.done} total={p.total} unit="stages"/>)}</ul>
    </Card>;
  }
  if (id === 'board') {
    const b = boardSnapshot(workspace.board);
    if (!b.total) return <Card title={title} icon={ICONS[id]} empty="No cards on the board yet; add one on Kanban and it shows here." emptyHref="#board"/>;
    const last = b.columns[b.columns.length - 1];
    return <Card title={title} big={b.finished} caption={`of ${b.total} in ${last.name}`} change={{ dir: 'none', text: 'Cards carry no finish date, so there is no weekly change' }}>
      <ul className="tw-meters">{b.columns.map(c => <Meter key={c.id} name={c.name} done={c.count} total={b.total} unit="cards"/>)}</ul>
    </Card>;
  }
  if (id === 'goals') {
    const g = goalProgress(workspace.goals);
    if (!g.goals.length) return <Card title={title} icon={ICONS[id]} empty="No active goals yet; add one on Kanban, below the board, and its milestones show here." emptyHref="#board"/>;
    return <Card title={title} big={`${g.percent}%`} caption={`${g.done} of ${g.total} milestones`} change={{ dir: 'none', text: 'Milestones carry no dates, so there is nothing to compare' }}>
      <ul className="tw-meters">{g.goals.map(goal => <Meter key={goal.id} name={goal.title} done={goal.done} total={goal.total} unit="milestones"/>)}</ul>
    </Card>;
  }
  // misc
  const misc = workspace.misc ?? [];
  if (!misc.length) return <Card title={title} icon={ICONS[id]} empty="No brainstorm lines yet; add one and they are counted here."/>;
  const w = weekCounts(misc);
  const kinds = miscByKind(misc);
  return <Card title={title} big={misc.length} caption={misc.length === 1 ? 'line' : 'lines'} change={{ ...trend(w.thisWeek, w.lastWeek, 'last week'), text: `${w.thisWeek} added this week; ${trend(w.thisWeek, w.lastWeek, 'last week').text.toLowerCase()}` }}>
    <ul className="tw-meters">{kinds.map(k => <Meter key={k.kind} name={k.label} done={k.count} total={misc.length} unit="lines"/>)}</ul>
  </Card>;
}
