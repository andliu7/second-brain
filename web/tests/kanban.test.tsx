import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Kanban } from '../src/Kanban';
import { Projects } from '../src/Projects';
import { TODO_DRAG_TYPE, todoPayload } from '../src/lib/todos';
import { initialWorkspace, loadWorkspace, saveWorkspace, today } from '../src/lib/storage';
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

  it('the dashed circle on a card is the category picker, and its tooltip says so', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([card('a', 'Exam', 'todo')])}/>);
    const dot = screen.getByRole('button', { name: 'Category: none' });
    expect(dot).toHaveAttribute('title', 'No category. Click to pick a colour');
    expect(dot).toHaveAttribute('aria-expanded', 'false');
    await user.click(dot);
    await user.click(screen.getByRole('button', { name: 'Urgent' }));
    expect(await screen.findByRole('button', { name: 'Category: Urgent' })).toHaveAttribute('title', 'Category: Urgent. Click to change it');
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

// Andrew, 2026-09-28: the whole board fits the page, every card opens on a click, and sticky mode says
// where its menu is.
describe('the board fits the width', () => {
  it('gives the grid one share per column, follows an added column, and a click opens the card', async () => {
    const user = userEvent.setup();
    const w = withBoard([card('a', 'A', 'todo')]);
    w.board!.columns = [...w.board!.columns, { id: 'review', name: 'Review' }];
    render(<Host initial={w}/>);
    const board = document.querySelector('.kanban-board') as HTMLElement;
    expect(board.style.getPropertyValue('--columns')).toBe('4');
    expect(board.querySelectorAll(':scope > .kanban-column')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await waitFor(() => expect((document.querySelector('.kanban-board') as HTMLElement).style.getPropertyValue('--columns')).toBe('5'));
    await user.click(screen.getByRole('button', { name: 'A' }));
    expect(screen.getByRole('dialog', { name: 'Card' })).toBeInTheDocument();
  });

  it('shows a one-line hint above the sticky canvas naming the right-click menu', async () => {
    render(<Host initial={withBoard([card('a', 'A', 'todo')], { view: 'sticky' })}/>);
    const hint = screen.getByText(/Right-click a note/);
    expect(hint).toHaveTextContent('Right-click a note, or focus it and press Enter, to rotate, flip, recolour or delete it.');
    expect(hint.nextElementSibling).toHaveClass('sticky-canvas');
  });
});

// A card promoted to a project (Andrew, 2026-09-28: "make it a larger task and then the side panel can
// include details about subtasks that I complete as I go"). Its checklist is its stages.
describe('projects on the board', () => {
  const stages = () => [
    { id: 's1', title: 'Design the unit curriculum', done: true, doneOn: '2026-09-20' },
    { id: 's2', title: 'Find question sources', done: false },
    { id: 's3', title: 'Make the pathway cohesive', done: false, detail: 'One arc from unit 1 to 8' },
  ];
  const project = () => withBoard([card('p', 'Blueberry', 'doing', { project: true, checklist: stages() }), card('q', 'Laundry', 'todo')]);
  const panel = () => screen.getByRole('dialog', { name: 'Blueberry' });
  const stage = (title: string) => within(panel()).getByRole('checkbox', { name: title }).closest('li') as HTMLElement;
  const savedStages = async () => (await boardOnDisk()).cards.find(c => c.id === 'p')!.checklist;

  it('Make it a project promotes a card and opens its panel; Back to a card undoes it and keeps the checklist', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([card('a', 'Blueberry', 'todo', { checklist: [{ id: 'i1', title: 'Design units', done: false }] })])}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    await user.click(screen.getByRole('button', { name: 'Make it a project' }));
    expect(await screen.findByRole('dialog', { name: 'Blueberry' })).toBeInTheDocument();
    expect((await boardOnDisk()).cards[0]).toMatchObject({ project: true, checklist: [{ id: 'i1', title: 'Design units', done: false }] });
    await user.click(screen.getByRole('button', { name: 'Edit card' }));
    await user.click(screen.getByRole('button', { name: 'Back to a card' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = (await boardOnDisk()).cards[0];
    expect(saved.project).toBeUndefined();
    expect(saved.checklist).toEqual([{ id: 'i1', title: 'Design units', done: false }]);
    expect(screen.getByRole('button', { name: 'Checklist, 0 of 1 done' })).toBeInTheDocument();
  });

  it('a project card shows a Project marker and its progress in place of the checklist toggle', () => {
    render(<Host initial={project()}/>);
    const face = screen.getByRole('button', { name: 'Blueberry' });
    expect(face).toHaveAttribute('data-project', 'true');
    expect(within(face).getByText('Project')).toBeInTheDocument();
    expect(within(face).getByText('1 of 3')).toBeInTheDocument();
    expect(within(face).queryByRole('button', { name: /Checklist/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Laundry' })).not.toHaveAttribute('data-project');
  });

  it('the panel completes a stage, edits its notes, adds, reorders and deletes stages, all saved; Esc closes it and returns focus', async () => {
    const user = userEvent.setup();
    render(<Host initial={project()}/>);
    await user.click(screen.getByRole('button', { name: 'Blueberry' }));
    expect(within(panel()).getByText('1 of 3')).toBeInTheDocument();
    expect(within(stage('Design the unit curriculum')).getByText('Done 2026-09-20')).toBeInTheDocument();
    expect(stage('Find question sources')).toHaveAttribute('aria-current', 'step');
    // Complete the current stage: it is stamped with today, and the next one becomes current.
    await user.click(within(panel()).getByRole('checkbox', { name: 'Find question sources' }));
    await waitFor(async () => expect((await savedStages())[1]).toMatchObject({ done: true, doneOn: today() }));
    expect(within(panel()).getByRole('checkbox', { name: 'Find question sources' })).toHaveAttribute('aria-checked', 'true');
    expect(stage('Make the pathway cohesive')).toHaveAttribute('aria-current', 'step');
    expect(within(panel()).getByText('2 of 3')).toBeInTheDocument();
    // Expand a stage and rewrite its notes; leaving the field saves them.
    await user.click(within(panel()).getByRole('button', { name: 'Details for Make the pathway cohesive' }));
    const notes = within(panel()).getByLabelText('Notes for Make the pathway cohesive');
    expect(notes).toHaveValue('One arc from unit 1 to 8');
    await user.clear(notes);
    await user.type(notes, 'Units 1 to 8 as one story');
    await user.tab();
    await waitFor(async () => expect((await savedStages())[2].detail).toBe('Units 1 to 8 as one story'));
    // Add at the end with Enter, move it up one, delete the first.
    await user.type(within(panel()).getByLabelText('New stage'), 'Playtest with students{Enter}');
    await waitFor(async () => expect((await savedStages()).map(s => s.title)).toEqual(['Design the unit curriculum', 'Find question sources', 'Make the pathway cohesive', 'Playtest with students']));
    await user.click(within(panel()).getByRole('button', { name: 'Move Playtest with students up' }));
    await waitFor(async () => expect((await savedStages()).map(s => s.title)).toEqual(['Design the unit curriculum', 'Find question sources', 'Playtest with students', 'Make the pathway cohesive']));
    expect(within(panel()).getAllByRole('checkbox').map(el => el.getAttribute('aria-label'))).toEqual(['Design the unit curriculum', 'Find question sources', 'Playtest with students', 'Make the pathway cohesive']);
    await user.click(within(panel()).getByRole('button', { name: 'Delete Design the unit curriculum' }));
    await waitFor(async () => expect((await savedStages()).map(s => s.id)).not.toContain('s1'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Blueberry' })).toHaveFocus();
  });

  // Andrew, 2026-09-28: "include projects in kanban". One list under the board, not a second board.
  it('lists the projects under the board with their progress and a link to the repos; a row opens the panel', async () => {
    const user = userEvent.setup();
    render(<Host initial={project()}/>);
    const section = screen.getByRole('heading', { level: 2, name: 'Projects' }).closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: /Repositories and course projects/ })).toHaveAttribute('href', '#projects');
    const row = within(section).getByRole('button', { name: /Blueberry/ });
    expect(within(row).getByText('Doing')).toBeInTheDocument();
    expect(within(row).getByText('1 of 3')).toBeInTheDocument();
    expect(within(section).queryByText('Laundry')).not.toBeInTheDocument();
    await user.click(row);
    expect(within(panel()).getByRole('button', { name: 'Edit card' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  // The Enter bug: the checklist's add row was a <form> inside the card's <form>, so Enter in it could
  // submit (save and close) the whole card instead of adding the item.
  it('Enter in the add-item field of the card dialog adds the item and leaves the card open and unsaved', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([card('a', 'Pack', 'todo')])}/>);
    await user.click(screen.getByRole('button', { name: 'Pack' }));
    const dialog = screen.getByRole('dialog', { name: 'Card' });
    expect(dialog.querySelector('form form')).toBeNull();
    await user.type(within(dialog).getByLabelText('New checklist item'), 'Socks{Enter}');
    expect(within(dialog).getByLabelText('Socks')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('New checklist item')).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'Card' })).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await loadWorkspace()).board?.cards ?? []).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await boardOnDisk()).cards[0].checklist.map(i => i.title)).toEqual(['Socks']));
  });
});

// Projects lists the promoted cards above the repos and opens the same panel.
describe('board projects on the Projects page', () => {
  const repo = { name: 'grignard-app-source', path: 'grignard/grignard-app-source', branch: 'main', last: '2026-09-27', stale_days: 1, dirty: 0, desc: 'The shipped site' };
  function ProjectsHost({ initial }: { initial: Workspace }) {
    const current = useRef(initial);
    const [workspace, setWorkspace] = useState(initial);
    const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
    return <Projects path="" data={{ repos: [repo], courses: [], blueberry: null }} error="" refresh={() => {}} workspace={workspace} commit={commit}/>;
  }

  it('lists only the project cards with their progress, opens the panel, saves a stage and returns focus; the repos are unchanged', async () => {
    const user = userEvent.setup();
    render(<ProjectsHost initial={withBoard([card('p', 'Blueberry', 'doing', { project: true, checklist: [{ id: 's1', title: 'Design the units', done: false }, { id: 's2', title: 'Find question sources', done: false }] }), card('q', 'Laundry', 'todo')])}/>);
    expect(screen.getByRole('heading', { name: /Board projects/ })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Blueberry/ });
    expect(within(row).getByText('Doing')).toBeInTheDocument();
    expect(within(row).getByText('0 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Laundry')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^grignard-app-source/ })).toHaveAttribute('href', '#projects/grignard/grignard-app-source');
    await user.click(row);
    const drawer = screen.getByRole('dialog', { name: 'Blueberry' });
    expect(within(drawer).queryByRole('button', { name: 'Edit card' })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('checkbox', { name: 'Design the units' }));
    await waitFor(async () => expect((await boardOnDisk()).cards[0].checklist[0]).toMatchObject({ done: true, doneOn: today() }));
    expect(within(row).getByText('1 of 2')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it('says how to make one when there are none', () => {
    render(<ProjectsHost initial={withBoard([card('q', 'Laundry', 'todo')])}/>);
    expect(screen.getByText('None yet. Open a card on the board and choose Make it a project.')).toBeInTheDocument();
  });
});

describe('the column menu', () => {
  it('keeps move and delete behind "...", and asks inline before deleting a column that has cards', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    render(<Host initial={withBoard([card('a', 'A', 'doing')])}/>);
    expect(within(column('Doing')).queryByRole('button', { name: /Delete/ })).toBeNull();
    await user.click(within(column('Doing')).getByRole('button', { name: 'Column actions: Doing' }));
    const menu = screen.getByRole('menu', { name: 'Actions for Doing' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Move left' }));
    await waitFor(async () => expect((await boardOnDisk()).columns.map(c => c.name)).toEqual(['Doing', 'To do', 'Done']));
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(within(column('Doing')).getByRole('button', { name: 'Column actions: Doing' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Delete Doing? Its 1 card moves to the first column.');
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect((await boardOnDisk()).columns).toHaveLength(3);
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));
    await user.click(screen.getByRole('button', { name: 'Delete column' }));
    await waitFor(async () => expect((await boardOnDisk()).columns.map(c => c.name)).toEqual(['To do', 'Done']));
    expect(titlesIn(column('To do'))).toEqual(['A']);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deletes an empty column at once, and Escape closes the menu', async () => {
    const user = userEvent.setup();
    render(<Host initial={withBoard([])}/>);
    await user.click(within(column('Done')).getByRole('button', { name: 'Column actions: Done' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(within(column('Done')).getByRole('button', { name: 'Column actions: Done' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));
    await waitFor(async () => expect((await boardOnDisk()).columns.map(c => c.name)).toEqual(['To do', 'Doing']));
  });
});
