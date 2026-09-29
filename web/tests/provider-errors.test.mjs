import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../server/providers.mjs';

// A provider's own reason is what tells Andrew what to do (top up credit, fix a model id), so it must
// reach the chat instead of being replaced by our generic hint.
test('a provider error keeps the provider reason after our hint', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), { status: 400 });
  try {
    await assert.rejects(requestJson('https://api.anthropic.com/v1/messages', 'k', {}, 'claude'), err => {
      assert.match(err.message, /HTTP 400/);
      assert.match(err.message, /Provider says: Your credit balance is too low/);
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});

test('an error without a reason keeps the plain hint', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 500 });
  try {
    await assert.rejects(requestJson('https://example.test', 'k', {}), err => !/Provider says/.test(err.message) && /HTTP 500/.test(err.message));
  } finally { globalThis.fetch = realFetch; }
});
