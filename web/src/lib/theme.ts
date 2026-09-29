// Light, dark, or follow the system. The choice lives in this browser under THEME_KEY; the theme itself is
// data-theme on <html>, which every colour in the CSS reads through its tokens. index.html runs the same
// resolve step inline before the first paint so a dark-mode reload never flashes light; this module takes
// over once React is up and keeps the top bar button and Settings in step.
import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'brain-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readPref(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; } // storage blocked (a private window): follow the system
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
export const resolve = (pref: ThemePref): Theme => pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;

// The .dark class is for the Tailwind-scoped chat composer (index.css), which keys its night tokens off it.
function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
}

const listeners = new Set<() => void>();
let pref: ThemePref = typeof window === 'undefined' ? 'system' : readPref();

export function setThemePref(next: ThemePref) {
  pref = next;
  try { if (next === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* still applied for this visit */ }
  apply(resolve(next));
  listeners.forEach(fn => fn());
}

// One matchMedia listener for the whole app: when following the system, a change of OS theme re-applies.
if (typeof window !== 'undefined' && typeof matchMedia === 'function') {
  matchMedia(DARK_QUERY).addEventListener?.('change', () => { if (pref === 'system') { apply(resolve('system')); listeners.forEach(fn => fn()); } });
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
// The snapshot is the pair as one string, so React compares it by value and re-renders only on a real change.
const snapshot = () => `${pref}:${resolve(pref)}`;

// useSyncExternalStore is React's hook for reading a value that lives outside React (here the module-level
// preference), so every component that calls useTheme re-renders together when it changes.
export function useTheme() {
  const [p, t] = useSyncExternalStore(subscribe, snapshot, () => 'system:light').split(':') as [ThemePref, Theme];
  return { pref: p, theme: t, setPref: setThemePref };
}
