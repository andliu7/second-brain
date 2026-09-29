import test from 'node:test';
import assert from 'node:assert/strict';
import { chat } from '../server/providers.mjs';

// The composer's effort button reaches Claude as output_config.effort, is left out when it is Default, and is
// refused for a provider that has no such setting rather than silently dropped. fetch is a fixture.
async function claudeBody(extra) {
  const realFetch = globalThis.fetch; const realKey = process.env.ANTHROPIC_API_KEY; let sent;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'TEST FIXTURE: answer' }] }), { status: 200 }); };
  try { await chat({ provider: 'claude', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'Hello' }], ...extra }); return sent; }
  finally { globalThis.fetch = realFetch; if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey; }
}

test('a chosen effort is sent to Claude as output_config.effort', async () => {
  assert.deepEqual((await claudeBody({ effort: 'high' })).output_config, { effort: 'high' });
});

test('no effort sends no output_config, so the model keeps its default', async () => {
  assert.equal('output_config' in await claudeBody({}), false);
});

test('an unknown effort, or effort for another provider, is refused before any request', async () => {
  await assert.rejects(claudeBody({ effort: 'extreme' }), /Reasoning effort/);
  await assert.rejects(chat({ provider: 'openai', model: 'gpt-5.4', messages: [{ role: 'user', content: 'Hello' }], effort: 'low' }), /Reasoning effort/);
});

test('higher effort gets a larger max_tokens, so thinking does not crowd out the answer', async () => {
  assert.equal((await claudeBody({})).max_tokens, 4096);
  assert.equal((await claudeBody({ effort: 'low' })).max_tokens, 4096);
  assert.ok((await claudeBody({ effort: 'high' })).max_tokens > 4096);
  assert.ok((await claudeBody({ effort: 'max' })).max_tokens >= (await claudeBody({ effort: 'high' })).max_tokens);
});
