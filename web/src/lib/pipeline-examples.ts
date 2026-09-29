// Three example pipelines, for tests and for the sample workspace (lib/sample-workspace.ts can put them on
// its board). Nothing here is ever written into a real workspace by this app. Each is a board card promoted
// to a project with Pipeline view on, its stages mid-run so every part of the view has something to show:
//   blueberryUnit: a Blueberry unit's curriculum, from outline to publish (a person's own project)
//   cleanUpRun: the clean-up skill's run, one stage per step, stopped on a failure (a routine's run)
//   buildCritiqueLoop: a Claude Code build and critique loop reporting its own progress through
//     scripts/pipeline.mjs (a long agent task)
// Times are counted back from `now`, so the sample looks recent whenever it is loaded.
import type { Card, ChecklistItem } from '../types';

type Stage = Omit<ChecklistItem, 'done' | 'startedAt' | 'endedAt' | 'updatedAt' | 'doneOn'> & { status: NonNullable<ChecklistItem['status']>; ran?: [number, number?] };
const FINISHED = ['completed', 'warning', 'skipped'];
const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// ran: minutes ago the stage started and, if it ended, ended.
function build(now: Date, id: string, title: string, column: string, subtitle: string, notes: string, stages: Stage[], layout: 'vertical' | 'horizontal' = 'vertical'): Card {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000);
  const checklist = stages.map(({ ran, ...stage }): ChecklistItem => {
    const done = FINISHED.includes(stage.status), ended = ran?.[1] === undefined ? undefined : ago(ran[1]);
    return { ...stage, done, ...(ran ? { startedAt: ago(ran[0]).toISOString() } : {}), ...(ended ? { endedAt: ended.toISOString() } : {}), ...(done && ended ? { doneOn: day(ended) } : {}), updatedAt: (ended ?? (ran ? ago(ran[0]) : ago(600))).toISOString() };
  });
  return { id, title, notes, column, category: 'project', checklist, attachments: [], project: true, pipeline: { enabled: true, layout, subtitle } };
}

export const blueberryUnit = (now = new Date(), column = 'doing') => build(now, 'example-blueberry-unit', 'Blueberry unit 3: carbonyl chemistry', column,
  'Curriculum for one unit of the learning game', 'One unit from outline to live in the game.', [
    { id: 'bu-outline', title: 'Outline', status: 'completed', detail: 'Eight lessons, aldehydes and ketones first, then nucleophilic addition.', ran: [7200, 6900] },
    { id: 'bu-sources', title: 'Question sources', status: 'warning', warning: 'Two of the five textbooks are not open access; the questions cite the other three.', ran: [6800, 5000] },
    { id: 'bu-draft', title: 'Draft questions', status: 'active', progress: 40, detail: '60 questions, 8 per lesson.', logs: ['Lesson 1: 8 of 8 drafted', 'Lesson 2: 8 of 8 drafted', 'Lesson 3: 8 of 8 drafted'], ran: [2880] },
    { id: 'bu-review', title: 'Review', status: 'pending', detail: 'Check every mechanism arrow against the answer key.' },
    { id: 'bu-art', title: 'Pathway art', status: 'pending', skippable: true, detail: 'Optional this round: the unit can ship with the default map.' },
    { id: 'bu-publish', title: 'Publish', status: 'pending' },
  ]);

export const cleanUpRun = (now = new Date(), column = 'doing') => build(now, 'example-clean-up', 'Clean up', column,
  'The clean-up skill, one stage per step', 'The 7am run of the clean-up skill.', [
    { id: 'cu-scan', title: 'Scan processes', status: 'completed', output: '214 processes; 3 stray: 2 headless browsers, 1 orphaned test worker.', ran: [14, 13] },
    { id: 'cu-kill', title: 'Kill stragglers', status: 'completed', logs: ['stopped headless browser (pid 4412)', 'stopped headless browser (pid 5120)', 'stopped test worker (pid 6034)'], ran: [13, 12] },
    { id: 'cu-temp', title: 'Clear temp', status: 'failed', error: 'A file in the temp folder is locked by another process; 1.2 GB of 1.9 GB cleared.', skippable: true, ran: [12, 11] },
    { id: 'cu-report', title: 'Report', status: 'pending' },
  ], 'horizontal');

export const buildCritiqueLoop = (now = new Date(), column = 'doing') => build(now, 'example-build-loop', 'Pipeline view: build and critique', column,
  'A Claude Code task reporting into its project', 'Claude runs node scripts/pipeline.mjs at each step, so the board shows where a long task is.', [
    { id: 'bl-build', title: 'Build', status: 'completed', output: 'processing-timeline.tsx, PipelineView.tsx, server/pipelines.mjs', ran: [95, 60] },
    { id: 'bl-critic', title: 'Critic', status: 'warning', warning: '3 findings, 1 blocking: the live region announced progress ticks.', ran: [60, 48] },
    { id: 'bl-fix', title: 'Fix', status: 'completed', attempt: 2, logs: ['attempt 1: announcements still fired on progress', 'attempt 2: announce status changes only'], ran: [48, 30] },
    { id: 'bl-verify', title: 'Verify', status: 'active', progress: 70, logs: ['tsc: clean', 'vitest: 612 of 874 passed so far'], ran: [30] },
    { id: 'bl-commit', title: 'Commit', status: 'pending', detail: 'Only after Andrew reads the diff.' },
  ]);

export const pipelineExamples = (now = new Date(), column = 'doing'): Card[] => [blueberryUnit(now, column), cleanUpRun(now, column), buildCritiqueLoop(now, column)];
