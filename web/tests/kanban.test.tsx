import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Kanban } from '../src/Kanban';
import { TODO_DRAG_TYPE, todoPayload } from '../src/lib/todos';
import { initialWorkspace, loadWorkspace, saveWorkspace } from '../src/lib/storage';
import type { Board, Card, Workspace } from '../src/types';

// The board is mounted the way App.tsx will mount it: with the workspace and a commit that saves it.
// Each commit goes through saveWorkspace, so every assertion about persistence reads real storage.
function Host({ initial }: { initial: Workspace }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
  return <Kanban workspace={workspace} commit={commit}/>;
}
const card = (id: string, title: string, column: string, extra: Partial<Card> = {}): Card => ({ id, title, notes: '', column, checklist: [], attachments: [], ...extra });
const withBoard = (cards: Card[], extra: Partial<Board> = {}): Workspace => { const w = initialWorkspace(); w.board = { ...w.board!, cards, ...extra }; return w; };
const column = (name: string) => screen.getByRole('region', { name });
const titlesIn = (region: HTMLElement) => Array.from(region.querySelectorAll('[data-card]')).map(el => el.getAttribute('aria-label'));
// jsdom has no DataTransfer; a plain store is enough for setData/getData, which is all the board uses.
function dataTransfer(seed: Record<string, string> = {}) { const store = { ...seed }; return { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] || '', effectAllowed: 'all', types: Object.keys(store) }; }
// jsdom has no DragEvent either, so clientY has to be put on the event by hand for the top-or-bottom-half test.
function drag(from: HTMLElement, to: HTMLElement, clientY = 0) {
  const dt = dataTransfer();
  fireEvent.dragStart(from, { dataTransfer: dt });
  const over = createEvent.dragOver(to, { dataTransfer: dt });
  Object.defineProperty(over, 'clientY', { value: clientY });
  fireEvent(to, over);
  fireEvent.drop(to.closest('section') as HTMLElement, { dataTransfer: dt });
}
const boardOnDisk = async () => (await loadWorkspace()).board!;

describe('the kanban board', () => {
  it('a workspace saved before the board existed loads with To do, Doing and Done', async () => {
    const { board: _board, ...older } = initialWorkspace();
    await saveWorkspace(older as Workspace);
    const loaded = await loadWorkspace();
    expect(loaded.board).toBeUndefined();
    render(<Host initial={loaded}/>);
    expect(screen.getAllByRole('region').map(el => el.getAttribute('aria-label'))).toEqual(['To do', 'Doing', 'Done']);
  });

  it('dragging a card onto another column moves it there, with the indicator on the slot it will take', async () => {
    render(<Host initial={withBoard([card('a', 'Write the plan', 'todo')])}/>);
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Write the plan' }), { dataTransfer: dt });
    expect(screen.getByLabelText('Drop here to delete')).toBeInTheDocument();
    fireEvent.dragOver(column('Doing'), { dataTransfer: dt });
    expect(column('Doing').querySelector('.kanban-slot[data-active]')).not.toBeNull();
    expect(column('To do').querySelector('.kanban-slot[data-active]')).toBeNull();
    fireEvent.drop(column('Doing'), { dataTransfer: dt });
    await waitFor(() => expect(titlesIn(column('Doing'))).toEqual(['Write the plan']));
    expect(titlesIn(column('To do'))).toEqual([]);
    expect((await boardOnDisk()).cards[0].column).toBe('doing');
  });

  it('dropping a card below another card puts it after that card', async () => {
    render(<Host initial={withBoard([card('a', 'A', 'todo'), card('b', 'B', 'todo'), card('c', 'C', 'todo')])}/>);
    // The pointer is below C's midpoint (every rect is 0 high in jsdom, so any clientY above 0 is the bottom half).
    drag(screen.getByRole('button', { name: 'A' }), screen.getByRole('button', { name: 'C' }), 100);
    await waitFor(() => expect(titlesIn(column('To do'))).toEqual(['B', 'C', 'A']));
    // And above a card's midpoint puts it before that card.
    drag(screen.getByRole('button', { name: 'C' }), screen.getByRole('button', { name: 'B' }), 0);
    await waitFor(() => expect(titlesIn(column('To do'))).toEqual(['C', 'B', 'A']));
    expect((await boardOnDisk()).cards.map(c => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('dropping a card on the delete zone removes it', async () => {
    render(<Host initial={withBoard([card('a', 'Old', 'todo')])}/>);
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Old' }), { dataTransfer: dt });
    fireEvent.drop(screen.getByLabelText('Drop here to delete'), { dataTransfer: dt });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Old' })).not.toBeInTheDocument());
    expect((await boardOnDisk()).cards).toEqual([]);
  });

  it('the checklist is collapsed to "0 of 2" and a toggled item is saved', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([card('a', 'Pack', 'todo', { checklist: [{ id: 'i1', title: 'Socks', done: false }, { id: 'i2', title: 'Charger', done: false }] })])}/>);
    expect(screen.queryByLabelText('Socks')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Checklist, 0 of 2 done' }));
    await user.click(screen.getByLabelText('Socks'));
    expect(await screen.findByRole('button', { name: 'Checklist, 1 of 2 done' })).toBeInTheDocument();
    expect((await boardOnDisk()).cards[0].checklist.map(i => i.done)).toEqual([true, false]);
  });

  it('a category picked from the swatch row on the card survives a save and a load', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host initial={withBoard([card('a', 'Exam', 'todo')])}/>);
    await user.click(screen.getByRole('button', { name: 'Category: none' }));
    await user.click(screen.getByRole('button', { name: 'Urgent' }));
    await waitFor(async () => expect((await boardOnDisk()).cards[0].category).toBe('urgent'));
    unmount();
    render(<Host initial={await loadWorkspace()}/>);
    expect(screen.getByRole('button', { name: 'Exam' })).toHaveAttribute('data-category', 'urgent');
    expect(screen.getByRole('button', { name: 'Category: Urgent' })).toBeInTheDocument();
  });

  it('adds a card from the inline form, into that column', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([])}/>);
    await user.click(within(column('Doing')).getByRole('button', { name: 'Add card' }));
    await user.type(screen.getByLabelText('New card title'), 'Read chapter 4{Enter}');
    await waitFor(() => expect(titlesIn(column('Doing'))).toEqual(['Read chapter 4']));
    expect((await boardOnDisk()).cards[0]).toMatchObject({ title: 'Read chapter 4', column: 'doing' });
  });

  it('a todo dropped on a column becomes one card there, and dropping it again adds nothing', async () => {
    render(<Host initial={withBoard([])}/>);
    const payload = JSON.stringify(todoPayload({ id: 'todo-7', text: 'Run 5k', done: false, category: 'fitness', minutes: 40, goal: 'Under 28 minutes' }));
    fireEvent.drop(column('Doing'), { dataTransfer: dataTransfer({ [TODO_DRAG_TYPE]: payload }) });
    await waitFor(() => expect(titlesIn(column('Doing'))).toEqual(['Run 5k']));
    expect(screen.getByRole('button', { name: 'Run 5k' })).toHaveAttribute('data-category', 'fitness');
    expect(screen.getByText('40 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checklist, 0 of 1 done' })).toBeInTheDocument();
    fireEvent.drop(column('To do'), { dataTransfer: dataTransfer({ [TODO_DRAG_TYPE]: payload }) });
    await new Promise(resolve => setTimeout(resolve, 50));
    const saved = await boardOnDisk();
    expect(saved.cards).toHaveLength(1);
    expect(saved.cards[0]).toMatchObject({ sourceTodoId: 'todo-7', column: 'doing', minutes: 40, checklist: [{ title: 'Under 28 minutes', done: false }] });
    expect(titlesIn(column('To do'))).toEqual([]);
  });
});

describe('sticky mode', () => {
  const three = () => withBoard([card('a', 'A', 'todo', { category: 'project' }), card('b', 'B', 'doing'), card('c', 'C', 'todo')]);

  it('shows the same cards as notes, in order, and switching back restores the columns untouched', async () => {
    const user = userEvent.setup();
    render(<Host initial={three()}/>);
    await user.click(screen.getByRole('button', { name: 'Sticky notes view' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'To do' })).not.toBeInTheDocument());
    const notes = () => Array.from(document.querySelectorAll('.sticky')).map(el => el.getAttribute('aria-label'));
    expect(notes()).toEqual(['A', 'B', 'C']);
    expect(document.querySelector('.sticky[data-category="project"]')).not.toBeNull();
    expect((await boardOnDisk()).view).toBe('sticky');
    await user.click(screen.getByRole('button', { name: 'Board view' }));
    await waitFor(() => expect(titlesIn(column('To do'))).toEqual(['A', 'C']));
    expect(titlesIn(column('Doing'))).toEqual(['B']);
    expect((await boardOnDisk()).cards.map(c => [c.id, c.column])).toEqual([['a', 'todo'], ['b', 'doing'], ['c', 'todo']]);
  });

  it('a note keeps its position and rotation through a save and a load', async () => {
    const workspace = withBoard([card('a', 'A', 'todo', { sticky: { x: 120, y: 80, rotate: 45 } })], { view: 'sticky' });
    await saveWorkspace(workspace);
    const loaded = await loadWorkspace();
    expect(loaded.board!.cards[0].sticky).toEqual({ x: 120, y: 80, rotate: 45 });
    render(<Host initial={loaded}/>);
    const note = document.querySelector('.sticky') as HTMLElement;
    expect(note.style.transform).toContain('translateX(120px)');
    expect(note.style.transform).toContain('translateY(80px)');
    expect(note.style.transform).toContain('rotate(45deg)');
  });

  it('the right-click menu rotates, flips to the checklist, recolours and deletes; Escape closes it', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([card('a', 'A', 'todo', { checklist: [{ id: 'i', title: 'Step one', done: false }] })], { view: 'sticky' })}/>);
    const note = () => document.querySelector('.sticky') as HTMLElement;
    fireEvent.contextMenu(note());
    const menu = screen.getByRole('menu', { name: 'A menu' });
    expect(within(menu).getAllByRole('menuitem').map(el => el.textContent)).toEqual(['Rotate 45', 'Flip', 'Colour', 'Delete']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(note());
    await user.click(screen.getByRole('menuitem', { name: 'Rotate 45' }));
    await waitFor(async () => expect((await boardOnDisk()).cards[0].sticky?.rotate).toBe(-3 + 45));
    fireEvent.contextMenu(note());
    await user.click(screen.getByRole('menuitem', { name: 'Flip' }));
    expect(screen.getByLabelText('Step one')).toBeInTheDocument();
    fireEvent.contextMenu(note());
    await user.click(screen.getByRole('menuitem', { name: 'Colour' }));
    await user.click(screen.getByRole('button', { name: 'Family' }));
    await waitFor(async () => expect((await boardOnDisk()).cards[0].category).toBe('family'));
    fireEvent.contextMenu(note());
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(document.querySelector('.sticky')).toBeNull());
    expect((await boardOnDisk()).cards).toEqual([]);
  });
});

describe('from calendar', () => {
  const events = [
    { id: 'ev-1', title: 'Organic chemistry exam', start: '2026-09-30T14:00:00.000Z', end: '2026-09-30T16:00:00.000Z', allDay: false, location: 'CSI 1121', link: 'https://calendar.example/ev-1' },
    { id: 'ev-2', title: 'Family dinner', start: '2026-10-03', end: '2026-10-04', allDay: true, location: '', link: '' },
  ];
  const stub = (status: object) => vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/calendar/status') ? status : { events }), { status: 200, headers: { 'content-type': 'application/json' } })));
  beforeEach(() => stub({ connected: true, email: 'andrew@example.com' }));

  it('imports the chosen events as cards in the first column, and re-importing one adds no card', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([])}/>);
    await user.click(screen.getByRole('button', { name: 'From calendar' }));
    await user.click(await screen.findByLabelText('Organic chemistry exam'));
    await user.click(screen.getByLabelText('Family dinner'));
    await user.click(screen.getByRole('button', { name: 'Add 2 to To do' }));
    await waitFor(() => expect(titlesIn(column('To do'))).toEqual(['Organic chemistry exam', 'Family dinner']));
    const saved = await boardOnDisk();
    expect(saved.cards[0]).toMatchObject({ eventId: 'ev-1', due: '2026-09-30', notes: 'https://calendar.example/ev-1', column: 'todo' });
    expect(saved.cards[1]).toMatchObject({ eventId: 'ev-2', due: '2026-10-03', notes: '' });
    // Open the picker again: both events are already on the board, so neither can be added again.
    await user.click(screen.getByRole('button', { name: 'From calendar' }));
    const picker = within(screen.getByRole('dialog', { name: 'From calendar' }));
    const first = await picker.findByLabelText('Organic chemistry exam');
    expect(first).toBeChecked();
    expect(first).toBeDisabled();
    expect(picker.getAllByText(/already on the board/)).toHaveLength(2);
    expect(picker.getByRole('button', { name: /^Add/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await boardOnDisk()).cards).toHaveLength(2);
  });

  it('says so when no calendar is connected, with a Connect link', async () => {
    stub({ connected: false });
    const user = userEvent.setup();
    render(<Host initial={withBoard([])}/>);
    await user.click(screen.getByRole('button', { name: 'From calendar' }));
    expect(await screen.findByText('No calendar is connected.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/api/calendar/connect');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
