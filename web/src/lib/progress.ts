// The numbers behind Today's widgets (TodayWidgets.tsx), kept out of the component so each chart can be
// tested from a fixture workspace without a DOM, the way lib/todos.ts is. Every function reads the
// workspace as saved; nothing here writes. Days are local days as YYYY-MM-DD, the key todos.history uses.
import type { Board, MiscItem, Todos, Workspace } from '../types';
import { today } from './storage';

const DAY = 24 * 60 * 60 * 1000;
export const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// Noon, so adding whole days never lands on the wrong date across a daylight saving change.
const noon = (key: string) => new Date(`${key}T12:00:00`);
export const addDays = (key: string, n: number) => dayKey(new Date(noon(key).getTime() + n * DAY));

// The last `count` days ending on `end`, oldest first.
export function lastDays(count: number, end = today()): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

// Todos finished on each day. history holds earlier days' finished todos (kept forever); the live
// list's ticked items belong to todos.day, which is today once TodoCard has rolled the list over.
export function doneByDay(todos: Todos | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  if (!todos) return counts;
  for (const [day, items] of Object.entries(todos.history)) counts.set(day, (counts.get(day) ?? 0) + items.length);
  const live = todos.items.filter(t => t.done).length;
  if (live) counts.set(todos.day, (counts.get(todos.day) ?? 0) + live);
  return counts;
}

export type DayBar = { day: string; count: number };
// One bar per day for the chart, plus the same-length period before it for the change line.
export function todoSeries(todos: Todos | undefined, days: number, end = today()) {
  const counts = doneByDay(todos);
  const bars: DayBar[] = lastDays(days, end).map(day => ({ day, count: counts.get(day) ?? 0 }));
  const previous = lastDays(days, addDays(end, -days)).reduce((sum, day) => sum + (counts.get(day) ?? 0), 0);
  return { bars, total: bars.reduce((sum, b) => sum + b.count, 0), previous, ever: [...counts.values()].reduce((a, b) => a + b, 0) };
}

// Consecutive days, ending today, with at least one todo finished. history keeps only finished todos
// and carries unfinished ones forward, so "every todo done" on a past day cannot be known from what
// is saved; "at least one done" can. Today with nothing done yet does not break the streak, since
// the day is still open: the count then runs back from yesterday.
export function todoStreak(todos: Todos | undefined, end = today()): number {
  const counts = doneByDay(todos);
  let day = (counts.get(end) ?? 0) > 0 ? end : addDays(end, -1);
  let streak = 0;
  while ((counts.get(day) ?? 0) > 0) { streak++; day = addDays(day, -1); }
  return streak;
}
// The streak as it stood at the end of the previous day, for "up or down since yesterday".
export const streakYesterday = (todos: Todos | undefined, end = today()) => todoStreak(todos, addDays(end, -1));

// Monday of the week holding `key`.
export function weekStart(key: string): string {
  const d = noon(key);
  return addDays(key, -((d.getDay() + 6) % 7));
}

// Stages (checklist items) ticked per week, from their doneOn day, the last `weeks` weeks oldest first.
// Items ticked before doneOn existed have no day and are left out, which the widget says.
export function stagesPerWeek(board: Board | undefined, weeks: number, end = today()) {
  const current = weekStart(end);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(current, (i - weeks + 1) * 7));
  const counts = new Map(starts.map(s => [s, 0]));
  let undated = 0;
  for (const card of board?.cards ?? []) for (const item of card.checklist) {
    if (!item.done) continue;
    if (!item.doneOn) { undated++; continue; }
    const week = weekStart(item.doneOn);
    if (counts.has(week)) counts.set(week, counts.get(week)! + 1);
  }
  const bars = starts.map(start => ({ week: start, count: counts.get(start)! }));
  return { bars, thisWeek: bars[bars.length - 1]?.count ?? 0, lastWeek: bars[bars.length - 2]?.count ?? 0, undated };
}

// Cards per column in the board's own column order. Cards carry no date they were finished, so the
// board can only be a snapshot; the last column is read as the finished one, as To do, Doing, Done has it.
export function boardSnapshot(board: Board | undefined) {
  const columns = (board?.columns ?? []).map(column => ({ id: column.id, name: column.name, count: (board?.cards ?? []).filter(c => c.column === column.id).length }));
  const total = columns.reduce((sum, c) => sum + c.count, 0);
  return { columns, total, finished: columns[columns.length - 1]?.count ?? 0 };
}

// Project cards (card.project) with their stage progress.
export function projectProgress(board: Board | undefined) {
  return (board?.cards ?? []).filter(c => c.project).map(card => ({ id: card.id, title: card.title, done: card.checklist.filter(i => i.done).length, total: card.checklist.length }));
}

// Active goals with their milestones. Milestones carry no date, so this too is a snapshot.
export function goalProgress(goals: Workspace['goals']) {
  const active = goals.filter(g => !g.archived).map(g => ({ id: g.id, title: g.title, done: g.milestones.filter(m => m.done).length, total: g.milestones.length }));
  const done = active.reduce((sum, g) => sum + g.done, 0);
  const total = active.reduce((sum, g) => sum + g.total, 0);
  return { goals: active, done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

// How many timestamped entries fall in the 7 days ending `end` and in the 7 before. Used for the
// activity log and for brainstorm lines, both of which carry an ISO `created`.
export function weekCounts(entries: { created: string }[], end = today()) {
  const thisStart = addDays(end, -6), lastStart = addDays(end, -13);
  let thisWeek = 0, lastWeek = 0;
  for (const entry of entries) {
    const key = dayKey(new Date(entry.created));
    if (key > end) continue;
    if (key >= thisStart) thisWeek++; else if (key >= lastStart) lastWeek++;
  }
  return { thisWeek, lastWeek };
}

export function miscByKind(misc: MiscItem[] | undefined) {
  const kinds = [{ kind: 'idea' as const, label: 'Ideas' }, { kind: 'task' as const, label: 'Tasks' }, { kind: 'note' as const, label: 'Notes' }];
  return kinds.map(k => ({ ...k, count: (misc ?? []).filter(m => m.kind === k.kind).length }));
}

// A change said in words, with an arrow that repeats it for the eye: never colour alone.
export type Trend = { dir: 'up' | 'down' | 'flat'; text: string };
export function trend(current: number, previous: number, period: string): Trend {
  if (current > previous) return { dir: 'up', text: `Up ${current - previous} from ${period}` };
  if (current < previous) return { dir: 'down', text: `Down ${previous - current} from ${period}` };
  return { dir: 'flat', text: `Same as ${period}` };
}
