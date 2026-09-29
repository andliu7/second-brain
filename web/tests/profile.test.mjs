// workspace.profile (src/lib/profile.ts) is optional: workspaces saved before it must still load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspace } from '../shared/validate.mjs';

const created = '2026-09-12T12:34:56.000Z';
const old = () => ({ version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [{ id: 'a1', text: 'Your workspace is ready', page: 'today', created }] });

test('a workspace saved before the profile existed still validates', () => {
  assert.doesNotThrow(() => validateWorkspace(old()));
});

test('a profile validates with or without a status, initials or an emoji', () => {
  assert.doesNotThrow(() => validateWorkspace({ ...old(), profile: { name: 'Andrew Liu', avatar: 'AL', color: 'accent' } }));
  assert.doesNotThrow(() => validateWorkspace({ ...old(), profile: { name: 'Andrew', avatar: '🫐', color: 'green', status: 'Exam week' } }));
  assert.doesNotThrow(() => validateWorkspace({ ...old(), profile: { name: 'Andrew', avatar: '', color: 'ink' } }));
});

test('a profile with a bad colour, a long field or a missing name is refused', () => {
  assert.throws(() => validateWorkspace({ ...old(), profile: { name: 'A', avatar: '', color: 'pink' } }), /profile\.color/);
  assert.throws(() => validateWorkspace({ ...old(), profile: { name: 'A', avatar: 'x'.repeat(17), color: 'red' } }), /profile\.avatar exceeds 16/);
  assert.throws(() => validateWorkspace({ ...old(), profile: { name: 'A', avatar: '', color: 'red', status: 'x'.repeat(141) } }), /profile\.status exceeds 140/);
  assert.throws(() => validateWorkspace({ ...old(), profile: { avatar: '', color: 'red' } }), /profile\.name must be a string/);
  assert.throws(() => validateWorkspace({ ...old(), profile: [] }), /profile must be an object/);
});
