// FocusTimer: the study timer in the top bar of every page, ported from Blueberry's FocusTimer.tsx
// (2026-09-28) without its mascot, decks, ambience and break room. An icon button beside the theme
// button, with the minutes left on a small badge while a session runs, and a card that drops down below
// it when opened. It lived fixed at the bottom right until 2026-09-28 and covered whatever scrolled under
// it (the buy list's Add, say); the top bar has no page under it. It reopens itself when an eye rest is
// due, in the last minute of a phase, and when a phase ends; the rest of the time it stays out of the way.
// An eye rest that falls due starts on its own (the point is to look away, not to be asked). No props.
// Mount from App.tsx with one line, in the top bar's actions: <FocusTimer/>
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eye, Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { formatClock, useFocusTimer, type TimerPhase } from '../../lib/useFocusTimer';
import './focus-timer.css';

const PHASE_LABEL: Record<TimerPhase, string> = { idle: 'Focus', focus: 'Focusing', break: 'Break', eyeRest: 'Look away' };

export function FocusTimer() {
  const t = useFocusTimer();
  const [open, setOpen] = useState(false);
  const lastPhase = useRef(t.phase); const lastMinute = useRef(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // Reopen on the three moments worth interrupting for.
  useEffect(() => { if (t.phase !== lastPhase.current) { lastPhase.current = t.phase; if (t.phase !== 'idle' || t.remainingMs === 0) setOpen(true); } }, [t.phase, t.remainingMs]);
  useEffect(() => { const inLastMinute = t.phase !== 'idle' && t.phase !== 'eyeRest' && t.remainingMs > 0 && t.remainingMs <= 60_000; if (inLastMinute && !lastMinute.current) setOpen(true); lastMinute.current = inLastMinute; }, [t.phase, t.remainingMs]);
  useEffect(() => { if (t.eyeRestDue) t.beginEyeRest(); }, [t.eyeRestDue, t.beginEyeRest]);
  const running = t.phase !== 'idle';
  // The badge: whole minutes left, rounded up so it never reads 0 while time remains; seconds under a minute.
  const left = t.remainingMs >= 60_000 ? `${Math.ceil(t.remainingMs / 60_000)}m` : `${Math.ceil(t.remainingMs / 1000)}s`;
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); } };
  const commit = (key: keyof typeof t.settings) => (event: { target: { value: string } }) => { const n = Math.round(Number(event.target.value)); if (Number.isFinite(n) && n > 0) t.setSettings({ [key]: n }); };
  return <section className={`focus-timer ${open ? 'is-open' : running ? 'is-running' : 'is-idle'} phase-${t.phase}`} aria-label="Focus timer" onKeyDown={keys}>
    <button ref={toggle} type="button" className="icon-button focus-toggle" aria-expanded={open} aria-label={running ? `Focus, ${PHASE_LABEL[t.phase]}, ${formatClock(t.remainingMs)} left` : 'Focus'} title="Focus" onClick={() => setOpen(v => !v)}>
      {t.phase === 'eyeRest' ? <Eye size={17}/> : <Timer size={17}/>}
      {running && <span className="focus-badge" aria-hidden="true">{left}</span>}
    </button>
    {open && <div className="focus-card">
      <div className="focus-clock-big" aria-live={t.phase === 'eyeRest' ? 'polite' : 'off'}><span className="focus-phase">{PHASE_LABEL[t.phase]}</span><strong>{formatClock(t.remainingMs)}</strong>
        {t.phase === 'eyeRest' ? <small>Look at something twenty feet away for twenty seconds.</small> : t.phase === 'focus' ? <small>Next eye rest in {formatClock(t.untilEyeRestMs)}</small> : t.phase === 'break' ? <small>Break. The next focus block waits for you.</small> : <small>{t.focusedMs > 0 ? `${Math.round(t.focusedMs / 60_000)} min banked; Start continues it.` : 'Twenty-five minutes of focus, a rest for the eyes every twenty.'}</small>}
      </div>
      <div className="focus-actions">
        {t.phase === 'idle' ? <button type="button" className="button primary" onClick={() => t.start('focus')}><Play size={14}/>Start focus</button> : <button type="button" className="button" onClick={t.pause}><Pause size={14}/>Pause</button>}
        {t.phase === 'focus' && <button type="button" className="button" onClick={t.beginEyeRest}><Eye size={14}/>Eye rest now</button>}
        {t.phase === 'eyeRest' && <button type="button" className="button" onClick={t.endEyeRest}>Back to it</button>}
        {t.phase === 'idle' && t.focusedMs > 0 && <button type="button" className="button" onClick={() => t.start('break')}>Take a break</button>}
        <button type="button" className="icon-button" aria-label="Reset the timer" title="Reset" onClick={t.reset}><RotateCcw size={14}/></button>
      </div>
      <details className="focus-settings">
        <summary>Settings</summary>
        <div className="focus-settings-grid">
          <label>Focus, minutes<input type="number" min="1" defaultValue={t.settings.focusMinutes} onChange={commit('focusMinutes')}/></label>
          <label>Break, minutes<input type="number" min="1" defaultValue={t.settings.breakMinutes} onChange={commit('breakMinutes')}/></label>
          <label>Eye rest every, minutes<input type="number" min="1" defaultValue={t.settings.eyeEveryMinutes} onChange={commit('eyeEveryMinutes')}/></label>
          <label>Eye rest, seconds<input type="number" min="5" defaultValue={t.settings.eyeRestSeconds} onChange={commit('eyeRestSeconds')}/></label>
        </div>
        <p className="focus-note">Rests taken this session: {t.restsTaken}</p>
      </details>
    </div>}
  </section>;
}
export default FocusTimer;
