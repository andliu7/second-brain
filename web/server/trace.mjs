// "How this answer was made": the spans of one chat request, timed on the server and returned beside the
// reply as { runId, model, spans, duration }, which components/ui/agent-trace.tsx draws on a time axis.
// Times are milliseconds from the start of the request. Every span without a parent hangs under one root
// agent span ("run") that finish() adds, so the client always gets a single tree.
// The clock is a parameter so tests can drive it by hand; the server passes performance.now.
import { randomUUID } from 'node:crypto';

// Token counts from each provider's own usage block. Missing or malformed usage gives undefined rather
// than zero, because "the provider did not say" and "the answer cost nothing" are different facts.
export function tokenUsage(provider, data) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (provider === 'claude') return { tokensIn: count(data?.usage?.input_tokens), tokens: count(data?.usage?.output_tokens) };
  // The Responses API names them input_tokens/output_tokens; Chat Completions, prompt_tokens/completion_tokens.
  if (provider === 'openai') return { tokensIn: count(data?.usage?.input_tokens ?? data?.usage?.prompt_tokens), tokens: count(data?.usage?.output_tokens ?? data?.usage?.completion_tokens) };
  if (provider === 'gemini') return { tokensIn: count(data?.usageMetadata?.promptTokenCount), tokens: count(data?.usageMetadata?.candidatesTokenCount) };
  return {};
}

export function createTrace({ model = '', now = () => performance.now(), runId = randomUUID() } = {}) {
  const origin = now(); const spans = []; let next = 0;
  const at = () => Math.max(0, Math.round((now() - origin) * 10) / 10);
  // Runs fn and records how long it took. fn may return a value or a promise; either way the span
  // closes when the work does, and a throw is recorded as an error span before it is rethrown, so a
  // failed attempt still shows on the timeline. annotate(result) adds fields such as token counts.
  function span(fields, fn, annotate) {
    const record = { id: fields.id || 's' + ++next, label: fields.label, kind: fields.kind, status: 'ok', start: at(), end: 0, parentId: fields.parentId || 'run', ...(fields.detail ? { detail: fields.detail } : {}), ...(fields.attempt ? { attempt: fields.attempt } : {}) };
    spans.push(record);
    const close = result => { record.end = at(); if (annotate) for (const [key, value] of Object.entries(annotate(result) || {})) if (value !== undefined) record[key] = value; return result; };
    const fail = error => { record.end = at(); record.status = 'error'; throw error; };
    let result;
    try { result = fn(); } catch (error) { fail(error); }
    return result && typeof result.then === 'function' ? result.then(close, fail) : close(result);
  }
  function finish() {
    const duration = Math.max(at(), ...spans.map(item => item.end));
    // The root is ok: finish() is only reached when the request produced a reply, a failed retry included.
    const root = { id: 'run', label: 'Answer', kind: 'agent', status: 'ok', start: 0, end: duration, detail: spans.length + ' steps' };
    return { runId, model, spans: [root, ...spans], duration };
  }
  return { span, finish };
}

// What providers.mjs uses when nobody asked for a trace: the work runs, nothing is recorded.
export const untraced = { span: (_fields, fn) => fn() };
