// workspace.todayLayout (TodayWidgets.tsx) is optional: workspaces saved before it must still load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspace } from '../shared/validate.mjs';

const created = '2026-09-12T12:34:56.000Z';
const old = () => ({ version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [{ id: 'a1', text: 'Your workspace is ready', page: 'today', created }] });

test('a workspace saved before todayLayout existed still validates', () => {
  assert.doesNotThrow(() => validateWorkspace(old()));
});

test('a saved layout validates, and bad sizes or repeated widgets are refused', () => {
  assert.doesNotThrow(() => validateWorkspace({ ...old(), todayLayout: [{ id: 'todos', size: 'wide' }, { id: 'streak', size: 'sm' }, { id: 'projects', size: 'tall' }, { id: 'goals', size: 'lg' }] }));
  assert.throws(() => validateWorkspace({ ...old(), todayLayout: [{ id: 'todos', size: 'huge' }] }), /todayLayout\[0\]\.size/);
  assert.throws(() => validateWorkspace({ ...old(), todayLayout: [{ id: 'todos', size: 'sm' }, { id: 'todos', size: 'wide' }] }), /duplicate ID/);
  assert.throws(() => validateWorkspace({ ...old(), todayLayout: {} }), /todayLayout must be an array/);
});
