// Compose: the chat composer, from the component Andrew pasted (2026-09-27), rebuilt on the app's tokens.
// Type @ to mention a file or skill (attached as context), / to call a skill. Props:
//   value / defaultValue / onChange: controlled or uncontrolled text
//   onSubmit(text): Send, or Ctrl+Enter (Cmd on a Mac)
//   mentions, commands: what @ and / offer; onMention(m) and onCommand(c) fire when one is inserted
//   placeholder, maxLength, submitLabel, autoFocus, disabled, submitDisabled, className, aria-label
// Additions to the pasted component: onMention, disabled, submitDisabled, and the app's colours (the
// original was zinc on white with a .dark variant this app never sets). The picker is a listbox the
// textarea controls as a combobox; motion is framer-motion's and switches off under reduced motion.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Send } from 'lucide-react';
import './compose.css';

export type ComposeMention = { id: string; label: string; sublabel?: string; avatar?: string };
export type ComposeCommand = { id: string; label: string; hint?: string; icon?: ReactNode };
export type ComposeProps = {
  value?: string; defaultValue?: string; onChange?: (value: string) => void; onSubmit?: (value: string) => void;
  onCommand?: (command: ComposeCommand) => void; onMention?: (mention: ComposeMention) => void;
  mentions?: ComposeMention[]; commands?: ComposeCommand[]; placeholder?: string; maxLength?: number; submitLabel?: string;
  autoFocus?: boolean; disabled?: boolean; submitDisabled?: boolean; className?: string; 'aria-label'?: string;
};
type Trigger = { type: '@' | '/'; start: number; query: string };

const CARET_PROPS = ['boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'wordBreak'] as const;

// Where the caret is inside the textarea, measured on a hidden mirror so the picker can sit under it.
function caretCoords(el: HTMLTextAreaElement, pos: number) {
  const mirror = document.createElement('div'); const s = mirror.style; const cs = window.getComputedStyle(el);
  s.position = 'absolute'; s.visibility = 'hidden'; s.whiteSpace = 'pre-wrap'; s.wordWrap = 'break-word'; s.top = '0'; s.left = '-9999px';
  for (const p of CARET_PROPS) s[p] = cs[p];
  s.height = 'auto'; s.overflow = 'hidden';
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement('span'); marker.textContent = el.value.slice(pos) || '.'; mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const x = marker.offsetLeft; const y = marker.offsetTop;
  document.body.removeChild(mirror);
  return { x, y, lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 };
}

// The @ or / word the caret is in, if it starts a word.
export function detectTrigger(text: string, caret: number): Trigger | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@' || ch === '/') {
      if (i === 0 || /\s/.test(text[i - 1])) { const query = text.slice(i + 1, caret); if (!/\s/.test(query)) return { type: ch, start: i, query }; }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
type Seg = { text: string; kind: 'text' | 'mention' | 'command' };
// Splits the text into plain runs and known @mention / /command tokens, so the backdrop can highlight them.
export function segment(text: string, mentionForms: string[], commandForms: string[]): Seg[] {
  const forms = [...mentionForms.map(f => ({ f, kind: 'mention' as const })), ...commandForms.map(f => ({ f, kind: 'command' as const }))].sort((a, b) => b.f.length - a.f.length);
  if (!forms.length) return [{ text, kind: 'text' }];
  const kindOf = new Map(forms.map(x => [x.f, x.kind]));
  const re = new RegExp(`(${forms.map(x => escapeRe(x.f)).join('|')})(?=$|[^\\w])`, 'g');
  const out: Seg[] = []; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const prev = m.index === 0 ? '' : text[m.index - 1];
    if (prev && /\w/.test(prev)) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: 'text' });
    out.push({ text: m[0], kind: kindOf.get(m[0]) ?? 'mention' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'text' });
  return out.length ? out : [{ text, kind: 'text' }];
}

export function Compose({ value, defaultValue = '', onChange, onSubmit, onCommand, onMention, mentions = [], commands = [], placeholder = 'Write a message. @ to mention, / for commands', maxLength, submitLabel = 'Send', autoFocus = false, disabled = false, submitDisabled = false, className, 'aria-label': ariaLabel = 'Message' }: ComposeProps) {
  const uid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const taRef = useRef<HTMLTextAreaElement>(null); const backdropRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null); const flashTimer = useRef<number | null>(null);
  const [internal, setInternal] = useState(defaultValue);
  const text = value ?? internal;
  useEffect(() => { if (autoFocus && taRef.current) { const ta = taRef.current; const end = ta.value.length; ta.focus(); ta.setSelectionRange(end, end); } }, [autoFocus]);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [menu, setMenu] = useState({ x: 0, top: 0, bottom: 0, flip: false });
  const [active, setActive] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const mentionForms = useMemo(() => mentions.map(m => '@' + m.label), [mentions]);
  const commandForms = useMemo(() => commands.map(c => '/' + c.label), [commands]);
  const segs = useMemo(() => segment(text, mentionForms, commandForms), [text, mentionForms, commandForms]);
  const popIndex = useMemo(() => flash ? segs.findIndex(s => s.kind !== 'text' && s.text.trim() === flash) : -1, [segs, flash]);
  const results = useMemo<(ComposeMention | ComposeCommand)[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return trigger.type === '@' ? mentions.filter(m => m.label.toLowerCase().includes(q)).slice(0, 6) : commands.filter(c => c.label.toLowerCase().includes(q)).slice(0, 6);
  }, [trigger, mentions, commands]);
  const setText = useCallback((next: string) => { if (value === undefined) setInternal(next); onChange?.(next); }, [value, onChange]);
  // Escape closes the picker on keydown; without this the keyup that follows would re-detect the same
  // word and reopen it. A dismissed word stays closed until its query changes (typing on reopens it).
  const dismissed = useRef<{ start: number; query: string } | null>(null);
  const refreshTrigger = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    const caret = ta.selectionStart ?? 0; const found = detectTrigger(ta.value, caret);
    if (found && dismissed.current && dismissed.current.start === found.start && dismissed.current.query === found.query) { setTrigger(null); return; }
    dismissed.current = null;
    const t = found; setTrigger(t);
    if (t) {
      const c = caretCoords(ta, caret); const caretLineTop = c.y - ta.scrollTop; const rect = ta.getBoundingClientRect();
      const flip = window.innerHeight - (rect.top + caretLineTop + c.lineHeight) < 252 && caretLineTop > 120;
      setMenu({ x: c.x - ta.scrollLeft, top: caretLineTop + c.lineHeight + 6, bottom: ta.offsetHeight - caretLineTop + 6, flip }); setActive(0);
    }
  }, []);
  useLayoutEffect(() => { if (pendingCaret.current != null && taRef.current) { const pos = pendingCaret.current; pendingCaret.current = null; taRef.current.focus(); taRef.current.setSelectionRange(pos, pos); refreshTrigger(); } }, [text, refreshTrigger]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  const insert = useCallback((choice: ComposeMention | ComposeCommand) => {
    const ta = taRef.current; if (!ta || !trigger) return;
    const caret = ta.selectionStart ?? 0; const token = trigger.type + choice.label;
    pendingCaret.current = trigger.start + token.length + 1;
    setText(ta.value.slice(0, trigger.start) + token + ' ' + ta.value.slice(caret)); setTrigger(null); setFlash(token);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 480);
    if (trigger.type === '/') onCommand?.(choice as ComposeCommand); else onMention?.(choice as ComposeMention);
  }, [trigger, setText, onCommand, onMention]);
  const NAV_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];
  const onKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (trigger && results.length && NAV_KEYS.includes(e.key)) return; refreshTrigger(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && results.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % results.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + results.length) % results.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(results[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); dismissed.current = { start: trigger.start, query: trigger.query }; setTrigger(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };
  const overLimit = maxLength != null && text.length > maxLength;
  const canSend = Boolean(text.trim()) && !overLimit && !disabled && !submitDisabled;
  const submit = () => { if (canSend) onSubmit?.(text); };
  const open = Boolean(trigger && results.length);
  return <div className={['compose-root', className ?? ''].join(' ')}>
    <div aria-hidden="true" className="compose-ring"/>
    <div className="compose-card">
      <div className="compose-field">
        <div ref={backdropRef} aria-hidden="true" className="compose-backdrop">
          {segs.map((s, i) => s.kind === 'text' ? <span key={i}>{s.text}</span> : <span key={i} className={['compose-token', i === popIndex ? 'compose-pop' : ''].join(' ')}>{s.text}</span>)}{'\n'}
        </div>
        <textarea ref={taRef} value={text} rows={3} maxLength={maxLength} placeholder={placeholder} aria-label={ariaLabel} role="combobox" aria-expanded={open} aria-controls={`${uid}-list`} aria-activedescendant={open ? `${uid}-opt-${active}` : undefined} aria-autocomplete="list" spellCheck disabled={disabled}
          onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onClick={refreshTrigger}
          onScroll={e => { if (backdropRef.current) { backdropRef.current.scrollTop = e.currentTarget.scrollTop; backdropRef.current.scrollLeft = e.currentTarget.scrollLeft; } }}
          onBlur={() => setTimeout(() => setTrigger(null), 120)} className="compose-textarea compose-scroll"/>
        <AnimatePresence>
          {open && trigger && <motion.ul key="picker" id={`${uid}-list`} role="listbox" aria-label={trigger.type === '@' ? 'Files and skills to attach' : 'Skills to call'}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: menu.flip ? 6 : -6, scale: 0.97 }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: menu.flip ? 4 : -4, scale: 0.98 }} transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 620, damping: 36, mass: 0.6 }}
            className="compose-picker compose-scroll panel" style={{ left: Math.max(8, menu.x), transformOrigin: menu.flip ? 'bottom left' : 'top left', ...(menu.flip ? { bottom: menu.bottom } : { top: menu.top }) }}>
            {results.map((r, i) => { const on = i === active; const m = r as ComposeMention; const c = r as ComposeCommand; return <li key={r.id} role="option" id={`${uid}-opt-${i}`} aria-selected={on} className="compose-option">
              {on && <motion.div layoutId={`${uid}-hl`} className="compose-highlight" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 650, damping: 40, mass: 0.5 }}/>}
              <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); insert(r); }}>
                {trigger.type === '@' ? <Avatar mention={m}/> : <span className="compose-glyph">{c.icon ?? <span className="compose-slash">/</span>}</span>}
                <span className="compose-option-text"><span className="compose-option-label">{r.label}</span>{(trigger.type === '@' ? m.sublabel : c.hint) && <span className="compose-option-sub">{trigger.type === '@' ? m.sublabel : c.hint}</span>}</span>
                <span className="compose-enter" data-on={on || undefined}><Kbd>Enter</Kbd></span>
              </button>
            </li>; })}
          </motion.ul>}
        </AnimatePresence>
      </div>
      <div className="compose-foot">
        <div className="compose-hints"><Kbd>@</Kbd><span>attach a file or skill</span><span className="compose-dot">·</span><Kbd>/</Kbd><span>call a skill</span></div>
        <div className="compose-actions">
          {maxLength != null && text.length > 0 && <CounterRing value={text.length} max={maxLength}/>}
          <button type="button" className="button primary compose-send" onClick={submit} disabled={!canSend}><Send size={14} aria-hidden="true"/>{submitLabel}<span className="compose-send-keys" aria-hidden="true"><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></span></button>
        </div>
      </div>
    </div>
  </div>;
}

function CounterRing({ value, max }: { value: number; max: number }) {
  const pct = Math.min(1, value / max); const r = 7; const circ = 2 * Math.PI * r;
  const tone = value > max ? 'var(--red)' : value >= max * 0.8 ? 'var(--amber)' : 'var(--mut)';
  return <span className="compose-counter" aria-label={`${max - value} characters left`}>
    {value / max >= 0.86 && <span style={{ color: tone }}>{max - value}</span>}
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" stroke="var(--line)"/><circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" stroke={tone} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} style={{ transition: 'stroke-dashoffset .25s ease, stroke .25s ease' }}/></svg>
  </span>;
}
function Avatar({ mention }: { mention: ComposeMention }) {
  if (mention.avatar) return <img src={mention.avatar} alt="" aria-hidden="true" className="compose-avatar"/>;
  const parts = mention.label.trim().split(/\s+/);
  const initials = (parts.length === 1 ? parts[0].slice(0, 2) : parts.slice(0, 2).map(w => w[0]).join('')).toUpperCase();
  return <span className="compose-avatar compose-initials" aria-hidden="true">{initials}</span>;
}
const Kbd = ({ children }: { children: ReactNode }) => <kbd className="compose-kbd">{children}</kbd>;
export default Compose;
