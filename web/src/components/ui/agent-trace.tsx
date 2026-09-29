// AgentTrace: one agent run drawn on a time axis you can scrub. Rebuilt from the 21st.dev "AgentTrace"
// (a name gutter, a bar per span filled up to the playhead, a result column, a ruler, a transport with a
// slider and a timecode) in the app's own tokens, with its data in props and without its demo run.
// Props:
//   spans: TraceSpan[] (types.ts), flattened parent-first by layoutSpans; a span whose parent is missing, or
//     whose parents loop back to it, is drawn as a root rather than dropped
//   runId, model, duration: the header; duration defaults to the latest span end
//   autoPlay: play from 0 when mounted (default true); off, or under prefers-reduced-motion, the finished run shows
//   speed: playback rate, 1 = real time; ruler: show the tick row (default true)
// Why no per-frame React state: a trace can have dozens of rows, and re-rendering all of them 60 times a
// second to move a bar is the wrong cost. The playhead time lives in a ref, and one requestAnimationFrame
// loop writes CSS variables (--t on the card, --p per row) and textContent (the clock, token counts, each
// row's status word) straight to the DOM. React state changes only when playback starts or stops. Any render
// computes the same values from the same ref, so React and the loop never disagree about what is shown.
// The loop stops while the tab is hidden or the card is scrolled away (IntersectionObserver), and never
// starts under reduced motion; the slider still scrubs there, since a scrub is the user's own movement.
// MessageTrace, below, is the "How this answer was made" disclosure for a chat answer.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Bot, ChevronRight, FileText, Pause, Play, Sparkles, Wrench } from 'lucide-react';
import type { AnswerTrace, TraceSpan } from '../../types';
import { prefersReducedMotion } from '../../lib/reduced-motion';
import './agent-trace.css';

export type TraceRow = { span: TraceSpan; depth: number };
export type RowState = 'queued' | 'running' | 'done' | 'error';

// Parent-first, depth-first, siblings by start time (a stable sort, so ties keep their given order).
export function layoutSpans(spans: TraceSpan[]): TraceRow[] {
  const byId = new Map<string, TraceSpan>();
  for (const span of spans) if (!byId.has(span.id)) byId.set(span.id, span);
  const children = new Map<string, TraceSpan[]>(), roots: TraceSpan[] = [];
  for (const span of byId.values()) {
    const parent = span.parentId && span.parentId !== span.id ? byId.get(span.parentId) : undefined;
    if (parent) children.set(parent.id, [...children.get(parent.id) || [], span]); else roots.push(span);
  }
  const byStart = (a: TraceSpan, b: TraceSpan) => a.start - b.start;
  const rows: TraceRow[] = [], seen = new Set<string>();
  const walk = (span: TraceSpan, depth: number) => {
    if (seen.has(span.id)) return;
    seen.add(span.id); rows.push({ span, depth });
    for (const child of (children.get(span.id) || []).sort(byStart)) walk(child, depth + 1);
  };
  roots.sort(byStart).forEach(root => walk(root, 0));
  // A cycle (a under b, b under a) has no root, so nothing above reaches it. Each leftover span, earliest
  // first, becomes a root, which cuts the cycle where it starts; seen stops the walk coming back round.
  for (const span of [...byId.values()].sort(byStart)) walk(span, 0);
  return rows;
}

export function spanState(span: TraceSpan, t: number): RowState {
  if (t < span.start) return 'queued';
  if (t < span.end) return 'running';
  return span.status === 'error' ? 'error' : 'done';
}
// How much of the bar is filled, 0 to 1. A zero-length span is empty until the playhead reaches it, then full.
export function spanProgress(span: TraceSpan, t: number) {
  if (span.end <= span.start) return t >= span.start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - span.start) / (span.end - span.start)));
}
// Round tick steps (1, 2 or 5 times a power of ten) giving about `target` ticks across the run.
export function niceTicks(duration: number, target = 5) {
  if (!(duration > 0)) return [0];
  const raw = duration / target, magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= raw)!;
  return Array.from({ length: Math.floor(duration / step + 1e-9) + 1 }, (_, i) => i * step);
}
export const formatMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
const formatClock = (ms: number) => {
  const seconds = ms / 1000, minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
};
const statusWord = (span: TraceSpan, state: RowState) => state === 'done' && span.status === 'cached' ? 'cached' : ({ queued: 'queued', running: 'running', done: 'done', error: 'failed' })[state];
const icons = { agent: Bot, model: Sparkles, tool: Wrench, io: FileText };
const count = (n: number) => n.toLocaleString('en-US');

type Props = { spans: TraceSpan[]; runId?: string; model?: string; duration?: number; autoPlay?: boolean; speed?: number; ruler?: boolean; label?: string; className?: string };

export function AgentTrace({ spans, runId, model, duration, autoPlay = true, speed = 1, ruler = true, label = 'Agent run', className }: Props) {
  const rows = useMemo(() => layoutSpans(spans), [spans]);
  // At least 1ms, so an all-instant run still divides cleanly.
  const total = Math.max(1, duration ?? 0, ...spans.map(span => span.end));
  const [reduced] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(() => autoPlay && !reduced);
  const time = useRef(autoPlay && !reduced ? 0 : total);
  const rootRef = useRef<HTMLElement>(null), railRef = useRef<HTMLDivElement>(null), clockRef = useRef<HTMLSpanElement>(null), chipRef = useRef<HTMLSpanElement>(null);
  // One slot per row, filled by ref callbacks, so the loop can reach every row without asking React.
  const rowEls = useRef<(HTMLLIElement | null)[]>([]), wordEls = useRef<(HTMLSpanElement | null)[]>([]), tokenEls = useRef<(HTMLSpanElement | null)[]>([]);

  // Everything the playhead moves, written straight to the DOM. aria-valuetext is set only while paused,
  // so a screen reader is not read a new time every frame during playback.
  const apply = useCallback((t: number, paused: boolean) => {
    rootRef.current?.style.setProperty('--t', String(t / total));
    rows.forEach(({ span }, i) => {
      const row = rowEls.current[i]; if (!row) return;
      const state = spanState(span, t), p = spanProgress(span, t);
      if (row.dataset.state !== state) { row.dataset.state = state; const word = wordEls.current[i]; if (word) word.textContent = statusWord(span, state); }
      row.style.setProperty('--p', String(p));
      const tokens = tokenEls.current[i]; if (tokens && span.tokens !== undefined) tokens.textContent = count(Math.round(span.tokens * p));
    });
    if (clockRef.current) clockRef.current.textContent = `${formatClock(t)} / ${formatClock(total)}`;
    if (chipRef.current) { chipRef.current.textContent = t >= total ? 'Completed' : 'Running'; chipRef.current.dataset.done = String(t >= total); }
    const rail = railRef.current; if (!rail) return;
    rail.setAttribute('aria-valuenow', String(Math.round(t)));
    if (paused) rail.setAttribute('aria-valuetext', `${formatMs(t)} of ${formatMs(total)}`); else rail.removeAttribute('aria-valuetext');
  }, [rows, total]);

  // Paused (on mount too): draw the current time once, with its aria-valuetext.
  useEffect(() => { if (!playing) apply(time.current, true); }, [playing, apply]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0, last = 0, visible = !document.hidden, inView = true;
    const step = (now: number) => {
      frame = 0;
      if (last) time.current = Math.min(total, time.current + (now - last) * speed);
      last = now;
      apply(time.current, false);
      if (time.current >= total) setPlaying(false); else schedule();
    };
    const schedule = () => { if (!frame && visible && inView) frame = requestAnimationFrame(step); };
    // last = 0 on a stop, so the time spent hidden or offscreen is not added on the next frame.
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; };
    const onVisibility = () => { visible = !document.hidden; if (visible) schedule(); else stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) schedule(); else stop(); }) : null;
    if (rootRef.current) observer?.observe(rootRef.current);
    schedule();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); observer?.disconnect(); };
  }, [playing, total, speed, apply]);

  const toggle = () => { if (!playing && time.current >= total) time.current = 0; setPlaying(value => !value); };
  const seek = (t: number) => { time.current = Math.min(total, Math.max(0, t)); setPlaying(false); apply(time.current, true); };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const small = total / 100, big = total / 10;
    const by: Record<string, number> = { ArrowRight: small, ArrowUp: small, ArrowLeft: -small, ArrowDown: -small, PageUp: big, PageDown: -big };
    if (event.key === 'Home') seek(0); else if (event.key === 'End') seek(total); else if (event.key in by) seek(time.current + by[event.key]); else return;
    event.preventDefault();
  };
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); if (box.width) seek((event.clientX - box.left) / box.width * total); };

  const t = time.current, done = t >= total;
  return <section ref={rootRef} className={`agent-trace${className ? ' ' + className : ''}`} aria-label={label} style={{ '--t': t / total } as CSSProperties}>
    <header className="at-head">
      <div className="at-title">
        <strong>{runId ? `Run ${runId.slice(0, 8)}` : label}</strong>
        <span className="at-meta">{model && <span>{model}</span>}<span>{rows.length} {rows.length === 1 ? 'span' : 'spans'}</span></span>
      </div>
      <span ref={chipRef} className="at-chip" data-done={String(done)}>{done ? 'Completed' : 'Running'}</span>
    </header>
    <div className="at-body">
      {ruler && <div className="at-ruler" aria-hidden="true"><span/><div className="at-ticks">{niceTicks(total).map(tick => <span key={tick} style={{ left: `${tick / total * 100}%` }}>{formatMs(tick)}</span>)}</div><span/></div>}
      <ol className="at-rows">
        {rows.map(({ span, depth }, i) => {
          const Icon = icons[span.kind] || FileText, state = spanState(span, t), p = spanProgress(span, t);
          return <li key={span.id} ref={el => { rowEls.current[i] = el; }} className="at-row" data-state={state} data-kind={span.kind} data-status={span.status} style={{ '--p': p } as CSSProperties}>
            <div className="at-name" style={{ '--depth': Math.min(depth, 6) } as CSSProperties}>
              <Icon size={14} aria-hidden="true"/>
              <span className="at-label" title={span.label}>{span.label}</span>
              {(span.attempt ?? 1) > 1 && <span className="at-retry" title={`Attempt ${span.attempt}`}>x{span.attempt}</span>}
              <span className="sr-only">, </span><span ref={el => { wordEls.current[i] = el; }} className="sr-only">{statusWord(span, state)}</span>
            </div>
            <div className="at-track"><span className="at-bar" style={{ left: `${span.start / total * 100}%`, width: `${(span.end - span.start) / total * 100}%` }}><span className="at-fill"/></span></div>
            <div className="at-result">
              {span.tokens !== undefined
                ? <span className="at-tokens" title={span.tokensIn !== undefined ? `${count(span.tokensIn)} input tokens, ${count(span.tokens)} output tokens` : undefined}>{span.tokensIn !== undefined && <>{count(span.tokensIn)} in, </>}<span ref={el => { tokenEls.current[i] = el; }}>{count(Math.round(span.tokens * p))}</span> out</span>
                : span.detail && <span className="at-detail" title={span.detail}>{span.detail}</span>}
              <span className="at-duration">{formatMs(span.end - span.start)}</span>
            </div>
          </li>;
        })}
      </ol>
      <div className="at-playhead-layer" aria-hidden="true"><span/><div><span className="at-playhead"/></div><span/></div>
    </div>
    <div className="at-transport">
      {!reduced && <button type="button" className="at-play" aria-label={playing ? 'Pause' : done ? 'Replay' : 'Play'} onClick={toggle}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button>}
      <div ref={railRef} className="at-rail" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}
        onKeyDown={keys} onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); }} onPointerMove={event => { if (event.buttons & 1) fromPointer(event); }}>
        <span className="at-rail-fill"/><span className="at-rail-thumb"/>
      </div>
      <span ref={clockRef} className="at-clock" aria-hidden="true">{`${formatClock(t)} / ${formatClock(total)}`}</span>
    </div>
  </section>;
}

// "How this answer was made" under a chat answer: collapsed by default, and opened on the finished run
// (autoPlay off) because the reader came to inspect the answer, not to watch it replay.
export function MessageTrace({ trace }: { trace?: AnswerTrace }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!trace?.spans?.length) return null;
  return <div className="message-trace">
    <button type="button" className="message-trace-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <ChevronRight size={14} aria-hidden="true"/>How this answer was made<span className="message-trace-sum">{formatMs(trace.duration)}</span>
    </button>
    {open && <div id={id}><AgentTrace spans={trace.spans} runId={trace.runId} model={trace.model} duration={trace.duration} autoPlay={false} label="How this answer was made"/></div>}
  </div>;
}
