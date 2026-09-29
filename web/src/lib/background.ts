// The light theme's moving background: Animated or Still, and when animated Calm (24s a hue cycle) or Lively
// (5s, the pace of the 21st.dev original). Both choices live in this browser and reach the CSS as data-bg and
// data-bg-speed on <html>; components/ui/gradient-background.css reads them. index.html runs the same steps
// inline before the first paint, so a reload never shows a frame of the wrong background; this module takes
// over once React is up, the way lib/theme.ts does for the theme.
import { useSyncExternalStore } from 'react';

export type BgMotion = 'animated' | 'still';
export type BgSpeed = 'calm' | 'lively';
export const BG_MOTION_KEY = 'brain-bg-motion';
export const BG_SPEED_KEY = 'brain-bg-speed';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

// What goes on <html>. Reduced motion always wins, and so does a browser that cannot register the hue
// properties (CSS.registerProperty ships with @property): there the keyframes would jump, not glide.
// The inline script in index.html is this function written out by hand; background.test.tsx runs both.
export function backgroundAttrs(motion: BgMotion, speed: BgSpeed, reducedMotion: boolean, canAnimate: boolean) {
  return { bg: motion === 'animated' && !reducedMotion && canAnimate ? 'animated' : 'still', speed } as const;
}

function read<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return values.includes(value as T) ? value as T : fallback;
  } catch { return fallback; } // storage blocked (a private window): the defaults
}
export const readMotion = () => read<BgMotion>(BG_MOTION_KEY, ['animated', 'still'], 'animated');
export const readSpeed = () => read<BgSpeed>(BG_SPEED_KEY, ['calm', 'lively'], 'calm');

const reduced = () => typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;
const canAnimate = () => typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function';

function apply() {
  const { bg, speed: s } = backgroundAttrs(motion, speed, reduced(), canAnimate());
  document.documentElement.dataset.bg = bg;
  document.documentElement.dataset.bgSpeed = s;
}

const listeners = new Set<() => void>();
let motion: BgMotion = typeof window === 'undefined' ? 'animated' : readMotion();
let speed: BgSpeed = typeof window === 'undefined' ? 'calm' : readSpeed();

export function setBackground(next: { motion?: BgMotion; speed?: BgSpeed }) {
  motion = next.motion ?? motion;
  speed = next.speed ?? speed;
  try { localStorage.setItem(BG_MOTION_KEY, motion); localStorage.setItem(BG_SPEED_KEY, speed); } catch { /* still applied for this visit */ }
  apply();
  listeners.forEach(fn => fn());
}

// A hidden tab has nothing to paint, so the hue stops there and resumes where it was when the tab comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.documentElement.toggleAttribute('data-bg-paused', document.hidden));
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const snapshot = () => `${motion}:${speed}`;

// The same useSyncExternalStore pattern as useTheme: a value that lives outside React, read by every control.
export function useBackground() {
  const [m, s] = useSyncExternalStore(subscribe, snapshot, () => 'animated:calm').split(':') as [BgMotion, BgSpeed];
  return { motion: m, speed: s, setBackground };
}
