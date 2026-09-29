// Settings' Keys and Brain sections.
//
// Keys: one row per provider with a link to its key page, a paste field and a status dot. The key goes to the
// server once, on Save (server/keys.mjs encrypts it under the user profile), and never comes back: the server
// answers only set, last4, source and the verification status. So nothing here keeps a key after Save, not in
// localStorage, not in the workspace and so not in a backup; the field's text lives in component state until the
// request is sent, then it is cleared.
//
// Brain: the index's age and the last benchmark's headline numbers, from GET /api/brain/summary. Read only on
// purpose: reindexing and benchmarking take minutes and are Andrew's to run, so the page shows the command.
import { useEffect, useState } from 'react';
import { ArrowUpRight, Brain, Check, ChevronDown, Copy, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import './keys.css';

export type KeyState = { provider: string; set: boolean; last4: string | null; source: 'store' | 'env' | null; status: 'none' | 'yellow' | 'green' | 'red'; checkedAt: string | null; message: string };

// What each key is for, in his words, and where to get one. hint is the one step people miss on that site.
export const KEY_PROVIDERS = [
  { id: 'claude', name: 'Claude (Anthropic)', unlocks: 'Chat in andliu.ai, Health parsing and reviews', url: 'https://console.anthropic.com/settings/keys', hint: 'Also add credit under Billing, or every chat fails.' },
  { id: 'openai', name: 'OpenAI', unlocks: 'Chat with GPT models', url: 'https://platform.openai.com/api-keys', hint: 'Add a payment method under Billing first.' },
  { id: 'gemini', name: 'Google Gemini', unlocks: 'Chat and image generation with Gemini', url: 'https://aistudio.google.com/apikey', hint: 'Create the key in a Google Cloud project; the free tier works.' },
  { id: 'fal', name: 'fal', unlocks: 'Image generation with FLUX', url: 'https://fal.ai/dashboard/keys', hint: 'Choose the API scope, and add credit under Billing. fal has no free check, so it stays yellow.' },
  { id: 'kie', name: 'KIE', unlocks: 'Image generation with Nano Banana Pro', url: 'https://kie.ai/api-key', hint: 'Buy a few credits first; Verify shows the balance.' },
  { id: 'usda', name: 'USDA FoodData Central', unlocks: 'Nutrition lookups on the Health page', url: 'https://api.data.gov/signup', hint: 'Free. The key arrives by email; without one, lookups stop after a few an hour.' },
] as const;

const LABEL: Record<KeyState['status'], string> = { none: 'Not set', yellow: 'Not verified', green: 'Verified', red: 'Rejected' };
const time = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// The dot is colour plus a word, never colour alone: the word is what a screen reader and a colour-blind eye get.
function StatusDot({ status, label }: { status: KeyState['status']; label: string }) {
  return <span className={`key-status key-${status}`}><span className="key-dot" aria-hidden="true"/>{label}</span>;
}

function KeyRow({ provider, state, readOnly, update }: { provider: typeof KEY_PROVIDERS[number]; state: KeyState | undefined; readOnly: boolean; update: (next: KeyState) => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'verify' | 'remove'>('');
  const [error, setError] = useState('');
  async function run(kind: 'save' | 'verify' | 'remove') {
    setBusy(kind); setError('');
    // The key is copied out of state and the field cleared before the request, so it is gone from the page
    // whether the save works or not; a failed save means pasting again, which is the safer failure.
    const key = draft.trim();
    if (kind === 'save') setDraft('');
    try {
      const path = 'keys/' + provider.id;
      const result = kind === 'save' ? await api<{ key: KeyState }>(path, { key }, 'PUT') : kind === 'verify' ? await api<{ key: KeyState }>(path + '/verify', undefined, 'POST') : await api<{ key: KeyState }>(path, undefined, 'DELETE');
      update(result.key);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'That did not work.'); }
    finally { setBusy(''); }
  }
  // While a save or check is out, the dot is yellow "Checking", the honest state until the provider answers.
  const status = busy === 'save' || busy === 'verify' ? 'yellow' : state?.status ?? 'none';
  const label = busy === 'save' ? 'Saving and checking' : busy === 'verify' ? 'Checking' : LABEL[status];
  const nameId = 'key-name-' + provider.id;
  return <li className="key-row" aria-labelledby={nameId}>
    <div className="key-head">
      <div className="key-name"><strong id={nameId}>{provider.name}</strong><small>{provider.unlocks}</small></div>
      <StatusDot status={status} label={label}/>
    </div>
    <p className="key-detail">
      {state?.set && <span className="key-mask">•••• {state.last4 ?? '····'}</span>}
      {state?.source === 'env' && <span className="tag">from .env</span>}
      {state?.set && !busy && <span>{state.message}{state.checkedAt ? ', checked ' + time(state.checkedAt) : ''}</span>}
    </p>
    <p className="key-hint"><a href={provider.url} target="_blank" rel="noopener noreferrer">Get a key <ArrowUpRight size={12}/></a><span>{provider.hint}</span></p>
    {!readOnly && <form className="key-form" onSubmit={event => { event.preventDefault(); if (draft.trim() && !busy) void run('save'); }}>
      <input type="password" autoComplete="off" spellCheck={false} aria-label={provider.name + ' API key'} placeholder={state?.set ? 'Paste a new key to replace it' : 'Paste the key here'} value={draft} onChange={event => setDraft(event.target.value)} disabled={!!busy}/>
      <button className="button small primary" disabled={!draft.trim() || !!busy}>{busy === 'save' ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}Save</button>
      <button type="button" className="button small" disabled={!state?.set || !!busy} onClick={() => void run('verify')}>{busy === 'verify' ? <Loader2 size={14} className="spin"/> : <RefreshCw size={14}/>}Verify</button>
      <button type="button" className="button small" disabled={state?.source !== 'store' || !!busy} title={state?.source === 'env' ? 'This key comes from .env; remove it there.' : undefined} onClick={() => void run('remove')}><Trash2 size={14}/>Remove</button>
    </form>}
    {error && <p className="key-error" role="alert">{error}</p>}
  </li>;
}

export function KeysSection() {
  const [keys, setKeys] = useState<KeyState[] | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState('');
  // Fetch on mount; the live flag is the usual cleanup guard, so an answer arriving after Settings closed is dropped.
  useEffect(() => {
    let live = true;
    api<{ readOnly: boolean; keys: KeyState[] }>('keys').then(data => { if (live) { setKeys(data.keys); setReadOnly(data.readOnly); } }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not read the keys.'); });
    return () => { live = false; };
  }, []);
  const update = (next: KeyState) => setKeys(list => (list ?? []).map(item => item.provider === next.provider ? next : item));
  return <section className="panel settings-section" aria-labelledby="keys-heading">
    <div className="section-heading"><h2 id="keys-heading"><KeyRound size={17}/>Keys</h2>{readOnly && keys && <span className="tag">READ ONLY</span>}</div>
    <p className="settings-intro">Get a key from the provider, paste it here and Save. It is encrypted on this PC and never shown again, only its last four characters. Green works, yellow is saved but not confirmed, red was rejected.</p>
    {readOnly && keys && <p className="key-note" role="note">Keys can only be changed on the PC itself.</p>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!keys && !error && <p className="muted"><Loader2 size={14} className="spin"/> Reading keys…</p>}
    {keys && <ul className="key-list">{KEY_PROVIDERS.map(provider => <KeyRow key={provider.id} provider={provider} state={keys.find(item => item.provider === provider.id)} readOnly={readOnly} update={update}/>)}</ul>}
  </section>;
}

type Arm = { hitAt1: number | null; hitAt5: number | null; n: number | null; medianTokens: number | null; medianMs: number | null };
export type BrainSummaryData = {
  index: { lastFullReindex: string | null; command: string };
  speed: { built: string; questions: number | null; brain: Arm | null; grep: Arm | null } | null;
  studies: { study: string; kind: string; arms: { name: string; correct: number | null; n: number | null; tokens: number | null }[] }[];
};
export const REPORT_URL = 'https://claude.ai/artifact/5Z8DUxCc4KYesjepadD4TC';
const count = (value: number | null) => value === null ? 'n/a' : value.toLocaleString('en-US');
const ofN = (hit: number | null, n: number | null) => hit === null || n === null ? 'n/a' : `${hit} of ${n}`;

export function BrainSection() {
  const [data, setData] = useState<BrainSummaryData | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    api<BrainSummaryData>('brain/summary').then(value => { if (live) setData(value); }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not read the brain summary.'); });
    return () => { live = false; };
  }, []);
  const stamp = data?.index.lastFullReindex;
  // log.md writes local time with no zone, so it is read back as local time.
  const days = stamp ? Math.floor((Date.now() - new Date(stamp.replace(' ', 'T')).getTime()) / 86400000) : null;
  const { brain, grep } = data?.speed ?? { brain: null, grep: null };
  return <section className="panel settings-section" aria-labelledby="brain-heading">
    <div className="section-heading"><h2 id="brain-heading"><Brain size={17}/>Brain</h2><a className="text-button" href={REPORT_URL} target="_blank" rel="noopener noreferrer">Full report <ArrowUpRight size={12}/></a></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!data && !error && <p className="muted"><Loader2 size={14} className="spin"/> Reading the brain…</p>}
    {data && <>
      <p className="settings-intro">{stamp ? <>Last full reindex {stamp.slice(0, 10)}, {days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}.{days !== null && days > 7 ? ' Files made since then are unknown to the brain; reindex to add them.' : ''}</> : 'No full reindex on record.'}</p>
      <div className="brain-command"><code>{data.index.command}</code><button type="button" className="button small" onClick={async () => { setCopied(await copyText(data.index.command)); }}>{copied ? <Check size={14}/> : <Copy size={14}/>}{copied ? 'Copied' : 'Copy'}</button><small>Run it yourself in second-brain/second-brain; it takes a few minutes.</small></div>
      {data.speed && brain && grep && <table className="brain-table">
        <caption>Speed benchmark, {count(data.speed.questions)} questions, {data.speed.built.slice(0, 10)}</caption>
        <thead><tr><th scope="col"></th><th scope="col">Brain</th><th scope="col">Grep</th></tr></thead>
        <tbody>
          <tr><th scope="row">Right file first</th><td>{ofN(brain.hitAt1, brain.n)}</td><td>{ofN(grep.hitAt1, grep.n)}</td></tr>
          <tr><th scope="row">Right file in top 5</th><td>{ofN(brain.hitAt5, brain.n)}</td><td>{ofN(grep.hitAt5, grep.n)}</td></tr>
          <tr><th scope="row">Tokens to read (median)</th><td>{count(brain.medianTokens)}</td><td>{count(grep.medianTokens)}</td></tr>
          <tr><th scope="row">Time (median ms)</th><td>{count(brain.medianMs)}</td><td>{count(grep.medianMs)}</td></tr>
        </tbody>
      </table>}
      {data.studies.length > 0 && <details className="setup-details"><summary>Earlier studies<ChevronDown size={15}/></summary>{data.studies.map(study => <div className="brain-study" key={study.study}><strong>{study.study}</strong><small>{study.kind}</small><ul>{study.arms.map(a => <li key={a.name}><span>{a.name}</span><span>{a.correct === null ? 'n/a' : `${a.correct} of ${count(a.n)} correct`}</span><span>{count(a.tokens)} tokens</span></li>)}</ul></div>)}</details>}
    </>}
  </section>;
}
