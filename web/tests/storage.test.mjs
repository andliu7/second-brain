import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { validateWorkspace } from '../shared/validate.mjs';

const created = '2026-09-12T12:34:56.000Z';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
const attachment = 'data:application/octet-stream;base64,AAEC/f7/';
function fixture() {
  return {
    version: 1,
    docs: [{ id: 'doc-1', name: 'Notes', content: '# Hello\n\nA saved thought.', kind: 'note', tags: ['Ideas'], pinned: true, created, updated: created }],
    goals: [{ id: 'goal-1', title: 'Ship a project', description: 'Make something useful.', category: 'Personal', due: '2026-10-01', archived: false, created, milestones: [{ id: 'milestone-1', title: 'Write a plan', done: false }] }],
    conversations: [{ id: 'conversation-1', title: 'My plan', updated: created, messages: [{ id: 'message-1', role: 'user', content: 'Help me plan.', created }, { id: 'message-2', role: 'assistant', content: 'Start with a small milestone.', created, provider: 'openai', model: 'configured-model' }] }],
    generations: [{ id: 'generation-1', prompt: 'A garden', provider: 'openai', model: 'configured-model', aspect: '1:1', created, status: 'complete', images: [png] }],
    activity: [{ id: 'activity-1', text: 'Your workspace is ready', page: 'overview', created }],
  };
}

function rejects(change, expected) {
  const value = fixture();
  change(value);
  assert.throws(() => validateWorkspace(value), expected);
}

// Load the actual browser storage module without creating generated test files.
const storageSource = await readFile(new URL('../src/lib/storage.ts', import.meta.url), 'utf8');
const storageJavascript = ts.transpileModule(storageSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace('../../shared/validate.mjs', new URL('../shared/validate.mjs', import.meta.url).href);
const storage = await import(`data:text/javascript;base64,${Buffer.from(storageJavascript).toString('base64')}`);

test('accepts the complete workspace schema and the actual initial workspace', () => {
  const value = fixture();
  assert.strictEqual(validateWorkspace(value), value);
  const initial = storage.initialWorkspace();
  assert.strictEqual(validateWorkspace(initial), initial);
  assert.ok(initial.docs[0].content.includes('workspace'));
});

test('valid backup round trip preserves all records, file bytes, image bytes, and extension fields', () => {
  const value = fixture();
  value.docs.push({ id: 'doc-2', name: 'binary.dat', content: '', kind: 'file', tags: [], pinned: false, created, updated: created, mime: 'application/octet-stream', data: attachment, size: 6, source: 'local' });
  value.docs.push({ id: 'doc-3', name: 'SKILL.md', content: '# Skill', kind: 'skill', tags: [], pinned: false, created, updated: created });
  value.extension = { userTheme: 'blue', counts: [1, 2, 3] };
  value.docs[0].customMetadata = { purpose: 'Keep this field' };
  const restored = storage.parseBackup(JSON.stringify(value));
  assert.deepEqual(restored, value);
  assert.equal(restored.docs[1].data, attachment);
  assert.equal(restored.generations[0].images[0], png);
});

test('rejects unsupported versions and malformed top-level collections', () => {
  for (const value of [null, [], 1, 'workspace', { version: 2 }, { version: '1' }]) assert.throws(() => validateWorkspace(value), /Invalid workspace/);
  for (const key of ['docs', 'goals', 'conversations', 'generations', 'activity']) rejects(value => { value[key] = {}; }, new RegExp(`${key} must be an array`));
  rejects(value => { value.docs = [null]; }, /docs\[0\] must be an object/);
  rejects(value => { value.docs = new Array(10001); }, /exceeds 10000 items/);
});

test('requires valid document field types and bounded text', () => {
  rejects(value => { value.docs[0].name = ''; }, /name must not be empty/);
  rejects(value => { value.docs[0].content = {}; }, /content must be a string/);
  rejects(value => { value.docs[0].kind = 'html'; }, /kind must be one of/);
  rejects(value => { value.docs[0].pinned = 'true'; }, /pinned must be a boolean/);
  rejects(value => { value.docs[0].tags = ['ok', 7]; }, /tags\[1\] must be a string/);
  rejects(value => { value.docs[0].tags = ['x'.repeat(257)]; }, /exceeds 256 characters/);
  rejects(value => { value.docs[0].content = 'x'.repeat(1024 * 1024 + 1); }, /content exceeds/);
  for (const size of [-1, 0.5, '3', NaN, Infinity, 26 * 1024 * 1024]) rejects(value => { value.docs[0].size = size; }, /size must be an integer/);
});

test('requires real due dates and ISO timestamps with a timezone', () => {
  for (const due of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-1', 'yesterday']) rejects(value => { value.goals[0].due = due; }, /due must be/);
  for (const created of ['2026-02-30T00:00:00Z', '2026-09-12T24:00:00Z', '2026-09-12T12:60:00Z', '2026-09-12T12:00:00', '2026-09-12T12:00:00+99:00', 'not-a-date']) rejects(value => { value.docs[0].created = created; }, /created must be/);
  const value = fixture();
  value.goals[0].due = '2028-02-29';
  value.docs[0].updated = '2026-09-12T08:34:56-04:00';
  validateWorkspace(value);
  value.goals[0].due = '';
  validateWorkspace(value);
});

test('validates goals and milestone records individually', () => {
  rejects(value => { value.goals[0].archived = 0; }, /archived must be a boolean/);
  rejects(value => { value.goals[0].milestones = [true]; }, /milestones\[0\] must be an object/);
  rejects(value => { value.goals[0].milestones[0].done = 'no'; }, /done must be a boolean/);
  rejects(value => { value.goals[0].milestones[0].title = ''; }, /title must not be empty/);
  rejects(value => { value.goals[0].milestones = new Array(1001); }, /exceeds 1000 items/);
});

test('validates messages, generation states, and activity pages', () => {
  rejects(value => { value.conversations[0].messages[0].role = 'system'; }, /role must be one of/);
  rejects(value => { value.conversations[0].messages[0].content = null; }, /content must be a string/);
  rejects(value => { value.conversations[0].messages[1].provider = {}; }, /provider must be a string/);
  rejects(value => { value.generations[0].status = 'running'; }, /status must be one of/);
  rejects(value => { value.generations[0].images = []; }, /must include an image/);
  rejects(value => { value.generations[0].images = png; }, /images must be an array/);
  rejects(value => { value.generations[0].error = {}; }, /error must be a string/);
  rejects(value => { value.activity[0].page = 'javascript:alert(1)'; }, /page must be one of/);
  for (const status of ['queued', 'failed']) {
    const value = fixture();
    Object.assign(value.generations[0], { status, images: [], job: 'job-1', error: status === 'failed' ? 'Provider unavailable' : undefined });
    validateWorkspace(value);
  }
});

test('rejects duplicate and malformed IDs within each independently addressed collection', () => {
  for (const key of ['docs', 'goals', 'conversations', 'generations', 'activity']) rejects(value => { value[key].push(structuredClone(value[key][0])); }, /duplicate ID/);
  rejects(value => { value.goals[0].milestones.push(structuredClone(value.goals[0].milestones[0])); }, /duplicate ID/);
  rejects(value => { value.conversations[0].messages[1].id = value.conversations[0].messages[0].id; }, /duplicate ID/);
  rejects(value => { value.docs[0].id = ' '; }, /id must not be empty/);
  rejects(value => { value.docs[0].id = 1; }, /id must be a string/);
});

test('rejects executable/remote image URLs and malformed or noncanonical base64', () => {
  for (const data of ['javascript:alert(1)', 'https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=', 'data:image/png;base64,', 'data:image/png;base64,abcd===', 'data:image/png;base64,a===', 'data:image/png;base64,Zh==', 'data:image/png;base64,Zm9=', 'data:image/png;base64,AA\nA=', 'data:image/png;base64,AAAA_', 'data:image/png,AAAA', 'data:image/png;charset=utf-8;base64,AAAA']) rejects(value => { value.generations[0].images = [data]; }, /Invalid workspace: generations/);
  for (const data of ['data:;base64,AAAA', 'data:application/octet-stream;base64,abc', 'data:application/octet-stream;base64,AA=A', 'file:///secret']) rejects(value => { value.docs[0].data = data; }, /Invalid workspace: docs/);
});

test('accepts arbitrary MIME file attachments for downloading, including empty files', () => {
  for (const data of ['data:text/html;base64,PGgxPkhlbGxvPC9oMT4=', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/plain;charset=utf-8;base64,SGVsbG8=', 'data:application/octet-stream;base64,']) {
    const value = fixture();
    value.docs[0].data = data;
    validateWorkspace(value);
  }
  rejects(value => { Object.assign(value.docs[0], { data: attachment, size: 7 }); }, /must match the attachment byte count/);
  rejects(value => { Object.assign(value.docs[0], { data: attachment, mime: 'image/png' }); }, /must match the attachment MIME type/);
});

test('bounds preserved extension data and rejects circular or non-data objects', () => {
  rejects(value => { value.extension = value; }, /circular reference/);
  rejects(value => { value.extension = new Map(); }, /must be a plain object/);
  rejects(value => { value.extension = () => {}; }, /serializable data/);
  rejects(value => { value.extension = { count: Infinity }; }, /finite numbers/);
  rejects(value => { let nested = {}; value.extension = nested; for (let i = 0; i < 33; i++) nested = nested.child = {}; }, /32 levels/);
});

test('parseBackup rejects malformed JSON and invalid nested records', () => {
  assert.throws(() => storage.parseBackup('{broken'), SyntaxError);
  const value = fixture();
  value.goals[0].milestones[0].done = 'yes';
  assert.throws(() => storage.parseBackup(JSON.stringify(value)), /done must be a boolean/);
});
