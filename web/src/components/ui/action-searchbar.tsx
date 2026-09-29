// ActionSearchbar: one input that lists commands as you focus it and narrows them as you type, from the
// component Andrew pasted (2026-09-25), rebuilt on the app's tokens and made a real combobox. Props:
//   actions: the commands; each has an id, a label, an icon, and optional description, short (a key hint)
//     and end (a right-aligned tag, such as "Page" or "Run")
//   onSelect(action): a command was chosen (click, or Enter on the highlighted row)
//   onSubmit(query): Enter with text that matches no command; the caller searches with it
//   onHighlight(action): optional; the highlighted row changed (arrows or the pointer). App preloads
//     the page a "go:" command opens, so it is ready by the time Enter or a click picks it
//   placeholder, label: the input's placeholder and accessible name
// The list opens on focus and closes on blur or Escape; arrows move the highlight; Enter picks. Motion
// is framer-motion's and switches off under prefers-reduced-motion.
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchAction = { id: string; label: string; icon: ReactNode; description?: string; short?: string; end?: string };

function useDebounce<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

export function ActionSearchbar({ actions, onSelect, onSubmit, onHighlight, placeholder = 'Search or run a command', label = 'Search or run a command', className }: { actions: SearchAction[]; onSelect: (action: SearchAction) => void; onSubmit: (query: string) => void; onHighlight?: (action: SearchAction) => void; placeholder?: string; label?: string; className?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounce(query);
  const reduced = useReducedMotion();
  const listId = useId();
  const needle = debounced.trim().toLowerCase();
  const shown = needle ? actions.filter(action => `${action.label} ${action.description || ''}`.toLowerCase().includes(needle)) : actions;
  useEffect(() => { setActive(0); }, [needle]);
  const highlighted = open ? shown[active] : undefined;
  useEffect(() => { if (highlighted) onHighlight?.(highlighted); }, [highlighted?.id]);
  const choose = (action: SearchAction) => { setOpen(false); setQuery(''); onSelect(action); };
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(i => Math.min(shown.length - 1, i + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (open && shown[active] && (needle || !query.trim())) choose(shown[active]); else if (query.trim()) { setOpen(false); onSubmit(query.trim()); setQuery(''); } }
  }
  const panel = reduced ? {} : { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto', transition: { height: { duration: 0.25 }, staggerChildren: 0.04 } }, exit: { opacity: 0, height: 0, transition: { duration: 0.18 } } };
  const row = reduced ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };
  return <div className={cn('action-search', className)}>
    <div className="action-search-field">
      <input role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined} aria-autocomplete="list" placeholder={placeholder} value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={keys}/>
      <span className="action-search-glyph" aria-hidden="true">{query ? <Send size={14}/> : <Search size={14}/>}</span>
    </div>
    <AnimatePresence>
      {open && <motion.div className="action-search-panel panel" {...panel}>
        <ul role="listbox" id={listId} aria-label="Commands">
          {shown.map((action, i) => <motion.li key={action.id} id={`${listId}-${action.id}`} role="option" aria-selected={i === active} className="action-search-item" data-active={i === active || undefined} onMouseDown={event => event.preventDefault()} onClick={() => choose(action)} onMouseEnter={() => setActive(i)} {...row}>
            <span className="action-search-icon" aria-hidden="true">{action.icon}</span>
            <span className="action-search-label">{action.label}</span>
            {action.description && <span className="action-search-desc">{action.description}</span>}
            {action.short && <kbd>{action.short}</kbd>}
            {action.end && <span className="action-search-end">{action.end}</span>}
          </motion.li>)}
          {!shown.length && <li className="action-search-item action-search-empty" role="option" aria-selected={false} onMouseDown={event => event.preventDefault()} onClick={() => { if (query.trim()) { setOpen(false); onSubmit(query.trim()); setQuery(''); } }}><span className="action-search-icon" aria-hidden="true"><Search size={14}/></span><span className="action-search-label">Search everything for "{query.trim()}"</span><span className="action-search-end">Enter</span></li>}
        </ul>
        <div className="action-search-foot"><span>Enter picks the highlighted command, or searches the text</span><span>Esc closes</span></div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
