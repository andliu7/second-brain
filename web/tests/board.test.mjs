import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspace } from '../shared/validate.mjs';

// The board's rules in shared/validate.mjs: what a saved board must look like, and that a workspace
// from before the board existed still loads.
const created = '2026-09-12T12:34:56.000Z';
const card = (extra = {}) => ({ id: 'card-1', title: 'Write the plan', notes: '', column: 'todo', checklist: [], attachments: [], ...extra });
function fixture(cards = [card()]) {
  return {
    version: 1,
    docs: [{ id: 'doc-1', name: 'Notes', content: '', kind: 'note', tags: [], pinned: false, created, updated: created }],
    goals: [], conversations: [], generations: [], activity: [],
    board: { view: 'board', columns: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done' }], cards },
  };
}
function rejects(change, expected) { const value = fixture(); change(value); assert.throws(() => validateWorkspace(value), expected); }

test('a workspace without a board is valid, and so is a full board', () => {
  const older = fixture(); delete older.board;
  assert.strictEqual(validateWorkspace(older), older);
  const full = fixture([card({ category: 'urgent', due: '2026-10-01', minutes: 25, eventId: 'ev-1', sourceTodoId: 'todo-1', attachments: ['doc-1'], checklist: [{ id: 'i1', title: 'Outline', done: true }], sticky: { x: 12.5, y: -3, rotate: 42 } })]);
  assert.strictEqual(validateWorkspace(full), full);
});

test('rejects a card in a column that does not exist, an unknown category, or a missing attachment', () => {
  rejects(w => { w.board.cards[0].column = 'nowhere'; }, /board\.cards\[0\]\.column must name an existing column/);
  rejects(w => { w.board.cards[0].category = 'red'; }, /board\.cards\[0\]\.category must be one of: project, family, academic, professional, fitness, relationships, urgent, other/);
  rejects(w => { w.board.cards[0].attachments = ['doc-9']; }, /board\.cards\[0\]\.attachments\[0\] must name an existing doc/);
});

test('rejects a bad due date, a bad view, a non-numeric sticky position and an empty column name', () => {
  rejects(w => { w.board.cards[0].due = '2026-13-01'; }, /board\.cards\[0\]\.due must be a real calendar date/);
  rejects(w => { w.board.view = 'list'; }, /board\.view must be one of: board, sticky/);
  rejects(w => { w.board.cards[0].sticky = { x: 'left', y: 0, rotate: 0 }; }, /board\.cards\[0\]\.sticky\.x must be a finite number/);
  rejects(w => { w.board.cards[0].minutes = 1.5; }, /board\.cards\[0\]\.minutes must be a whole number of minutes/);
  rejects(w => { w.board.columns[0].name = ' '; }, /board\.columns\[0\]\.name must not be empty/);
});
