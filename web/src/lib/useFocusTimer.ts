// The focus timer's clock, ported from Blueberry's src/lib/useFocusTimer.ts (2026-09-28) without its
// deck links. Phases: idle, focus, break, eyeRest. Time is measured from the phase's start stamp, so a
// reload or a background tab loses nothing; the state lives in localStorage under its own key.
// An eye rest is due every `eyeEveryMinutes` of focus (twenty, the 20-20-20 rule) and lasts
// `eyeRestSeconds`; focus rolls into a break when it runs out, a break rolls back to idle.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type TimerPhase = 'idle' | 'focus' | 'break' | 'eyeRest';
export type TimerSettings = { focusMinutes: number; breakMinutes: number; eyeEveryMinutes: number; eyeRestSeconds: number };
export const DEFAULT_SETTINGS: TimerSettings = { focusMinutes: 25, breakMinutes: 5, eyeEveryMinutes: 20, eyeRestSeconds: 20 };
type Persisted = { phase: TimerPhase; startedAt: number; resumeTo: TimerPhase; focusedMs: number; restsTaken: number; eyeBaseMs: number; settings: TimerSettings };
export const FOCUS_KEY = 'brain_focus_v1';
const fresh = (): Persisted => ({ phase: 'idle', startedAt: 0, resumeTo: 'focus', focusedMs: 0, restsTaken: 0, eyeBaseMs: 0, settings: DEFAULT_SETTINGS });
function load(): Persisted {
  try { const raw = localStorage.getItem(FOCUS_KEY); if (!raw) return fresh(); const data = JSON.parse(raw) as Partial<Persisted>; return { ...fresh(), ...data, settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) } }; } catch { return fresh(); }
}
function save(state: Persisted) { try { localStorage.setItem(FOCUS_KEY, JSON.stringify(state)); } catch { /* private mode: the timer runs, it just will not survive a reload */ } }

export function useFocusTimer() {
  const [state, setState] = useState<Persisted>(load);
  const [now, setNow] = useState(() => Date.now());
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => save(state), [state]);
  useEffect(() => { if (state.phase === 'idle') return; setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [state.phase]);
  const settings = state.settings;
  const derived = useMemo(() => {
    const elapsed = state.phase === 'idle' ? 0 : now - state.startedAt;
    if (state.phase === 'eyeRest') { const total = settings.eyeRestSeconds * 1000; return { remainingMs: Math.max(0, total - elapsed), totalMs: total, focusedMs: state.focusedMs }; }
    if (state.phase === 'break') { const total = settings.breakMinutes * 60_000; return { remainingMs: Math.max(0, total - elapsed), totalMs: total, focusedMs: state.focusedMs }; }
    if (state.phase === 'focus') { const total = settings.focusMinutes * 60_000; const focusedMs = state.focusedMs + elapsed; return { remainingMs: Math.max(0, total - focusedMs), totalMs: total, focusedMs }; }
    return { remainingMs: settings.focusMinutes * 60_000, totalMs: settings.focusMinutes * 60_000, focusedMs: state.focusedMs };
  }, [state, settings, now]);
  const nextRestAtMs = state.eyeBaseMs + settings.eyeEveryMinutes * 60_000;
  const eyeRestDue = state.phase === 'focus' && derived.focusedMs >= nextRestAtMs;
  const untilEyeRestMs = Math.max(0, nextRestAtMs - derived.focusedMs);
  // start('focus') resumes a paused session with its banked minutes; start('break') starts a break from zero.
  const start = useCallback((phase: TimerPhase = 'focus') => setState(s => ({ ...s, phase, startedAt: Date.now(), focusedMs: phase === 'focus' ? s.focusedMs : 0, restsTaken: phase === 'focus' ? s.restsTaken : 0, eyeBaseMs: phase === 'focus' ? s.eyeBaseMs : 0 })), []);
  const pause = useCallback(() => setState(s => s.phase === 'idle' ? s : { ...s, phase: 'idle', focusedMs: s.phase === 'focus' ? s.focusedMs + (Date.now() - s.startedAt) : s.focusedMs, startedAt: 0 }), []);
  const reset = useCallback(() => setState(s => ({ ...fresh(), settings: s.settings })), []);
  const beginEyeRest = useCallback(() => setState(s => { const banked = s.phase === 'focus' ? s.focusedMs + (Date.now() - s.startedAt) : s.focusedMs; return { ...s, focusedMs: banked, eyeBaseMs: banked, resumeTo: s.phase === 'focus' ? 'focus' : s.resumeTo, phase: 'eyeRest', startedAt: Date.now(), restsTaken: s.restsTaken + 1 }; }), []);
  const endEyeRest = useCallback(() => setState(s => ({ ...s, phase: s.resumeTo, startedAt: Date.now() })), []);
  const setSettings = useCallback((next: Partial<TimerSettings>) => setState(s => ({ ...s, settings: { ...s.settings, ...next } })), []);
  // Phase ends: an eye rest resumes what it interrupted, focus rolls into a break, a break ends the session.
  useEffect(() => {
    if (state.phase === 'idle' || derived.remainingMs > 0) return;
    if (state.phase === 'eyeRest') endEyeRest(); else if (state.phase === 'focus') start('break'); else if (state.phase === 'break') pause();
  }, [state.phase, derived.remainingMs, endEyeRest, start, pause]);
  return { phase: state.phase, settings, remainingMs: derived.remainingMs, totalMs: derived.totalMs, focusedMs: derived.focusedMs, eyeRestDue, untilEyeRestMs, restsTaken: state.restsTaken, start, pause, reset, beginEyeRest, endEyeRest, setSettings };
}
export function formatClock(ms: number): string { const total = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
