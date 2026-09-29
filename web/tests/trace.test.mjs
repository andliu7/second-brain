// server/trace.mjs and the chat route's "How this answer was made" trace. The clock is driven by hand so
// span times are exact, and fetch is replaced so no provider is ever called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTrace, tokenUsage } from '../server/trace.mjs';
import { chat } from '../server/providers.mjs';
import { handleApi } from '../server/api.mjs';
import { validateWorkspace } from '../shared/validate.mjs';

function fakeClock(start = 1000) { let time = start; return { now: () => time, advance: ms => { time += ms; } }; }
async function withProvider(key, reply, run) {
  const saved = { key: process.env[key], fetch: globalThis.fetch };
  process.env[key] = 'trace-test-key';
  globalThis.fetch = async () => new Response(JSON.stringify(reply), { status: 200 });
  try { return await run(); } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env[key]; else process.env[key] = saved.key;
  }
}
const ask = (provider, context = []) => ({ provider, model: 'fixture-model', messages: [{ role: 'user', content: 'What did I decide?' }], context });

test('spans are timed from the fake clock, nest under the root, and record a failed attempt', async () => {
  const clock = fakeClock();
  const trace = createTrace({ model: 'm', now: clock.now, runId: 'run-1' });
  trace.span({ id: 'context', label: 'Gather context', kind: 'io' }, () => { clock.advance(5); return trace.span({ label: 'notes.md', kind: 'io', parentId: 'context' }, () => { clock.advance(20); return 'text'; }); });
  await assert.rejects(trace.span({ label: 'm', kind: 'model', attempt: 1 }, async () => { clock.advance(100); throw new Error('rate limited'); }), /rate limited/);
  const reply = await trace.span({ label: 'm', kind: 'model', attempt: 2 }, async () => { clock.advance(300); return { usage: { input_tokens: 40, output_tokens: 12 } }; }, data => tokenUsage('claude', data));
  assert.equal(reply.usage.output_tokens, 12);
  clock.advance(2);
  const result = trace.finish();
  assert.equal(result.runId, 'run-1');
  assert.equal(result.duration, 427);
  const [root, context, note, failed, retried] = result.spans;
  assert.deepEqual([root.id, root.kind, root.start, root.end, root.parentId], ['run', 'agent', 0, 427, undefined]);
  assert.deepEqual([context.parentId, context.start, context.end], ['run', 0, 25]);
  assert.deepEqual([note.parentId, note.start, note.end], ['context', 5, 25]);
  assert.deepEqual([failed.status, failed.attempt, failed.start, failed.end], ['error', 1, 25, 125]);
  assert.deepEqual([retried.status, retried.attempt, retried.tokensIn, retried.tokens], ['ok', 2, 40, 12]);
});

test('token counts are read from each provider usage block, and missing usage stays undefined', () => {
  assert.deepEqual(tokenUsage('claude', { usage: { input_tokens: 10, output_tokens: 3 } }), { tokensIn: 10, tokens: 3 });
  assert.deepEqual(tokenUsage('openai', { usage: { input_tokens: 11, output_tokens: 4 } }), { tokensIn: 11, tokens: 4 });
  assert.deepEqual(tokenUsage('openai', { usage: { prompt_tokens: 12, completion_tokens: 5 } }), { tokensIn: 12, tokens: 5 });
  assert.deepEqual(tokenUsage('gemini', { usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 6 } }), { tokensIn: 13, tokens: 6 });
  assert.deepEqual(tokenUsage('claude', {}), { tokensIn: undefined, tokens: undefined });
  assert.deepEqual(tokenUsage('claude', { usage: { input_tokens: -1, output_tokens: 'many' } }), { tokensIn: undefined, tokens: undefined });
});

test('a traced chat has an io span per attachment and a model span with the provider token counts', async () => {
  const clock = fakeClock();
  const trace = createTrace({ model: 'fixture-model', now: clock.now });
  const reply = await withProvider('ANTHROPIC_API_KEY', { content: [{ type: 'text', text: 'Fixture reply' }], usage: { input_tokens: 812, output_tokens: 57 } },
    () => chat(ask('claude', [{ name: 'plan.md', kind: 'note', content: 'Ship Friday' }, { name: 'deploy', kind: 'skill', content: 'Run the build' }]), trace));
  assert.deepEqual(reply, { text: 'Fixture reply', model: 'fixture-model', provider: 'claude' });
  const { spans } = trace.finish();
  const io = spans.filter(span => span.parentId === 'context');
  assert.deepEqual(io.map(span => [span.label, span.kind, span.detail]), [['plan.md', 'io', 'note, 11 chars'], ['deploy', 'io', 'skill, 13 chars']]);
  const model = spans.find(span => span.kind === 'model');
  assert.deepEqual([model.label, model.parentId, model.attempt, model.tokensIn, model.tokens, model.status], ['fixture-model', 'run', 1, 812, 57, 'ok']);
});

test('OpenAI and Gemini replies carry their own token counts onto the model span', async () => {
  for (const [provider, key, reply] of [
    ['openai', 'OPENAI_API_KEY', { output: [{ content: [{ type: 'output_text', text: 'Hi' }] }], usage: { input_tokens: 21, output_tokens: 2 } }],
    ['gemini', 'GEMINI_API_KEY', { candidates: [{ content: { parts: [{ text: 'Hi' }] } }], usageMetadata: { promptTokenCount: 31, candidatesTokenCount: 3 } }],
  ]) {
    const trace = createTrace({ now: fakeClock().now });
    await withProvider(key, reply, () => chat(ask(provider), trace));
    const model = trace.finish().spans.find(span => span.kind === 'model');
    assert.deepEqual([model.tokensIn, model.tokens], provider === 'openai' ? [21, 2] : [31, 3]);
  }
});

test('the chat route returns the trace beside the unchanged reply fields', async () => {
  const body = JSON.stringify(ask('claude', [{ name: 'plan.md', kind: 'note', content: 'Ship Friday' }]));
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', url: '/api/chat', headers: { host: 'localhost:5174', 'content-type': 'application/json' } });
  let status = 0, payload = '';
  const res = { writeHead: code => { status = code; }, end: text => { payload = text; } };
  const saved = process.env.APP_ACCESS_TOKEN; delete process.env.APP_ACCESS_TOKEN;
  try {
    await withProvider('ANTHROPIC_API_KEY', { content: [{ type: 'text', text: 'Fixture reply' }], usage: { input_tokens: 90, output_tokens: 9 } }, () => handleApi(req, res, { local: true }));
  } finally { if (saved !== undefined) process.env.APP_ACCESS_TOKEN = saved; }
  const json = JSON.parse(payload);
  assert.equal(status, 200);
  assert.deepEqual([json.text, json.model, json.provider], ['Fixture reply', 'fixture-model', 'claude']);
  assert.equal(json.trace.model, 'fixture-model');
  assert.match(json.trace.runId, /^[0-9a-f-]{36}$/);
  assert.equal(json.trace.spans[0].id, 'run');
  assert.ok(json.trace.duration >= 0);
  assert.equal(json.trace.spans.find(span => span.kind === 'model').tokens, 9);
});

// message.trace in the saved workspace (shared/validate.mjs). Optional, so older conversations must still load.
const created = '2026-09-28T12:00:00.000Z';
const withMessage = extra => ({ version: 1, docs: [], goals: [], generations: [], activity: [], conversations: [{ id: 'c1', title: 'Plans', updated: created, messages: [
  { id: 'm1', role: 'user', content: 'What did I decide?', created },
  { id: 'm2', role: 'assistant', content: 'Ship Friday.', created, provider: 'claude', model: 'fixture-model', ...extra },
] }] });
const saved = () => ({ runId: 'r1', model: 'fixture-model', duration: 420, spans: [
  { id: 'run', label: 'Answer', kind: 'agent', status: 'ok', start: 0, end: 420 },
  { id: 's1', label: 'fixture-model', kind: 'model', status: 'ok', start: 5, end: 410, parentId: 'run', tokens: 57, tokensIn: 812, attempt: 1 },
] });

test('a workspace saved before traces existed still validates', () => {
  assert.doesNotThrow(() => validateWorkspace(withMessage({})));
});

test('a saved trace validates, and malformed or unbounded ones are refused', () => {
  assert.doesNotThrow(() => validateWorkspace(withMessage({ trace: saved() })));
  const broken = change => { const trace = saved(); change(trace); return withMessage({ trace }); };
  assert.throws(() => validateWorkspace(withMessage({ trace: [] })), /messages\[1\]\.trace must be an object/);
  assert.throws(() => validateWorkspace(broken(t => { t.spans[1].kind = 'shell'; })), /spans\[1\]\.kind/);
  assert.throws(() => validateWorkspace(broken(t => { t.spans[1].end = 1; })), /spans\[1\]\.end must not be before its start/);
  assert.throws(() => validateWorkspace(broken(t => { t.spans[1].tokens = -3; })), /spans\[1\]\.tokens/);
  assert.throws(() => validateWorkspace(broken(t => { t.duration = Infinity; })), /trace\.duration/);
  assert.throws(() => validateWorkspace(broken(t => { t.spans[1].id = 'run'; })), /duplicate ID/);
  assert.throws(() => validateWorkspace(broken(t => { t.spans = Array.from({ length: 201 }, (_, i) => ({ id: 'x' + i, label: 'x', kind: 'io', status: 'ok', start: 0, end: 0 })); })), /exceeds 200 items/);
});
