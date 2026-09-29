import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TodayWidgets, DEFAULT_LAYOUT } from '../src/TodayWidgets';
import { arrange, candidatesFor, choose, pack, tile, type GridItem, type Placement, type WidgetSize } from '../src/components/ui/widget-grid';
import { addDays, stagesPerWeek, todoSeries, todoStreak } from '../src/lib/progress';
import { initialWorkspace, today } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Todo, Todos, Workspace } from '../src/types';

let latest: Workspace;
function Harness({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); latest = next; return next; }); return true; };
  return <TodayWidgets workspace={workspace} commit={commit}/>;
}

const seq = (...sizes: WidgetSize[]): GridItem[] => sizes.map((size, i) => ({ id: `w${i}`, size }));
// Replays placements in reading order and checks each lands on the first cell still empty: that is
// what gap-free means here, no empty cell before any widget. Also checks bounds and overlap.
function expectExact(items: GridItem[], placements: Placement[], cols: number) {
  expect(placements.map(p => p.id).sort()).toEqual(items.map(i => i.id).sort());
  const taken = new Set<number>();
  for (const p of placements) {
    let first = 0; while (taken.has(first)) first++;
    expect(p.y * cols + p.x, `${p.id} at the first free cell`).toBe(first);
    expect(p.x + p.w).toBeLessThanOrEqual(cols);
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) { const c = (p.y + dy) * cols + p.x + dx; expect(taken.has(c), `${p.id} overlaps`).toBe(false); taken.add(c); }
  }
}

describe('the widget grid layout', () => {
  const cases: [string, GridItem[]][] = [
    ['small and wide mixed', seq('wide', 'sm', 'sm', 'tall', 'sm', 'sm')],
    ['a large one first', seq('lg', 'sm', 'sm', 'wide', 'tall', 'sm')],
    ['all small', seq('sm', 'sm', 'sm', 'sm', 'sm')],
    ['the default dashboard', DEFAULT_LAYOUT],
  ];
  for (const cols of [2, 3, 4]) for (const [name, items] of cases) {
    it(`tiles ${name} gap-free at ${cols} columns`, () => {
      const placements = tile(items, cols);
      expect(placements).not.toBeNull();
      expectExact(items, arrange(items, cols), cols);
    });
  }

  it('pulls a later widget forward to fill a gap, and the saved order follows what is seen', () => {
    const items = seq('sm', 'wide', 'sm');
    expect(arrange(items, 2).map(p => p.id)).toEqual(['w0', 'w2', 'w1']);
  });

  it('falls back to the row packer when no gap-free arrangement exists', () => {
    const items = seq('wide', 'wide');
    expect(tile(items, 3)).toBeNull();
    expect(arrange(items, 3)).toEqual(pack(items, 3));
    expect(arrange(items, 3).map(p => [p.x, p.y])).toEqual([[0, 0], [0, 1]]);
  });

  it('offers each distinct drop position once', () => {
    const candidates = candidatesFor(seq('sm', 'sm', 'sm'), 'w0', 3);
    expect(candidates.map(c => [c.rect.x, c.rect.y])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('keeps the chosen drop target until the centre is well inside another, so it never flips back and forth', () => {
    const candidates = candidatesFor(seq('sm', 'sm'), 'w0', 2);  // w0 at x 0, then at x 1
    expect(choose(candidates, { x: 1.05, y: 0.5 }, 0)).toBe(0);   // over the line but not past the inset
    expect(choose(candidates, { x: 1.3, y: 0.5 }, 0)).toBe(1);
    expect(choose(candidates, { x: 0.95, y: 0.5 }, 1)).toBe(1);   // back over the line: still the new one
    expect(choose(candidates, { x: 0.5, y: 0.5 }, 1)).toBe(0);
  });
});

describe('Today widgets', () => {
  it('moves a widget with Alt and an arrow while editing, and saves the layout in the workspace', () => {
    render(<Harness initial={initialWorkspace()}/>);
    // Off by default: widgets are not focusable, so Alt+arrow and dragging do nothing.
    expect(screen.queryByRole('listitem', { name: 'Streak' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    const streak = screen.getByRole('listitem', { name: 'Streak' });
    expect(streak).toHaveAttribute('aria-posinset', '2');
    streak.focus();
    fireEvent.keyDown(streak, { key: 'ArrowLeft', altKey: true });
    expect(latest.todayLayout!.map(w => w.id).slice(0, 2)).toEqual(['streak', 'todos']);
    expect(screen.getByRole('listitem', { name: 'Streak' })).toHaveAttribute('aria-posinset', '1');
    expect(document.activeElement).toBe(streak);  // the DOM order is fixed, so focus stays put
    expect(screen.getByText('Streak, position 1 of 8')).toBeInTheDocument();
  });

  it('changes a widget size from its menu while editing', async () => {
    const user = userEvent.setup();
    render(<Harness initial={initialWorkspace()}/>);
    expect(screen.queryByLabelText('Size of Goals')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit layout' }));
    await user.selectOptions(screen.getByLabelText('Size of Goals'), 'lg');
    expect(latest.todayLayout!.find(w => w.id === 'goals')).toEqual({ id: 'goals', size: 'lg' });
  });

  it('computes todo bars and the streak from history: three days done, one missed', () => {
    const t = today();
    const done = (text: string): Todo => ({ id: text, text, done: true, category: 'other' });
    const todos: Todos = { day: t, items: [done('today one'), { ...done('open'), done: false }], removedDefaults: [], history: {
      [addDays(t, -1)]: [done('a'), done('b')], [addDays(t, -2)]: [done('c')], [addDays(t, -4)]: [done('d')],
    } };
    expect(todoStreak(todos)).toBe(3);
    const series = todoSeries(todos, 14);
    expect(series.bars.slice(-5).map(b => b.count)).toEqual([1, 0, 1, 2, 1]);
    expect(series.total).toBe(5);
    // Nothing done yet today does not break the streak; the day is still open.
    expect(todoStreak({ ...todos, items: [] })).toBe(2);

    render(<Harness initial={{ ...initialWorkspace(), todos }}/>);
    const card = screen.getByRole('heading', { name: 'Todos done' }).closest('article')!;
    expect(within(card).getByRole('img').getAttribute('aria-label')).toMatch(/(0, ){9}1, 0, 1, 2, 1$/);
    expect(within(card).getByText(/Up 5 from the 30 days before/)).toBeInTheDocument();  // the default Todos widget is wide: 30 days
    const streak = screen.getByRole('heading', { name: 'Streak' }).closest('article')!;
    expect(within(streak).getByText('3')).toBeInTheDocument();
    expect(within(streak).getByText(/Up 1 from yesterday/)).toBeInTheDocument();
  });

  it('counts stages per week from their ticked day', () => {
    const t = today();
    const board = { view: 'board' as const, columns: [{ id: 'todo', name: 'To do' }], cards: [{ id: 'p', title: 'Thesis', notes: '', column: 'todo', attachments: [], project: true, checklist: [
      { id: '1', title: 'Outline', done: true, doneOn: t }, { id: '2', title: 'Draft', done: true, doneOn: addDays(t, -7) },
      { id: '3', title: 'Edit', done: true, doneOn: addDays(t, -7) }, { id: '4', title: 'Old', done: true }, { id: '5', title: 'Submit', done: false },
    ] }] };
    const s = stagesPerWeek(board, 8);
    expect([s.thisWeek, s.lastWeek, s.undated]).toEqual([1, 2, 1]);
    render(<Harness initial={{ ...initialWorkspace(), board }}/>);
    expect(screen.getByRole('img', { name: 'Thesis: 4 of 5 stages' })).toBeInTheDocument();
    const stages = screen.getByRole('heading', { name: 'Stages finished' }).closest('article')!;
    expect(within(stages).getByText(/Down 1 from last week/)).toBeInTheDocument();
  });

  it('says honestly when there is nothing to chart yet', () => {
    const empty = { ...initialWorkspace(), activity: [] };
    render(<Harness initial={empty}/>);
    for (const line of [
      'No todos finished yet; the chart starts with your first.',
      'No streak yet; it starts the first day you finish a todo.',
      'No stages ticked yet; the chart starts with your first.',
      'No projects yet; make a card a project on Kanban and its stages show here.',
      'No cards on the board yet; add one on Kanban and it shows here.',
      'No active goals yet; add one on Kanban, below the board, and its milestones show here.',
      'No brainstorm lines yet; add one and they are counted here.',
      'No activity yet; everything you add or change is logged here.',
    ]) expect(screen.getByText(line)).toBeInTheDocument();
    // The three that send you to another page name the page in the nav, Kanban, and link to it.
    for (const name of [/make a card a project on Kanban/, /add one on Kanban and it shows/, /add one on Kanban, below the board/]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', '#board');
    }
    expect(screen.queryByText(/on Board|on Goals/)).toBeNull();
  });
});
