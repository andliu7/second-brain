// FocusTimer: the study timer in the top bar of every page, ported from Blueberry's FocusTimer.tsx
// (2026-09-28) without its mascot, decks and break room. An icon button beside the theme
// button, with the minutes left on a small badge while a session runs, and a card that drops down below
// it when opened. It lived fixed at the bottom right until 2026-09-28 and covered whatever scrolled under
// it (the buy list's Add, say); the top bar has no page under it. It reopens itself when an eye rest is
// due, in the last minute of a phase, and when a phase ends; the rest of the time it stays out of the way.
// An eye rest that falls due starts on its own (the point is to look away, not to be asked). No props.
// Mount from App.tsx with one line, in the top bar's actions: <FocusTimer/>
//
// 2026-09-29: ambient sound (lib/ambience.ts) with a small Play button on the card's top row; the sound
// stops the moment a focus block ends, which is the notification. Settings widen the card so their fields
// fit, and hold the end-of-block sound (chime, gold coins, none) and the todo reward toggle (lib/sounds.ts).
// And a Pop out button that moves the clock into an always-on-top window where the browser has the
// Document Picture-in-Picture API (Chrome and Edge 116+); elsewhere the button is not shown.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Music, Pause, PictureInPicture2, Play, RotateCcw, Timer } from 'lucide-react';
import { formatClock, useFocusTimer, type TimerPhase } from '../../lib/useFocusTimer';
import { END_SOUND_LABEL, SOUND_LABEL, useAmbience, type EndSound, type Sound } from '../../lib/ambience';
import { useRewardSound } from '../../lib/sounds';
import './focus-timer.css';

const PHASE_LABEL: Record<TimerPhase, string> = { idle: 'Focus', focus: 'Focusing', break: 'Break', eyeRest: 'Look away' };
/** The card's width with settings open, in px; the compact width lives in the CSS. */
const WIDE = 420;

// Document Picture-in-Picture is not in TypeScript's DOM types yet, so the one call used is typed here.
type PipApi = { requestWindow: (options?: { width?: number; height?: number }) => Promise<Window> };
const pipApi = () => (window as Window & { documentPictureInPicture?: PipApi }).documentPictureInPicture;

// A PiP window starts as a blank document. Copy every stylesheet across so the clock looks the same: rules
// are copied as text where the sheet is readable, and a cross-origin sheet (which refuses to list its
// rules) is linked by URL instead. The theme is data-theme on <html>, so that is copied too.
function copyStyles(from: Document, to: Document) {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
      to.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = to.createElement('link');
      link.rel = 'stylesheet'; link.href = sheet.href;
      to.head.appendChild(link);
    }
  }
  to.documentElement.className = from.documentElement.className;
  if (from.documentElement.dataset.theme) to.documentElement.dataset.theme = from.documentElement.dataset.theme;
}

type TimerState = ReturnType<typeof useFocusTimer>;
type Ambience = ReturnType<typeof useAmbience>;

// The live part: top row, clock, actions. One component so the card and the pop-out window render the same
// thing from the same hooks, which is what keeps the two in step without any syncing code.
function Face({ t, sound, onChooseSound, onPopOut }: { t: TimerState; sound: Ambience; onChooseSound?: () => void; onPopOut?: () => void }) {
  // With no sound chosen, Play opens the settings where the choice is (or does nothing where there are none).
  const onPlay = sound.sound === 'off' ? onChooseSound : sound.toggle;
  return <>
    <div className="focus-top">
      <span className="focus-phase">{PHASE_LABEL[t.phase]}</span>
      <button type="button" className={`focus-chip${sound.playing ? ' is-on' : ''}`} aria-label={sound.playing ? 'Pause sound' : 'Play sound'} title={sound.sound === 'off' ? 'Choose a sound in Settings' : SOUND_LABEL[sound.sound]} disabled={!onPlay} onClick={onPlay}><Music size={13}/>{sound.playing ? 'Pause' : 'Play'}</button>
      {onPopOut && <button type="button" className="focus-chip" aria-label="Pop out" title="Keep the timer on top in its own window" onClick={onPopOut}><PictureInPicture2 size={13}/></button>}
    </div>
    <div className="focus-clock-big" aria-live={t.phase === 'eyeRest' ? 'polite' : 'off'}><strong>{formatClock(t.remainingMs)}</strong>
      {t.phase === 'eyeRest' ? <small>Look at something twenty feet away for twenty seconds.</small> : t.phase === 'focus' ? <small>Next eye rest in {formatClock(t.untilEyeRestMs)}</small> : t.phase === 'break' ? <small>Break. The next focus block waits for you.</small> : <small>{t.focusedMs > 0 ? `${Math.round(t.focusedMs / 60_000)} min banked; Start continues it.` : 'Twenty-five minutes of focus, a rest for the eyes every twenty.'}</small>}
    </div>
    <div className="focus-actions">
      {t.phase === 'idle' ? <button type="button" className="button primary" onClick={() => t.start('focus')}><Play size={14}/>Start focus</button> : <button type="button" className="button" onClick={t.pause}><Pause size={14}/>Pause</button>}
      {t.phase === 'focus' && <button type="button" className="button" onClick={t.beginEyeRest}><Eye size={14}/>Eye rest now</button>}
      {t.phase === 'eyeRest' && <button type="button" className="button" onClick={t.endEyeRest}>Back to it</button>}
      {t.phase === 'idle' && t.focusedMs > 0 && <button type="button" className="button" onClick={() => t.start('break')}>Take a break</button>}
      <button type="button" className="icon-button" aria-label="Reset the timer" title="Reset" onClick={t.reset}><RotateCcw size={14}/></button>
    </div>
  </>;
}

export function FocusTimer() {
  const t = useFocusTimer();
  const sound = useAmbience();
  const reward = useRewardSound();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const [pip, setPip] = useState<Window | null>(null);
  const lastPhase = useRef(t.phase); const lastMinute = useRef(false); const phaseBefore = useRef(t.phase);
  const toggle = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Reopen on the three moments worth interrupting for.
  useEffect(() => { if (t.phase !== lastPhase.current) { lastPhase.current = t.phase; if (t.phase !== 'idle' || t.remainingMs === 0) setOpen(true); } }, [t.phase, t.remainingMs]);
  useEffect(() => { const inLastMinute = t.phase !== 'idle' && t.phase !== 'eyeRest' && t.remainingMs > 0 && t.remainingMs <= 60_000; if (inLastMinute && !lastMinute.current) setOpen(true); lastMinute.current = inLastMinute; }, [t.phase, t.remainingMs]);
  useEffect(() => { if (t.eyeRestDue) t.beginEyeRest(); }, [t.eyeRestDue, t.beginEyeRest]);
  // A focus block is over when focus (or an eye rest inside it) turns into a break or idle: run out, paused
  // or reset. That is when the sound stops, as the cue; an eye rest starting or ending is not an end.
  useEffect(() => { const was = phaseBefore.current; phaseBefore.current = t.phase; if ((was === 'focus' || was === 'eyeRest') && (t.phase === 'break' || t.phase === 'idle')) sound.finish(); }, [t.phase, sound.finish]);
  // Closing the page (or this component) closes the pop-out with it; the effect's cleanup is the hook for that.
  useEffect(() => () => pip?.close(), [pip]);
  const running = t.phase !== 'idle';
  // The badge: whole minutes left, rounded up so it never reads 0 while time remains; seconds under a minute.
  const left = t.remainingMs >= 60_000 ? `${Math.ceil(t.remainingMs / 60_000)}m` : `${Math.ceil(t.remainingMs / 1000)}s`;
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); } };
  const commit = (key: keyof typeof t.settings) => (event: { target: { value: string } }) => { const n = Math.round(Number(event.target.value)); if (Number.isFinite(n) && n > 0) t.setSettings({ [key]: n }); };
  // Settings widen the card. It is anchored by its right edge under the button, so plain widening grows it
  // leftward; to grow rightward as asked, the right edge is pulled out by however much room the viewport has
  // on that side (16px kept clear), and the rest of the growth goes left. The top bar button sits near the
  // right edge, so in practice it is mostly leftward, and it never leaves the screen.
  const toggleSettings = () => {
    if (!settingsOpen && card.current) { const box = card.current.getBoundingClientRect(); const room = Math.max(0, window.innerWidth - box.right - 16); setShift(Math.min(room, Math.max(0, Math.min(WIDE, window.innerWidth - 32) - box.width))); }
    setSettingsOpen(v => !v);
  };
  const chooseSound = () => { setOpen(true); if (!settingsOpen) toggleSettings(); };
  const popOut = async () => {
    const api = pipApi(); if (!api) return;
    const win = await api.requestWindow({ width: 320, height: 220 });
    copyStyles(document, win.document);
    // The user closing the window is the only way back; pagehide is the event it fires as it goes.
    win.addEventListener('pagehide', () => setPip(null), { once: true });
    setPip(win);
  };
  return <section className={`focus-timer ${open ? 'is-open' : running ? 'is-running' : 'is-idle'} phase-${t.phase}`} aria-label="Focus timer" onKeyDown={keys}>
    <button ref={toggle} type="button" className="icon-button focus-toggle" aria-expanded={open} aria-label={running ? `Focus, ${PHASE_LABEL[t.phase]}, ${formatClock(t.remainingMs)} left` : 'Focus'} title="Focus" onClick={() => setOpen(v => !v)}>
      {t.phase === 'eyeRest' ? <Eye size={17}/> : <Timer size={17}/>}
      {running && <span className="focus-badge" aria-hidden="true">{left}</span>}
    </button>
    {open && <div ref={card} className={`focus-card${settingsOpen ? ' is-wide' : ''}`} style={{ '--focus-shift': `${shift}px` } as CSSProperties}>
      {pip ? <div className="focus-away"><p className="focus-note">The timer is in its own window.</p><button type="button" className="button" onClick={() => pip.close()}>Bring it back</button></div>
        : <Face t={t} sound={sound} onChooseSound={chooseSound} onPopOut={pipApi() ? popOut : undefined}/>}
      {/* Controlled rather than native toggling: the card's width follows this state, and a test can drive it. */}
      <details className="focus-settings" open={settingsOpen}>
        <summary onClick={event => { event.preventDefault(); toggleSettings(); }}>Settings</summary>
        <div className="focus-settings-grid">
          <label>Focus, minutes<input type="number" min="1" defaultValue={t.settings.focusMinutes} onChange={commit('focusMinutes')}/></label>
          <label>Break, minutes<input type="number" min="1" defaultValue={t.settings.breakMinutes} onChange={commit('breakMinutes')}/></label>
          <label>Eye rest every, minutes<input type="number" min="1" defaultValue={t.settings.eyeEveryMinutes} onChange={commit('eyeEveryMinutes')}/></label>
          <label>Eye rest, seconds<input type="number" min="5" defaultValue={t.settings.eyeRestSeconds} onChange={commit('eyeRestSeconds')}/></label>
          <label>Sound<select value={sound.sound} onChange={event => sound.setSound(event.target.value as Sound)}>{(Object.keys(SOUND_LABEL) as Sound[]).map(key => <option key={key} value={key}>{SOUND_LABEL[key]}</option>)}</select></label>
          <label>Volume<input type="range" min="0" max="1" step="0.05" value={sound.volume} onChange={event => sound.setVolume(Number(event.target.value))}/></label>
          <label>When focus ends<select value={sound.endSound} onChange={event => sound.setEndSound(event.target.value as EndSound)}>{(Object.keys(END_SOUND_LABEL) as EndSound[]).map(key => <option key={key} value={key}>{END_SOUND_LABEL[key]}</option>)}</select></label>
          <label className="focus-check"><input type="checkbox" checked={reward.on} onChange={event => reward.setOn(event.target.checked)}/>Coins when a todo is done</label>
        </div>
        <p className="focus-note">Rests taken this session: {t.restsTaken}</p>
      </details>
    </div>}
    {/* A portal renders into another DOM node (here, another window's body) while staying in this React
        tree, so the pop-out shares these hooks and state and updates on the same renders as the card. */}
    {pip && createPortal(<div className={`focus-timer focus-pip phase-${t.phase}`}><Face t={t} sound={sound}/></div>, pip.document.body)}
  </section>;
}
export default FocusTimer;
