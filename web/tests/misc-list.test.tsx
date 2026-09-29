import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MiscList } from '../src/MiscList';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Workspace } from '../src/types';

let latest: Workspace;
function Harness({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); latest = next; return next; }); return true; };
  return <MiscList workspace={workspace} commit={commit}/>;
}

describe('the brainstorm list', () => {
  it('adds lines of any kind, newest first, ticks tasks, and changes a kind by clicking it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={initialWorkspace()}/>);
    const box = screen.getByLabelText('New brainstorm line');
    await user.type(box, 'Unit 3 question sources{Enter}');
    await user.click(screen.getByRole('button', { name: 'Task' }));
    await user.type(box, 'Email the TA{Enter}');
    expect(box).toHaveValue('');
    const items = () => screen.getAllByRole('listitem');
    expect(items().map(li => li.getAttribute('data-kind'))).toEqual(['task', 'idea']);
    await user.click(screen.getByRole('checkbox', { name: 'Email the TA' }));
    expect(latest.misc![0]).toMatchObject({ text: 'Email the TA', kind: 'task', done: true });
    await user.click(screen.getByRole('button', { name: 'Idea, change kind' }));
    expect(latest.misc![1].kind).toBe('note');
    // The filter shows one kind at a time.
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(items()).toHaveLength(1);
  });

  it('edits a line in place, and Escape cancels', async () => {
    const user = userEvent.setup();
    const w = initialWorkspace(); w.misc = [{ id: 'm1', text: 'first draft', kind: 'note', done: false, created: new Date().toISOString() }];
    render(<Harness initial={w}/>);
    await user.click(screen.getByRole('button', { name: 'first draft' }));
    await user.clear(screen.getByLabelText('Edit line'));
    await user.type(screen.getByLabelText('Edit line'), 'second draft{Enter}');
    expect(latest.misc![0].text).toBe('second draft');
    await user.click(screen.getByRole('button', { name: 'second draft' }));
    await user.type(screen.getByLabelText('Edit line'), ' nope{Escape}');
    expect(screen.getByRole('button', { name: 'second draft' })).toBeInTheDocument();
  });

  it('moves a line to the board as a card in the first column, in one save', async () => {
    const user = userEvent.setup();
    const w = initialWorkspace(); w.misc = [{ id: 'm1', text: 'Design the loading page', kind: 'idea', done: false, created: new Date().toISOString() }];
    render(<Harness initial={w}/>);
    await user.click(within(screen.getByRole('listitem')).getByRole('button', { name: 'Move Design the loading page to the board' }));
    expect(latest.misc).toEqual([]);
    expect(latest.board!.cards.at(-1)).toMatchObject({ title: 'Design the loading page', column: 'todo' });
    expect(screen.getByText(/Empty\. Type anything/)).toBeInTheDocument();
  });

  it('a workspace saved before the list existed still validates, and a bad kind does not', () => {
    const w = initialWorkspace();
    expect(validateWorkspace(w)).toBe(w);
    expect(() => validateWorkspace({ ...w, misc: [{ id: 'x', text: 'a', kind: 'todo', done: false, created: new Date().toISOString() }] })).toThrow(/misc\[0\]\.kind/);
  });
});
