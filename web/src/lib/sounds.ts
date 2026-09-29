// Short one-shot sounds, synthesised with Web Audio like the ambience beds (lib/ambience.ts): no files.
// Two of them. The chime rings when a focus block ends; the coin is a small reward, offered as the timer's
// end-of-block sound and, through playReward(), for ticking a todo done. The coin is an original synthesis
// of the idea of a coin payout (a bright ching, then a few clinks), not a copy of any game's recording.
//
// Both take the AudioContext to play on. The timer passes the ambience's, which already exists and is
// running; anything else gets one shared context, made on first use. First use is always a click (a tick,
// a button), which is what browsers require before they let a context make sound.
import { useCallback, useState } from 'react';

let shared: AudioContext | null = null;
/** The app's one context for one-shots, or null where there is no Web Audio at all. */
export function sharedContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!shared) shared = new AudioContext();
  void shared.resume();
  return shared;
}

/** One enveloped tone: fast attack, exponential tail, with an optional small pitch rise into the note. */
function tone(ctx: AudioContext, out: AudioNode, opts: { at: number; freq: number; type: OscillatorType; peak: number; decay: number; rise?: number }) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, opts.at);
  env.gain.linearRampToValueAtTime(opts.peak, opts.at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.decay);
  env.connect(out);
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  // Starting a touch flat and sliding up in 30 ms is what makes a strike sound bright rather than dull.
  osc.frequency.setValueAtTime(opts.freq * (1 - (opts.rise ?? 0)), opts.at);
  osc.frequency.exponentialRampToValueAtTime(opts.freq, opts.at + 0.03);
  osc.connect(env);
  osc.start(opts.at);
  osc.stop(opts.at + opts.decay + 0.02);
}

/**
 * The end of a focus block: two soft sines a fifth apart (A5 and E6) with a slow tail, quiet, and pitched
 * above the noise bed so it is heard as a bell rather than as more of the bed.
 */
export function playChime(ctx: AudioContext, volume = 0.5, at = ctx.currentTime) {
  const peak = 0.08 * Math.max(0.3, volume);
  [880, 1318.5].forEach(freq => tone(ctx, ctx.destination, { at, freq, type: 'sine', peak, decay: 2.2 }));
}

/** The coin's length, in seconds, from strike to the last clink's silence. Kept under 0.8. */
export const COIN_SECONDS = 0.78;

/**
 * A coin reward: a bright metallic "ching", then a quick cascade of three to five softer clinks.
 *
 * The ching is two high partials detuned a few cents apart (sine and triangle), whose slow beating is what
 * reads as metal rather than a pure beep. The clinks are smaller coins landing: single short high tones at
 * random pitches and random short gaps, each quieter than the strike. Everything is scheduled on audio
 * time at once and the last stop lands inside COIN_SECONDS.
 */
export function playCoin(ctx: AudioContext | null = sharedContext(), volume = 0.5, at = ctx?.currentTime ?? 0) {
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.value = 0.18 * Math.max(0.3, volume);
  out.connect(ctx.destination);
  tone(ctx, out, { at, freq: 1975.5, type: 'sine', peak: 1, decay: 0.32, rise: 0.06 });
  tone(ctx, out, { at, freq: 1975.5 * 1.006, type: 'triangle', peak: 0.55, decay: 0.26, rise: 0.06 });
  const clinks = 3 + Math.floor(Math.random() * 3);
  let t = at + 0.09;
  for (let i = 0; i < clinks; i++) {
    tone(ctx, out, { at: t, freq: 2800 + Math.random() * 1400, type: 'sine', peak: 0.28 + Math.random() * 0.2, decay: 0.1, rise: 0.03 });
    t += 0.05 + Math.random() * 0.06;
  }
}

/** The reward-sound preference, per browser. On unless turned off. */
export const REWARD_KEY = 'brain_reward_sound_v1';
const rewardOn = () => { try { return localStorage.getItem(REWARD_KEY) !== 'off'; } catch { return true; } };

/** The coin, if the reward sound is on. Reads the preference at call time, so any caller is current. */
export function playReward() { if (rewardOn()) playCoin(); }

/** The preference as React state, for a settings toggle; `play` is playReward. */
export function useRewardSound() {
  const [on, setOnState] = useState(rewardOn);
  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    try { if (next) localStorage.removeItem(REWARD_KEY); else localStorage.setItem(REWARD_KEY, 'off'); } catch { /* private mode: lasts this visit */ }
  }, []);
  return { on, setOn, play: playReward };
}
