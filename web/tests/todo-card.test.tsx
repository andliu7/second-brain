import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TodoCard } from '../src/TodoCard';
import { rollover, removeTodo, todoPayload, TODO_DRAG_TYPE } from '../src/lib/todos';
import { initialWorkspace, today } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Todo, Todos, Workspace } from '../src/types';

const todo = (text: string, done = false, extra: Partial<Todo> = {}): Todo => ({ id: 'todo-' + text.toLowerCase().replace(/\W+/g, '-'), text, done, category: 'academic', ...extra });
const stored = (day: string, items: Todo[], extra: Partial<Todos> = {}): Todos => ({ day, items, history: {}, removedDefaults: ['read', 'write'], ...extra });

// A stand-in for App: holds the workspace and applies commit() the way App does.
function Harness({ initial, onCommit }: { initial: Workspace; onCommit?: (w: Workspace) => void }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); onCommit?.(next); return next; }); return true; };
  return <TodoCard workspace={workspace} commit={commit}/>;
}

describe('the daily todo card', () => {
  it('rolls a stale day over: done todos go to history, unfinished ones carry forward, 30 days are kept', () => {
    const history = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, [todo('old ' + i, true)]]));
    const before = stored('2026-09-20', [todo('Finish lab report', true), todo('Email advisor')], { history });
    const after = rollover(before, '2026-09-24');
    expect(after.day).toBe('2026-09-24');
    expect(after.items.map(t => t.text)).toEqual(['Email advisor']);
    expect(after.history['2026-09-20'].map(t => t.text)).toEqual(['Finish lab report']);
    expect(Object.keys(after.history)).toHaveLength(30);
    expect(after.history['2026-07-01']).toBeUndefined();
    expect(after.history['2026-07-31']).toBeDefined();
    // The same day is the same object: nothing to save.
    expect(rollover(after, '2026-09-24')).toBe(after);
    expect(before.history['2026-07-01']).toBeDefined();
  });

  it('brings the two defaults back each day, except the ones deleted for good', () => {
    const fresh = rollover(undefined, '2026-09-24');
    expect(fresh.items.map(t => [t.text, t.minutes, t.defaultKey])).toEqual([['Read for 15 minutes', 15, 'read'], ['Write for 15 minutes', 15, 'write']]);
    const withoutRead = removeTodo(fresh, fresh.items[0].id);
    expect(withoutRead.removedDefaults).toEqual(['read']);
    const next = rollover({ ...withoutRead, items: withoutRead.items.map(t => ({ ...t, done: true })) }, '2026-09-25');
    expect(next.items.map(t => t.defaultKey)).toEqual(['write']);
    expect(next.history['2026-09-24'].map(t => t.defaultKey)).toEqual(['write']);
  });

  it('a workspace saved before todos existed loads with the two defaults for today, and saves them', async () => {
    const { todos: _todos, ...legacy } = initialWorkspace();
    const commits: Workspace[] = [];
    render(<Harness initial={legacy as Workspace} onCommit={w => commits.push(w)}/>);
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Write for 15 minutes' })).not.toBeChecked();
    await waitFor(() => expect(commits.length).toBeGreaterThan(0));
    expect(commits[0].todos?.day).toBe(today());
    expect(commits[0].todos?.items.map(t => t.defaultKey)).toEqual(['read', 'write']);
    expect(commits.length).toBe(1);
  });

  it('exposes a todo as a copy drag payload with the documented shape', () => {
    const item = todo('Read chapter 4', false, { minutes: 25, goal: 'Exam prep' });
    expect(todoPayload(item)).toEqual({ type: 'todo', id: item.id, text: 'Read chapter 4', category: 'academic', minutes: 25, goal: 'Exam prep' });
    expect(todoPayload(todo('Bare'))).toEqual({ type: 'todo', id: 'todo-bare', text: 'Bare', category: 'academic', minutes: null, goal: null });
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [item]) }}/>);
    const row = screen.getByRole('checkbox', { name: 'Read chapter 4' }).closest('li') as HTMLElement;
    expect(row).toHaveAttribute('draggable', 'true');
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (type: string, value: string) => { data[type] = value; }, effectAllowed: '' };
    fireEvent.dragStart(row, { dataTransfer });
    expect(TODO_DRAG_TYPE).toBe('application/x-brain-todo');
    expect(JSON.parse(data[TODO_DRAG_TYPE])).toEqual(todoPayload(item));
    expect(dataTransfer.effectAllowed).toBe('copy');
    // A drag is a copy: the todo is still here.
    expect(screen.getByRole('checkbox', { name: 'Read chapter 4' })).toBeInTheDocument();
  });

  it('turns the header green when everything is done, with confetti only when motion is allowed', async () => {
    const user = userEvent.setup();
    // tests/setup.ts stubs matchMedia to match every query, so reduced motion is on by default.
    const { unmount } = render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Only one')]) }}/>);
    await user.click(screen.getByRole('checkbox', { name: 'Only one' }));
    expect(screen.getByRole('checkbox', { name: 'Only one' })).toBeChecked();
    expect(document.querySelector('.todo-head')).toHaveAttribute('data-done');
    expect(document.querySelectorAll('.confetti-piece')).toHaveLength(0);
    unmount();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Only one')]) }}/>);
    await user.click(screen.getByRole('checkbox', { name: 'Only one' }));
    expect(document.querySelectorAll('.confetti-piece').length).toBeGreaterThan(0);
  });

  // POST /api/calendar/todo defaults minutes when the key is absent and refuses null, so a todo with
  // no estimate must send no minutes key at all.
  it('sends a todo to the calendar with its minutes, and with no minutes key when it has no estimate', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options?: RequestInit) => {
      const path = String(url); requests.push({ url: path, body: options?.body ? JSON.parse(String(options.body)) : undefined });
      const reply = path.includes('/calendar/status') ? { connected: true } : { ok: true, eventId: 'evt-1' };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const user = userEvent.setup();
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Office hours', false, { time: '14:30' }), todo('Lab', false, { time: '09:00', minutes: 45 })]) }}/>);
    const options = (text: string) => within(screen.getByRole('group', { name: 'Options for ' + text }));
    await user.click(screen.getByRole('button', { name: 'Options for Office hours' }));
    await user.click(options('Office hours').getByRole('button', { name: 'Add to calendar' }));
    expect(await screen.findByText('Added to your calendar.')).toBeInTheDocument();
    const bare = requests.find(r => r.url.endsWith('/api/calendar/todo'))!.body;
    expect(bare).toEqual({ title: 'Office hours', date: today(), time: '14:30' });
    expect(bare).not.toHaveProperty('minutes');
    await user.click(screen.getByRole('button', { name: 'Options for Lab' }));
    await user.click(options('Lab').getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(requests.filter(r => r.url.endsWith('/api/calendar/todo'))).toHaveLength(2));
    expect(requests.filter(r => r.url.endsWith('/api/calendar/todo'))[1].body).toEqual({ title: 'Lab', date: today(), time: '09:00', minutes: 45 });
  });

  it('shows earlier days read only behind Yesterday, and Escape closes a row menu', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Now')], { history: { '2026-09-01': [todo('Then', true)] } }) }}/>);
    expect(screen.queryByText('Then')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(screen.getByRole('checkbox', { name: 'Then' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Options for Now' }));
    expect(screen.getByRole('group', { name: 'Options for Now' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Options for Now' })).not.toBeInTheDocument();
  });
});
