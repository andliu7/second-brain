import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TodoCard } from '../src/TodoCard';
import { byPriority, rollover, removeTodo, todoPayload, TODO_DRAG_TYPE } from '../src/lib/todos';
import { initialWorkspace, today } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Todo, Todos, Workspace } from '../src/types';
import { playReward } from '../src/lib/sounds';

// The coin sound is mocked: jsdom has no audio, and the test only needs to know when it was asked for.
vi.mock('../src/lib/sounds', () => ({ playReward: vi.fn() }));

const todo = (text: string, done = false, extra: Partial<Todo> = {}): Todo => ({ id: 'todo-' + text.toLowerCase().replace(/\W+/g, '-'), text, done, category: 'academic', ...extra });
const stored = (day: string, items: Todo[], extra: Partial<Todos> = {}): Todos => ({ day, items, history: {}, removedDefaults: ['read', 'write'], ...extra });

// A stand-in for App: holds the workspace and applies commit() the way App does.
function Harness({ initial, onCommit }: { initial: Workspace; onCommit?: (w: Workspace) => void }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); onCommit?.(next); return next; }); return true; };
  return <TodoCard workspace={workspace} commit={commit}/>;
}

describe('the daily todo card', () => {
  // Old todos are kept for good (Andrew, 2026-09-28); this used to pin a 30-day prune.
  it('rolls a stale day over: done todos go to history, unfinished ones carry forward, every earlier day is kept', () => {
    const history = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, [todo('old ' + i, true)]]));
    history['2025-01-15'] = [todo('Last winter', true)];
    const before = stored('2026-09-20', [todo('Finish lab report', true), todo('Email advisor')], { history });
    const after = rollover(before, '2026-09-24');
    expect(after.day).toBe('2026-09-24');
    expect(after.items.map(t => t.text)).toEqual(['Email advisor']);
    expect(after.history['2026-09-20'].map(t => t.text)).toEqual(['Finish lab report']);
    expect(Object.keys(after.history)).toHaveLength(33);
    expect(after.history['2026-07-01'].map(t => t.text)).toEqual(['old 0']);
    expect(after.history['2025-01-15'].map(t => t.text)).toEqual(['Last winter']);
    // A saved history longer than a year still validates, so keeping old todos never blocks a save.
    const decade = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), [todo('day ' + i, true)]]));
    expect(() => validateWorkspace({ ...initialWorkspace(), todos: stored('2026-09-24', [], { history: decade }) })).not.toThrow();
    // The same day is the same object: nothing to save.
    expect(rollover(after, '2026-09-24')).toBe(after);
    expect(before.history['2026-07-01']).toBeDefined();
  });

  // Andrew, 2026-09-29: "the todo list saves every day it just removes the finished tasks each day".
  it('at each day boundary carries unfinished todos over, drops finished ones from the list, and keeps them in history by day', () => {
    const mon = stored('2026-09-28', [todo('Lab report', true), todo('Email advisor'), todo('Problem set')]);
    const tue = rollover(mon, '2026-09-29');
    expect(tue.items.map(t => t.text)).toEqual(['Email advisor', 'Problem set']);          // unfinished carry over
    expect(tue.history).toEqual({ '2026-09-28': [todo('Lab report', true)] });               // finished kept under its day
    const tueDone = { ...tue, items: tue.items.map(t => t.text === 'Email advisor' ? { ...t, done: true } : t) };
    const wed = rollover(tueDone, '2026-09-30');
    expect(wed.items.map(t => t.text)).toEqual(['Problem set']);
    expect(Object.fromEntries(Object.entries(wed.history).map(([day, items]) => [day, items.map(t => t.text)]))).toEqual({ '2026-09-28': ['Lab report'], '2026-09-29': ['Email advisor'] });
    // The day is the local calendar day, not the UTC one: 23:30 on the 29th here is still the 29th.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 23, 30));
    expect(today()).toBe('2026-09-29');
    vi.setSystemTime(new Date(2026, 8, 30, 0, 5));
    expect(today()).toBe('2026-09-30');
    vi.useRealTimers();
  });

  it('rolls over a card left open past midnight, within the minute', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 29, 23, 59, 30));
    const commits: Workspace[] = [];
    render(<Harness initial={{ ...initialWorkspace(), todos: stored('2026-09-29', [todo('Lab report', true), todo('Email advisor')]) }} onCommit={w => commits.push(w)}/>);
    expect(screen.getByRole('checkbox', { name: 'Lab report' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.queryByRole('checkbox', { name: 'Lab report' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Email advisor' })).not.toBeChecked();
    expect(commits.at(-1)?.todos?.day).toBe('2026-09-30');
    expect(commits.at(-1)?.todos?.history['2026-09-29'].map(t => t.text)).toEqual(['Lab report']);
    vi.useRealTimers();
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

  // 2026-09-29: Earlier moved from the card's header into the full list, so this opens the list first
  // (Open list, since one todo hides nothing). The Escape half now also checks that closing a row menu
  // inside the dialog leaves the dialog open.
  it('shows earlier days read only behind Earlier in the full list, and Escape closes a row menu', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Now')], { history: { '2026-09-01': [todo('Then', true)] } }) }}/>);
    expect(screen.queryByText('Then')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Earlier' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open list' }));
    const list = within(screen.getByRole('dialog', { name: 'All todos' }));
    await user.click(list.getByRole('button', { name: 'Earlier' }));
    expect(list.getByRole('checkbox', { name: 'Then' })).toBeDisabled();
    await user.click(list.getByRole('button', { name: 'Options for Now' }));
    expect(list.getByRole('group', { name: 'Options for Now' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(list.queryByRole('group', { name: 'Options for Now' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'All todos' })).toBeInTheDocument();
  });

  it('plays the reward sound once when a todo is ticked done, and not when it is unticked', async () => {
    const user = userEvent.setup();
    vi.mocked(playReward).mockClear();
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Coin'), todo('Other')]) }}/>);
    await user.click(screen.getByRole('checkbox', { name: 'Coin' }));
    expect(playReward).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('checkbox', { name: 'Coin' }));
    expect(screen.getByRole('checkbox', { name: 'Coin' })).not.toBeChecked();
    expect(playReward).toHaveBeenCalledTimes(1);
  });

  it('orders by urgency, then importance, highest first, with unrated todos last in their stored order', () => {
    const items = [todo('Plain A'), todo('Low', false, { urgency: 1, importance: 5 }), todo('Plain B'), todo('Important', false, { urgency: 3, importance: 5 }),
      todo('Urgent', false, { urgency: 5, importance: 1 }), todo('Tie first', false, { urgency: 3, importance: 2 }), todo('Tie second', false, { urgency: 3, importance: 2 }),
      todo('Importance only', false, { importance: 4 }), todo('Done urgent', true, { urgency: 4 })];
    expect(byPriority(items).map(t => t.text)).toEqual(['Urgent', 'Done urgent', 'Important', 'Tie first', 'Tie second', 'Low', 'Importance only', 'Plain A', 'Plain B']);
    // A copy: the stored order is untouched.
    expect(items[0].text).toBe('Plain A');
    expect(byPriority([todo('x'), todo('y')]).map(t => t.text)).toEqual(['x', 'y']);
  });

  it('shows the top three on the card, and Show more opens every todo in a dialog that Escape closes, returning focus', async () => {
    const user = userEvent.setup();
    const items = [todo('One'), todo('Two'), todo('Three', false, { urgency: 2 }), todo('Four', false, { urgency: 5 }), todo('Five')];
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), items) }}/>);
    const card = within(screen.getByRole('region', { name: "Today's todos" }));
    expect(card.getAllByRole('checkbox').map(box => box.getAttribute('aria-label'))).toEqual(['Four', 'Three', 'One']);
    const more = card.getByRole('button', { name: 'Show more (2)' });
    await user.click(more);
    const dialog = screen.getByRole('dialog', { name: 'All todos' });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getAllByRole('checkbox').map(box => box.getAttribute('aria-label'))).toEqual(['Four', 'Three', 'One', 'Two', 'Five']);
    // Every control is there: add, tick, the options panel.
    await user.type(within(dialog).getByRole('textbox', { name: 'New todo' }), 'Six{Enter}');
    expect(within(dialog).getByRole('checkbox', { name: 'Six' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Two' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Two' })).toBeChecked();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'All todos' })).toBeNull();
    expect(card.getByRole('button', { name: 'Show more (3)' })).toHaveFocus();
  });

  it('rates a todo from its options, shows one chip for both, edits it from the chip, and saves each change', async () => {
    const user = userEvent.setup();
    const commits: Workspace[] = [];
    render(<Harness initial={{ ...initialWorkspace(), todos: stored(today(), [todo('Essay'), todo('Laundry')]) }} onCommit={w => commits.push(w)}/>);
    expect(screen.queryByRole('button', { name: /^Urgency/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Options for Laundry' }));
    const options = within(screen.getByRole('group', { name: 'Options for Laundry' }));
    await user.click(options.getByRole('button', { name: 'Urgency 4' }));
    await user.click(options.getByRole('button', { name: 'Importance 2' }));
    expect(commits.at(-1)?.todos?.items.find(t => t.text === 'Laundry')).toMatchObject({ urgency: 4, importance: 2 });
    // One chip, not two, with both numbers in its name; the rated todo now sorts first.
    const chip = screen.getByRole('button', { name: 'Urgency 4 of 5, importance 2 of 5' });
    expect(chip).toHaveTextContent('4·2');
    expect(screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-label'))).toEqual(['Laundry', 'Essay']);
    await user.keyboard('{Escape}');                      // closes the options panel, so one picker is on screen
    expect(screen.queryByRole('group', { name: 'Options for Laundry' })).toBeNull();
    await user.click(chip);
    const editor = within(screen.getByRole('group', { name: 'Priority for Laundry' }));
    expect(editor.getByRole('button', { name: 'Urgency 4' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(editor.getByRole('button', { name: 'Importance 5' }));
    expect(screen.getByRole('button', { name: 'Urgency 4 of 5, importance 5 of 5' })).toBeInTheDocument();
    expect(commits.at(-1)?.todos?.items.find(t => t.text === 'Laundry')).toMatchObject({ urgency: 4, importance: 5 });
    await user.click(editor.getByRole('button', { name: 'Clear' }));
    const cleared = commits.at(-1)?.todos?.items.find(t => t.text === 'Laundry');
    expect(cleared?.urgency).toBeUndefined();
    expect(cleared?.importance).toBeUndefined();
    expect(screen.queryByRole('button', { name: /^Urgency \d of 5/ })).toBeNull();
    expect(screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-label'))).toEqual(['Essay', 'Laundry']);
  });
});
