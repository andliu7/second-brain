// The sidebar's three modes (Andrew, 2026-09-28: "hiding the side bar away should hide the whole thing in
// a burger icon not just show the icons. or maybe they show and then if you dont hover for some time it
// disappears"). It replaces the icon rail.
//   open:   the full sidebar, always
//   hidden: gone entirely; the burger at the left of the top bar brings it back (to open)
//   auto:   it shows, and once the pointer has been off it for AUTO_HIDE_MS it slides away to the burger.
//           Moving the pointer to the left edge, focusing into it or pressing the burger brings it back.
// Ctrl B toggles open and hidden. The mode lives in this browser; what is on screen now (shown) does not.
// The CSS that draws each mode is src/sidebar.css, keyed on the classes shellClass() returns.
import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

export type SidebarMode = 'open' | 'hidden' | 'auto';
export const SIDEBAR_KEY = 'brain-sidebar-mode';
// The icon rail's key: a browser that had the rail folded opens with the sidebar hidden.
const OLD_KEY = 'brain-sidebar-collapsed';
export const AUTO_HIDE_MS = 2500;

export function readSidebarMode(): SidebarMode {
  try {
    const value = localStorage.getItem(SIDEBAR_KEY);
    if (value === 'open' || value === 'hidden' || value === 'auto') return value;
    return localStorage.getItem(OLD_KEY) === '1' ? 'hidden' : 'open';
  } catch { return 'open'; } // storage blocked: open, for this visit
}

export function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(readSidebarMode);
  // In auto mode, whether it is out right now. Open is always out and hidden never is.
  const [awake, setAwake] = useState(true);
  // Pointer over it and focus inside it are tracked apart: it may only leave when neither holds it.
  const pointer = useRef(false);
  const focus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (mode === 'auto' && !pointer.current && !focus.current) timer.current = setTimeout(() => setAwake(false), AUTO_HIDE_MS);
  }, [mode]);

  // Every change of mode starts it out, and in auto the countdown from there.
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, mode); } catch { /* this visit only */ }
    setAwake(true);
    schedule();
    return () => clearTimeout(timer.current);
  }, [mode, schedule]);

  // The burger and the left edge. Hidden comes back as open, since hidden means "until I ask for it".
  const reveal = () => {
    if (mode === 'hidden') { setMode('open'); return; }
    setAwake(true);
    schedule();
  };
  // Ctrl B. Stable, so App's keydown listener, added once, always calls the current one.
  const toggle = useCallback(() => setMode(m => m === 'open' ? 'hidden' : 'open'), []);

  const hold = (which: typeof pointer) => { which.current = true; clearTimeout(timer.current); setAwake(true); };
  const release = (which: typeof pointer) => { which.current = false; schedule(); };
  const handlers = {
    onPointerEnter: () => hold(pointer),
    onPointerLeave: () => release(pointer),
    onFocus: () => hold(focus),
    // Focus moving between two links inside it is not leaving it.
    onBlur: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release(focus); },
  };

  const shown = mode === 'open' || (mode === 'auto' && awake);
  // sidebar-away is what slides it off and shows the burger; sidebar-<mode> sets how the page makes room.
  const shellClass = `sidebar-${mode}${shown ? '' : ' sidebar-away'}`;
  return { mode, setMode, shown, reveal, toggle, handlers, shellClass };
}
