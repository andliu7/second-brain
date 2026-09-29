// Keeps one project's pipeline in step with the server's mirror (server/pipelines.mjs), which is the only
// copy Claude Code can reach: the workspace itself lives in this browser's IndexedDB, out of any CLI's
// sight. While a Pipeline view is on screen this hook
//   pulls: on mount, every 5 seconds while the tab is visible, and when the window regains focus, and
//     merges what it finds into the card stage by stage (shared/pipeline.mjs mergeStages, last write wins)
//   pushes: whenever the card's pipeline changes here, the whole list, which the server merges the same way
// `seen` is the server's clock at the last exchange. A stage only the server has is kept if it changed after
// that (Claude added it) and dropped otherwise (this browser deleted it), so a delete does not come back.
// With no server (a hosted build, the dev server stopped) every call fails quietly and the state says
// so; the pipeline itself still works, it just stays in this browser.
import { useEffect, useRef, useState } from 'react';
import type { Card, ChecklistItem } from '../types';
import { mergeStages } from './pipeline';

export type SyncState = 'off' | 'connecting' | 'shared' | 'offline';
type Change = (update: (card: Card) => Card, message?: string) => void;
type Mirror = { stages: ChecklistItem[] };
type Reply = { status: number; body: { pipeline?: Mirror; now?: string; error?: string } };

async function call(method: string, cardId: string, body?: unknown): Promise<Reply> {
  const res = await fetch('/api/pipelines/' + encodeURIComponent(cardId), { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('The pipeline server is not running.');
  return { status: res.status, body: await res.json() };
}
// Turning the view off takes the project out of the mirror, so Claude Code does not keep reading a stale copy.
export const unsharePipeline = (cardId: string) => call('DELETE', cardId).catch(() => null);
const payload = (card: Card) => ({ title: card.title, subtitle: card.pipeline?.subtitle, layout: card.pipeline?.layout ?? 'vertical', stages: card.checklist });

export function usePipelineSync(card: Card, change: Change): SyncState {
  const enabled = Boolean(card.project && card.pipeline?.enabled);
  const [state, setState] = useState<SyncState>(enabled ? 'connecting' : 'off');
  // Refs, not state: the timer and the fetches read the newest card and stamps without re-running the
  // effect that owns the timer. ready stays false until the first pull, so nothing is pushed blind.
  const live = useRef({ card, change, seen: '', pushed: '', ready: false, busy: false, alive: false });
  live.current.card = card; live.current.change = change;

  // Take the server's copy into the card, then remember its clock. Used for both a pull's and a push's reply,
  // since the server answers a push with the merged pipeline (which may hold a stage Claude just added).
  function take(reply: Reply) {
    const ref = live.current, before = ref.seen, remote = reply.body.pipeline?.stages;
    if (reply.body.now) ref.seen = reply.body.now;
    if (!remote) return;
    const merged = mergeStages(ref.card.checklist, remote, before);
    if (JSON.stringify(merged) !== JSON.stringify(ref.card.checklist)) ref.change(c => ({ ...c, checklist: mergeStages(c.checklist, remote, before) }));
  }
  async function push() {
    const ref = live.current;
    if (!ref.ready || !ref.alive) return;
    const body = payload(ref.card), text = JSON.stringify(body);
    if (text === ref.pushed) return;
    try {
      const reply = await call('PUT', ref.card.id, { ...body, seen: ref.seen });
      if (reply.status !== 200) throw new Error(reply.body.error);
      ref.pushed = text; take(reply); if (ref.alive) setState('shared');
    } catch { if (ref.alive) setState('offline'); }
  }
  async function pull() {
    const ref = live.current;
    if (ref.busy || !ref.alive) return;
    ref.busy = true;
    try {
      const reply = await call('GET', ref.card.id);
      if (!ref.alive) return;
      if (reply.status === 404) { if (reply.body.now) ref.seen = reply.body.now; }
      else if (reply.status === 200) take(reply);
      else throw new Error(reply.body.error);
      ref.ready = true; setState('shared');
      await push();
    } catch { if (ref.alive) setState('offline'); }
    finally { ref.busy = false; }
  }

  useEffect(() => {
    if (!enabled) { setState('off'); return; }
    const ref = live.current;
    ref.alive = true; ref.ready = false; ref.pushed = ''; setState('connecting');
    void pull();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, 5000);
    const focus = () => void pull();
    window.addEventListener('focus', focus);
    return () => { ref.alive = false; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [enabled, card.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shape = JSON.stringify(payload(card));
  useEffect(() => { if (enabled) void push(); }, [enabled, shape]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
