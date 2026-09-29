import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Kanban } from '../src/Kanban';
import { Projects } from '../src/Projects';
import { initialWorkspace, loadWorkspace, saveWorkspace, today } from '../src/lib/storage';
import { cancel, makeCurrent, pipelinesContext, restart, retry, skip } from '../src/lib/pipeline';
import { pipelineExamples } from '../src/lib/pipeline-examples';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Board, Card, ChecklistItem, Workspace } from '../src/types';

// The Pipeline view of a board project (PipelineView.tsx): the switch in the drawer and on Projects, the
// edit mode, the job and stage actions and what each one saves, and the sync with the server mirror.
// Every commit goes through saveWorkspace, so what is asserted is what is really stored.
function Host({ initial, page = 'board' }: { initial: Workspace; page?: 'board' | 'projects' }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
  return page === 'board' ? <Kanban workspace={workspace} commit={commit}/> : <Projects path="" data={{ repos: [], courses: [], blueberry: null }} error="" refresh={() => {}} workspace={workspace} commit={commit}/>;
}
const card = (id: string, title: string, column: string, extra: Partial<Card> = {}): Card => ({ id, title, notes: '', column, checklist: [], attachments: [], ...extra });
const withBoard = (cards: Card[], extra: Partial<Board> = {}): Workspace => { const w = initialWorkspace(); w.board = { ...w.board!, cards, ...extra }; return w; };
const stages = (): ChecklistItem[] => [
  { id: 's1', title: 'Outline', done: true, doneOn: '2026-09-20' },
  { id: 's2', title: 'Draft questions', done: false },
  { id: 's3', title: 'Review', done: false },
];
const project = (extra: Partial<Card> = {}) => withBoard([card('p', 'Blueberry', 'doing', { project: true, checklist: stages(), ...extra })]);
const saved = async () => (await loadWorkspace()).board!.cards.find(c => c.id === 'p')!;
const panel = () => screen.getByRole('dialog', { name: 'Blueberry' });
const stageItem = (title: string) => within(panel()).getByText(title, { selector: 'strong' }).closest('li') as HTMLElement;

// A stand-in for server/pipelines.mjs: it keeps one mirror in memory and records every call.
function mirror(initial: { stages: ChecklistItem[] } | null = null, now = '2026-09-28T12:00:00.000Z') {
  const state = { pipeline: initial, calls: [] as { method: string; url: string; body?: any }[] };
  const reply = (status: number, body: unknown) => ({ status, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, url, body });
    if (method === 'GET') return state.pipeline ? reply(200, { pipeline: state.pipeline, now }) : reply(404, { error: 'none', now });
    if (method === 'PUT') { state.pipeline = { stages: body.stages }; return reply(200, { pipeline: state.pipeline, now }); }
    if (method === 'DELETE') { state.pipeline = null; return reply(200, { ok: true }); }
    return reply(404, { error: 'no' });
  }));
  return state;
}

describe('the Pipeline view switch', () => {
  it('is off by default in the drawer; on, it shows the pipeline and saves card.pipeline; off again restores the stage timeline and unshares', async () => {
    const user = userEvent.setup();
    const server = mirror();
    render(<Host initial={project()}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    const toggle = within(panel()).getByRole('switch', { name: 'Pipeline view' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(panel()).getByRole('checkbox', { name: 'Draft questions' })).toBeInTheDocument();
    expect(server.calls).toEqual([]);
    await user.click(toggle);
    await waitFor(async () => expect((await saved()).pipeline).toEqual({ enabled: true, layout: 'vertical' }));
    expect(within(panel()).getByRole('switch', { name: 'Pipeline view' })).toHaveAttribute('aria-checked', 'true');
    expect(within(panel()).getByRole('heading', { name: 'Blueberry' })).toBeInTheDocument();
    expect(within(panel()).getByText('1 of 3 stages')).toBeInTheDocument();
    expect(within(stageItem('Outline')).getByText('Completed')).toBeInTheDocument();
    expect(stageItem('Draft questions')).toHaveAttribute('aria-current', 'step');
    expect(within(panel()).queryByRole('checkbox', { name: 'Draft questions' })).not.toBeInTheDocument();
    // Shared with Claude Code: a pull (nothing there yet), then a push of the stages.
    await waitFor(() => expect(server.calls.map(c => c.method + ' ' + c.url)).toEqual(['GET /api/pipelines/p', 'PUT /api/pipelines/p']));
    expect(server.calls[1].body).toMatchObject({ title: 'Blueberry', layout: 'vertical', stages: stages() });
    expect(await within(panel()).findByText('Claude Code can read and update this pipeline')).toBeInTheDocument();
    await user.click(within(panel()).getByRole('switch', { name: 'Pipeline view' }));
    await waitFor(async () => expect((await saved()).pipeline).toEqual({ enabled: false, layout: 'vertical' }));
    expect(within(panel()).getByRole('checkbox', { name: 'Draft questions' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/pipelines/p' }));
    expect((await saved()).checklist).toEqual(stages());
  });

  it('on Projects, each board project has its own switch, and a project with it on shows its pipeline there', async () => {
    const user = userEvent.setup();
    mirror();
    render(<Host page="projects" initial={withBoard([card('p', 'Blueberry', 'doing', { project: true, checklist: stages() }), card('q', 'Clean up', 'doing', { project: true })])}/>);
    expect(screen.getByRole('switch', { name: 'Pipeline view for Clean up' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('switch', { name: 'Pipeline view for Blueberry' }));
    await waitFor(async () => expect((await saved()).pipeline?.enabled).toBe(true));
    expect(screen.getByRole('switch', { name: 'Pipeline view for Blueberry' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Blueberry' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 stages')).toBeInTheDocument();
    expect((await loadWorkspace()).board!.cards.find(c => c.id === 'q')!.pipeline).toBeUndefined();
  });

  it('says when Claude Code cannot see the pipeline because the server is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();
    render(<Host initial={project({ pipeline: { enabled: true, layout: 'vertical' } })}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    expect(await within(panel()).findByText(/In this browser only/)).toBeInTheDocument();
  });
});

describe('editing a pipeline', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, extra: Partial<Card> = {}) => {
    mirror();
    render(<Host initial={project({ pipeline: { enabled: true, layout: 'vertical' }, ...extra })}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    const edit = within(panel()).getByRole('button', { name: 'Edit pipeline' });
    await user.click(edit);
    expect(edit).toHaveAttribute('aria-pressed', 'true');
  };
  const details = async (user: ReturnType<typeof userEvent.setup>, title: string) => { const toggle = within(stageItem(title)).getAllByRole('button')[0]; if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle); };

  it('adds, reorders, renames and deletes stages', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(within(panel()).getByLabelText('New pipeline stage'), 'Publish{Enter}');
    await waitFor(async () => expect((await saved()).checklist.map(s => s.title)).toEqual(['Outline', 'Draft questions', 'Review', 'Publish']));
    expect((await saved()).checklist[3]).toMatchObject({ done: false, status: 'pending' });
    await details(user, 'Publish');
    await user.click(within(panel()).getByRole('button', { name: 'Move Publish up' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => s.title)).toEqual(['Outline', 'Draft questions', 'Publish', 'Review']));
    const title = within(panel()).getByLabelText('Title of Publish');
    await user.clear(title); await user.type(title, 'Ship it{Enter}');
    await waitFor(async () => expect((await saved()).checklist[2].title).toBe('Ship it'));
    await user.click(within(panel()).getByRole('button', { name: 'Delete Ship it' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => s.title)).toEqual(['Outline', 'Draft questions', 'Review']));
  });

  it('sets status from the menu with done kept in step, and progress, notes, warning, error, output, log lines and skippable', async () => {
    const user = userEvent.setup();
    await open(user);
    await details(user, 'Draft questions');
    const draft = () => saved().then(c => c.checklist[1]);
    await user.selectOptions(within(panel()).getByLabelText('Status of Draft questions'), 'Completed');
    await waitFor(async () => expect(await draft()).toMatchObject({ status: 'completed', done: true, doneOn: today() }));
    await user.selectOptions(within(panel()).getByLabelText('Status of Draft questions'), 'Running');
    await waitFor(async () => expect(await draft()).toMatchObject({ status: 'active', done: false }));
    expect((await draft()).doneOn).toBeUndefined();
    expect((await draft()).startedAt).toBeTruthy();
    const percent = within(panel()).getByLabelText('Progress percent of Draft questions');
    await user.type(percent, '40'); fireEvent.blur(percent);
    await waitFor(async () => expect((await draft()).progress).toBe(40));
    expect(within(panel()).getByRole('progressbar', { name: 'Draft questions progress' })).toHaveAttribute('aria-valuenow', '40');
    fireEvent.change(within(panel()).getByLabelText('Progress of Draft questions'), { target: { value: '65' } });
    fireEvent.keyUp(within(panel()).getByLabelText('Progress of Draft questions'));
    await waitFor(async () => expect((await draft()).progress).toBe(65));
    await user.click(within(panel()).getByRole('button', { name: 'Clear' }));
    await waitFor(async () => expect('progress' in (await draft())).toBe(false));
    for (const [label, value] of [['Description', 'Sixty questions'], ['Warning', 'One source is paywalled'], ['Error', 'Lesson 4 has no key'], ['Output', '60 questions']]) {
      const field = within(panel()).getByLabelText(`${label} of Draft questions`);
      await user.type(field, value); fireEvent.blur(field);
    }
    await waitFor(async () => expect(await draft()).toMatchObject({ detail: 'Sixty questions', warning: 'One source is paywalled', error: 'Lesson 4 has no key', output: '60 questions' }));
    await user.type(within(panel()).getByLabelText('New log line for Draft questions'), 'Lesson 1 drafted{Enter}');
    await user.type(within(panel()).getByLabelText('New log line for Draft questions'), 'Lesson 2 drafted');
    await user.click(within(panel()).getByRole('button', { name: 'Append' }));
    await waitFor(async () => expect((await draft()).logs).toEqual(['Lesson 1 drafted', 'Lesson 2 drafted']));
    await user.click(within(panel()).getByLabelText('Can be skipped'));
    await waitFor(async () => expect((await draft()).skippable).toBe(true));
    const cleared = within(panel()).getByLabelText('Error of Draft questions');
    await user.clear(cleared); fireEvent.blur(cleared);
    await waitFor(async () => expect('error' in (await draft())).toBe(false));
  });

  it('Make current runs that stage and pauses the one that was running', async () => {
    const user = userEvent.setup();
    await open(user, { checklist: [{ id: 's1', title: 'Outline', done: false, status: 'active', progress: 30 }, { id: 's2', title: 'Draft questions', done: false }] });
    await details(user, 'Draft questions');
    await user.click(within(stageItem('Draft questions')).getByRole('button', { name: 'Make current' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => s.status)).toEqual(['paused', 'active']));
    expect((await saved()).checklist[0].progress).toBe(30);
    expect(stageItem('Draft questions')).toHaveAttribute('aria-current', 'step');
  });

  it('Retry, Skip, Cancel and Restart from the view save what they say', async () => {
    const user = userEvent.setup();
    mirror();
    render(<Host initial={project({ pipeline: { enabled: true, layout: 'vertical' }, checklist: [
      { id: 's1', title: 'Outline', done: false, status: 'failed', error: 'Timed out', startedAt: '2026-09-28T09:00:00.000Z', endedAt: '2026-09-28T09:05:00.000Z' },
      { id: 's2', title: 'Art', done: false, skippable: true },
      { id: 's3', title: 'Publish', done: false },
    ] })}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    await user.click(within(stageItem('Outline')).getAllByRole('button')[0]);
    await user.click(within(panel()).getByRole('button', { name: 'Retry Outline' }));
    await waitFor(async () => expect((await saved()).checklist[0]).toMatchObject({ status: 'active', done: false, attempt: 2 }));
    expect((await saved()).checklist[0].error).toBeUndefined();
    expect((await saved()).checklist[0].endedAt).toBeUndefined();
    await user.click(within(stageItem('Art')).getAllByRole('button')[0]);
    await user.click(within(panel()).getByRole('button', { name: 'Skip Art' }));
    await waitFor(async () => expect((await saved()).checklist[1]).toMatchObject({ status: 'skipped', done: true }));
    await user.click(within(panel()).getByRole('button', { name: 'Cancel' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => s.status)).toEqual(['cancelled', 'skipped', 'cancelled']));
    await user.click(within(panel()).getByRole('button', { name: 'Restart' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => [s.status, s.done])).toEqual([['pending', false], ['pending', false], ['pending', false]]));
  });
});

describe('the pipeline actions, as functions', () => {
  const run: ChecklistItem[] = [
    { id: 'a', title: 'A', done: true, status: 'completed', doneOn: '2026-09-27' },
    { id: 'b', title: 'B', done: false, status: 'failed', error: 'boom', attempt: 2, logs: ['x'] },
    { id: 'c', title: 'C', done: false, status: 'active', progress: 50, output: 'kept' },
    { id: 'd', title: 'D', done: false, status: 'queued' },
    { id: 'e', title: 'E', done: false },
  ];
  it('retry makes a failed stage a new running attempt; skip finishes a stage as skipped', () => {
    expect(retry(run, 'b')[1]).toMatchObject({ status: 'active', done: false, attempt: 3, logs: ['x'] });
    expect(retry(run, 'b')[1].error).toBeUndefined();
    expect(retry([{ id: 'z', title: 'Z', done: false, status: 'failed' }], 'z')[0].attempt).toBe(2);
    expect(skip(run, 'e')[4]).toMatchObject({ status: 'skipped', done: true, doneOn: today() });
  });
  it('cancel stops every unfinished stage and leaves finished and failed ones as they ended', () => {
    expect(cancel(run).map(s => s.status)).toEqual(['completed', 'failed', 'cancelled', 'cancelled', 'cancelled']);
    expect(cancel(run).every(s => s.done === (s.status === 'completed'))).toBe(true);
  });
  it('restart puts every stage back to pending, clears the run and keeps notes, output and logs', () => {
    const again = restart(run);
    expect(again.map(s => [s.status, s.done])).toEqual(run.map(() => ['pending', false]));
    expect(again.some(s => s.progress !== undefined || s.error !== undefined || s.attempt !== undefined || s.doneOn !== undefined)).toBe(false);
    expect([again[1].logs, again[2].output]).toEqual([['x'], 'kept']);
  });
  it('make current pauses the running stage rather than resetting it', () => {
    expect(makeCurrent(run, 'e').map(s => s.status)).toEqual(['completed', 'failed', 'paused', 'queued', 'active']);
    expect(makeCurrent(run, 'e')[2].progress).toBe(50);
  });
});

describe('syncing with Claude Code', () => {
  it('pulls a change Claude made (a newer stage and an added one) into the card and pushes the merged list back', async () => {
    const user = userEvent.setup();
    const server = mirror({ stages: [
      { id: 's2', title: 'Draft questions', done: false, status: 'active', progress: 40, logs: ['Lesson 1 drafted'], updatedAt: '2026-09-28T11:59:00.000Z' },
      { id: 's9', title: 'Pathway art', done: false, status: 'queued', updatedAt: '2026-09-28T11:58:00.000Z' },
    ] });
    render(<Host initial={project({ pipeline: { enabled: true, layout: 'vertical' } })}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    await waitFor(async () => expect((await saved()).checklist.map(s => [s.id, s.status ?? (s.done ? 'completed' : 'pending')])).toEqual([['s1', 'completed'], ['s2', 'active'], ['s3', 'pending'], ['s9', 'queued']]));
    expect((await saved()).checklist[1]).toMatchObject({ progress: 40, logs: ['Lesson 1 drafted'] });
    expect(within(panel()).getByRole('progressbar', { name: 'Draft questions progress' })).toHaveAttribute('aria-valuenow', '40');
    await waitFor(() => expect(server.calls.filter(c => c.method === 'PUT').at(-1)?.body.stages.map((s: ChecklistItem) => s.id)).toEqual(['s1', 's2', 's3', 's9']));
    expect(server.calls.find(c => c.method === 'PUT')!.body.seen).toBe('2026-09-28T12:00:00.000Z');
  });

  it('pulls again when the window regains focus', async () => {
    const user = userEvent.setup();
    const server = mirror();
    render(<Host initial={project({ pipeline: { enabled: true, layout: 'vertical' } })}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    await waitFor(() => expect(server.calls.filter(c => c.method === 'PUT')).toHaveLength(1));
    server.pipeline = { stages: [...stages().map(s => s.id === 's3' ? { ...s, status: 'failed' as const, error: 'No key', updatedAt: '2026-09-28T12:30:00.000Z' } : s)] };
    fireEvent.focus(window);
    await waitFor(async () => expect((await saved()).checklist[2]).toMatchObject({ status: 'failed', error: 'No key' }));
  });
});

describe('pipelines for the chat and the sample workspace', () => {
  it('pipelinesContext summarises only the projects with Pipeline view on, one line per stage', () => {
    const w = withBoard([...pipelineExamples(new Date('2026-09-28T12:00:00')), card('p', 'Quiet project', 'doing', { project: true, checklist: stages() })]);
    const text = pipelinesContext(w);
    expect(text).toContain('- Blueberry unit 3: carbonyl chemistry (Curriculum for one unit of the learning game): 2 of 6 stages done');
    expect(text).toContain('  3. Draft questions: active (40%)');
    expect(text).toContain('  3. Clear temp: failed (error: A file in the temp folder is locked by another process; 1.2 GB of 1.9 GB cleared.)');
    expect(text).toContain('  3. Fix: completed (attempt 2)');
    expect(text).not.toContain('Quiet project');
    expect(pipelinesContext(withBoard([]))).toBe('');
    expect(pipelinesContext(w, 200).length).toBeLessThanOrEqual(200);
  });

  it('the three example pipelines are valid workspace cards', () => {
    const w = initialWorkspace();
    w.board = { ...w.board!, cards: pipelineExamples() };
    expect(validateWorkspace(w)).toBe(w);
    expect(pipelineExamples().map(c => c.checklist.length)).toEqual([6, 4, 5]);
  });
});
