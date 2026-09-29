// A project's pipeline in the browser: the editing actions the Pipeline view calls, each a pure function
// from a stage list to a stage list, so they are tested without React and saved through the board's own
// patch path (Kanban.tsx boardPatch) like every other card change. The status rules themselves live in
// shared/pipeline.mjs, which the server mirror imports too; this file types them for the app.
import type { Card, ChecklistItem, StageStatus, Workspace } from '../types';
import type { TimelineStage } from '@/components/ui/processing-timeline';
import { uid } from './storage';
import * as rules from '../../shared/pipeline.mjs';

type Stages = ChecklistItem[];
export const STATUSES = rules.STATUSES as StageStatus[];
export const LIMITS = rules.LIMITS as { logLines: number; logLine: number; text: number; output: number; title: number; subtitle: number; attempt: number; stages: number };
export const statusOf = (item: ChecklistItem): StageStatus => rules.statusOf(item);
export const isDone = (status: StageStatus): boolean => rules.isDone(status);
export const withStatus = (item: ChecklistItem, status: StageStatus): ChecklistItem => rules.withStatus(item, status);
export const mergeStages = (mine: Stages, theirs: Stages, seen?: string): Stages => rules.mergeStages(mine, theirs, seen);
const touch = (item: ChecklistItem, fields: Partial<ChecklistItem>): ChecklistItem => rules.touch(item, fields);
const on = (stages: Stages, id: string, change: (item: ChecklistItem) => ChecklistItem) => stages.map(item => item.id === id ? change(item) : item);
// A stage never started is not "in flight"; a stage that has ended is not either.
const inFlight = (status: StageStatus) => status === 'pending' || status === 'queued' || status === 'active' || status === 'paused';

export const addStage = (stages: Stages, title: string): Stages => [...stages, touch({ id: uid(), title, done: false, status: 'pending' }, {})];
export const removeStage = (stages: Stages, id: string): Stages => stages.filter(item => item.id !== id);
export function moveStage(stages: Stages, id: string, by: -1 | 1): Stages {
  const list = [...stages], i = list.findIndex(item => item.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return stages;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}
export const setStatus = (stages: Stages, id: string, status: StageStatus): Stages => on(stages, id, item => withStatus(item, status));
// Text fields: an empty string clears the field rather than saving "", so a cleared error stops showing.
export function editStage(stages: Stages, id: string, fields: Partial<Pick<ChecklistItem, 'title' | 'detail' | 'error' | 'warning' | 'output' | 'skippable' | 'progress'>>): Stages {
  return on(stages, id, item => {
    const next = touch(item, fields);
    for (const key of ['detail', 'error', 'warning', 'output'] as const) if (key in fields && !fields[key]) delete next[key];
    if ('progress' in fields && fields.progress === undefined) delete next.progress;
    return next;
  });
}
export const appendLog = (stages: Stages, id: string, line: string): Stages => on(stages, id, item => rules.appendLogs(item, [line]));
// The one current stage: this one runs, and any other running stage is paused (not reset), so its
// progress is kept and it reads as waiting rather than lost.
export const makeCurrent = (stages: Stages, id: string): Stages => stages.map(item => item.id === id ? withStatus(item, 'active') : statusOf(item) === 'active' ? withStatus(item, 'paused') : item);
// Retry: a failed (or cancelled) stage runs again as a new attempt, its error cleared and its clock restarted.
export const retry = (stages: Stages, id: string): Stages => on(stages, id, item => {
  const { error: _error, endedAt: _ended, ...rest } = item;
  return { ...withStatus({ ...rest, startedAt: undefined }, 'active'), attempt: (item.attempt ?? 1) + 1 };
});
export const skip = (stages: Stages, id: string): Stages => setStatus(stages, id, 'skipped');
// Cancel the job: every stage that has not finished (pending, queued, running or paused) is cancelled.
// Finished and failed stages keep their result, which is what the history of the run should show.
export const cancel = (stages: Stages): Stages => stages.map(item => inFlight(statusOf(item)) ? withStatus(item, 'cancelled') : item);
// Restart: every stage back to pending, the run's own fields cleared (progress, times, attempt, error,
// warning). The notes, output and logs are kept, since they may be hand-written and a restart should not eat them.
export const restart = (stages: Stages): Stages => stages.map(item => {
  const { progress: _p, startedAt: _s, endedAt: _e, attempt: _a, error: _er, warning: _w, ...rest } = item;
  return withStatus(rest, 'pending');
});

// What ProcessingTimeline draws for one stage. Progress is passed through untouched: absent stays absent.
export const toTimelineStage = (item: ChecklistItem): TimelineStage => ({
  id: item.id, title: item.title, description: item.detail, status: statusOf(item), progress: item.progress,
  startedAt: item.startedAt, endedAt: item.endedAt, attempt: item.attempt, error: item.error, warning: item.warning,
  output: item.output, logs: item.logs, skippable: item.skippable,
});

// For the andliu.ai chat: a compact plain-text summary of every board project with its Pipeline view on,
// one line per stage, cut at `budget` characters so it never crowds out the conversation. Empty when
// there are none, so the caller can leave it out.
export function pipelinesContext(workspace: Workspace, budget = 4000): string {
  const cards: Card[] = (workspace.board?.cards ?? []).filter(card => card.project && card.pipeline?.enabled);
  if (!cards.length) return '';
  const lines = ['Project pipelines (from the Board; stage statuses as the owner or Claude Code last set them):'];
  for (const card of cards) {
    const done = card.checklist.filter(item => isDone(statusOf(item))).length;
    lines.push(`- ${card.title}${card.pipeline?.subtitle ? ` (${card.pipeline.subtitle})` : ''}: ${done} of ${card.checklist.length} stages done`);
    card.checklist.forEach((item, index) => {
      const status = statusOf(item);
      const extra = [typeof item.progress === 'number' && (status === 'active' || status === 'paused') ? `${item.progress}%` : '',
        item.attempt && item.attempt > 1 ? `attempt ${item.attempt}` : '', item.error ? `error: ${item.error.split('\n')[0]}` : '',
        item.warning ? `warning: ${item.warning.split('\n')[0]}` : ''].filter(Boolean).join(', ');
      lines.push(`  ${index + 1}. ${item.title}: ${status}${extra ? ` (${extra})` : ''}`);
    });
  }
  const text = lines.join('\n');
  return text.length > budget ? text.slice(0, budget - 1) + '…' : text;
}
