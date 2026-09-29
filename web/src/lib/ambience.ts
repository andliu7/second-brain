// Background sound for the focus timer, synthesised with Web Audio rather than played from files. Ported
// (2026-09-29) from Blueberry's src/lib/useAmbience.ts, same author, without its Spotify playlists, and with
// two beds added: brown noise and fire. Copied rather than imported: the two repos do not depend on each other.
//
// Why synthesise: there is no loop point, so there is no seam to hide, nothing to download, no library and
// no account. The one place a repeat could creep in is the noise buffers (generating noise per sample in
// JavaScript all session would be wasteful), so each bed runs *two* buffers of coprime length, 19 and 23
// seconds, played together. Their sum only repeats every 437 seconds, and the filters moving over the top
// ride slow oscillators that share no period with either. Nothing lines up twice inside a focus block.
//
// The sound is chosen in the timer's settings and started by its own Play button, independent of the clock.
// When a focus block ends the timer calls finish(): the sound stops at once, and if it was playing the chosen
// end sound follows (a soft chime, gold coins, or nothing), so the silence itself is the cue that focus is over.
import { useCallback, useEffect, useRef, useState } from 'react';
import { playChime, playCoin } from './sounds';

export type Sound = 'off' | 'white' | 'brown' | 'rain' | 'fire';
export const SOUND_LABEL: Record<Sound, string> = { off: 'Off', white: 'White noise', brown: 'Brown noise', rain: 'Rainforest', fire: 'Fire' };
export const AMBIENCE_KEY = 'brain_ambience_v1';
export type EndSound = 'chime' | 'coins' | 'none';
export const END_SOUND_LABEL: Record<EndSound, string> = { chime: 'Soft chime', coins: 'Gold coins', none: 'None' };

/** Coprime, so the two layers do not come round together for over seven minutes. */
const BUFFER_SECONDS = [19, 23];
/** Seconds. In is slow so a bed never starts with a jolt; out is short because the stop is the signal. */
const FADE_IN = 0.9;
const FADE_OUT = 0.25;

type Colour = 'white' | 'pink' | 'brown';

/**
 * Fills a buffer with noise.
 *
 * `pink` runs white noise through Paul Kellet's economical approximation, a bank of one-pole filters summed.
 * Pink falls at 3 dB per octave, roughly how rain and wind sound; flat white noise is much brighter than
 * anything in nature and tires the ear within minutes, the opposite of what a focus timer wants.
 *
 * `brown` integrates white noise (a leaky running sum), which falls at 6 dB per octave: the deep, rumbling
 * one. A running sum ends the buffer somewhere other than where it began, and a loop that jumps between the
 * two is a click every 19 seconds. So the drift is taken out with a straight line from the last sample back
 * to the first, which makes the two ends meet and keeps the no-seam promise the other colours get for free.
 */
function noiseBuffer(ctx: AudioContext, seconds: number, colour: Colour): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, walk = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (colour === 'white') { data[i] = white * 0.5; continue; }
    if (colour === 'brown') { walk = (walk + 0.02 * white) / 1.02; data[i] = walk * 3.5; continue; }
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
    b6 = white * 0.115926;
  }
  if (colour === 'brown' && length > 1) {
    const drift = data[length - 1] - data[0];
    for (let i = 0; i < length; i++) data[i] -= drift * (i / (length - 1));
  }
  return buffer;
}

/** One running layer of a scene. `at` is audio time, so a stop lands exactly where the fade ends. */
interface Voice { stop: (at: number) => void }

const stopAt = (node: AudioScheduledSourceNode, at: number) => { try { node.stop(at); } catch { /* already stopped */ } };

/** The two noise layers plus a slowly wandering low-pass, shared by every scene. */
function bed(ctx: AudioContext, out: AudioNode, opts: { colour: Colour; cutoff: number; sweep: number; gain: number }): Voice {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.cutoff;
  filter.Q.value = 0.4;
  const level = ctx.createGain();
  level.gain.value = opts.gain;
  filter.connect(level).connect(out);

  const sources = BUFFER_SECONDS.map(seconds => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, seconds, opts.colour);
    src.loop = true;
    // Detuning each layer slightly means the two never sit in lockstep even where their lengths align.
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.02;
    src.connect(filter);
    src.start();
    return src;
  });

  // The filter breathes. Two oscillators at incommensurable rates rather than one: a single sine on the
  // cutoff is a recognisable "wah" within a minute; two slow ones beating read as air moving.
  const lfos = [{ rate: 0.017, depth: opts.sweep }, { rate: 0.0413, depth: opts.sweep * 0.45 }].map(({ rate, depth }) => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(filter.frequency);
    lfo.start();
    return lfo;
  });

  return { stop: at => { sources.forEach(s => stopAt(s, at)); lfos.forEach(l => stopAt(l, at)); } };
}

/**
 * Short filtered noise bursts on a random schedule: raindrops on leaves, or a fire's pops.
 *
 * Each burst is bandpassed noise with a fast decay. What makes it read as a forest or a hearth rather than
 * clicks is that interval, pitch and loudness are randomised per burst, and bursts are scheduled two seconds
 * ahead rather than fired from a timer, so they land on exact audio time whenever the main thread gets round.
 */
function bursts(ctx: AudioContext, out: AudioNode, opts: { low: number; spread: number; q: [number, number]; peak: [number, number]; length: [number, number]; gap: [number, number] }): Voice {
  let stopped = false;
  let nextAt = ctx.currentTime + 0.2;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pick = ([min, max]: [number, number]) => min + Math.random() * (max - min);

  const one = (at: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.09, 'white');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = opts.low + Math.random() * opts.spread;
    band.Q.value = pick(opts.q);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(pick(opts.peak), at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + pick(opts.length));
    // Spread across the field so the scene has width.
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(band).connect(env).connect(pan).connect(out);
    src.start(at);
    src.stop(at + 0.4);
  };

  const schedule = () => {
    if (stopped) return;
    while (nextAt < ctx.currentTime + 2) { one(nextAt); nextAt += pick(opts.gap); }
    timer = setTimeout(schedule, 900);
  };
  schedule();

  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}

/**
 * A fire's glow: the bed under it rises and sags. Two oscillators on a gain, at rates that share no period,
 * so the swell never settles into a pulse. Slow enough (under one hertz) to read as flicker, not tremolo.
 */
function flicker(ctx: AudioContext, out: AudioNode): { input: AudioNode; voice: Voice } {
  const swell = ctx.createGain();
  swell.gain.value = 0.75;
  swell.connect(out);
  const lfos = [{ rate: 0.31, depth: 0.12 }, { rate: 0.87, depth: 0.07 }].map(({ rate, depth }) => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(swell.gain);
    lfo.start();
    return lfo;
  });
  return { input: swell, voice: { stop: at => lfos.forEach(l => stopAt(l, at)) } };
}

function scene(ctx: AudioContext, master: GainNode, sound: Exclude<Sound, 'off'>): Voice[] {
  if (sound === 'white') return [bed(ctx, master, { colour: 'pink', cutoff: 1900, sweep: 260, gain: 0.85 })];
  // Brown sits far lower: most of its energy is under 500 Hz, which is what people mean by "deeper".
  if (sound === 'brown') return [bed(ctx, master, { colour: 'brown', cutoff: 520, sweep: 120, gain: 0.9 })];
  if (sound === 'rain') return [
    // Rain sits lower and duller than white noise, with a second, darker layer for canopy and distance.
    bed(ctx, master, { colour: 'pink', cutoff: 1250, sweep: 420, gain: 0.6 }),
    bed(ctx, master, { colour: 'pink', cutoff: 340, sweep: 140, gain: 0.5 }),
    bursts(ctx, master, { low: 700, spread: 3200, q: [6, 16], peak: [0.05, 0.16], length: [0.09, 0.23], gap: [0.05, 0.47] }),
  ];
  // Fire: a brown rumble that flickers, with crackles over it. Crackles are shorter, brighter and sparser
  // than raindrops, with a low Q so each is a snap of broadband noise rather than a pitched tick.
  const glow = flicker(ctx, master);
  return [
    glow.voice,
    bed(ctx, glow.input, { colour: 'brown', cutoff: 700, sweep: 180, gain: 0.8 }),
    bursts(ctx, master, { low: 1400, spread: 4600, q: [0.8, 3], peak: [0.03, 0.2], length: [0.01, 0.06], gap: [0.04, 0.9] }),
  ];
}

type Saved = { sound: Sound; volume: number; endSound: EndSound };
const DEFAULTS: Saved = { sound: 'off', volume: 0.5, endSound: 'chime' };
function load(): Saved {
  try { const raw = localStorage.getItem(AMBIENCE_KEY); return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) } : DEFAULTS; } catch { return DEFAULTS; }
}

export function useAmbience() {
  const [saved, setSaved] = useState<Saved>(load);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { try { localStorage.setItem(AMBIENCE_KEY, JSON.stringify(saved)); } catch { /* private mode: the choice lasts this visit */ } }, [saved]);

  // Audio objects live in refs: they are not something to render, and a re-render must not rebuild them.
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const voicesRef = useRef<Voice[]>([]);
  // The latest values for callbacks that must stay stable (finish runs from an effect in the timer).
  const savedRef = useRef(saved); savedRef.current = saved;
  const playingRef = useRef(playing); playingRef.current = playing;

  const silence = useCallback((fade: number) => {
    const ctx = ctxRef.current, master = masterRef.current, voices = voicesRef.current;
    voicesRef.current = []; masterRef.current = null;
    if (!ctx || !master) return;
    // Fade before stopping. Cutting a noise bed dead is a click, and a click is the wrong note to end on.
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.0001, now + fade);
    voices.forEach(v => v.stop(now + fade));
  }, []);

  const start = useCallback((sound: Sound) => {
    silence(0.05);
    if (sound === 'off') { setPlaying(false); return; }
    // Created on the click that asks for sound, never before: browsers refuse to start an AudioContext
    // without a gesture, and one made too early stays suspended.
    let ctx = ctxRef.current;
    if (!ctx) { ctx = new AudioContext(); ctxRef.current = ctx; }
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    masterRef.current = master;
    voicesRef.current = scene(ctx, master, sound);
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0002, savedRef.current.volume), now + FADE_IN);
    setPlaying(true);
  }, [silence]);

  const play = useCallback(() => start(savedRef.current.sound), [start]);
  const stop = useCallback(() => { silence(FADE_OUT); setPlaying(false); }, [silence]);
  const toggle = useCallback(() => (playingRef.current ? stop() : play()), [play, stop]);

  // A new choice while playing swaps the bed straight away; while stopped it waits for Play.
  const setSound = useCallback((sound: Sound) => { setSaved(s => ({ ...s, sound })); if (playingRef.current) start(sound); }, [start]);
  const setVolume = useCallback((volume: number) => {
    setSaved(s => ({ ...s, volume }));
    const ctx = ctxRef.current, master = masterRef.current;
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(Math.max(0.0001, volume), ctx.currentTime + 0.15);
  }, []);
  const setEndSound = useCallback((endSound: EndSound) => setSaved(s => ({ ...s, endSound })), []);

  /**
   * The focus block is over. Stop the sound now and, once the fade is done, play the chosen end sound (see
   * lib/sounds.ts). Only if a sound was playing: that is when the context exists and is running (it was
   * made on a click), and when a sudden silence needs explaining.
   */
  const finish = useCallback(() => {
    if (!playingRef.current) return;
    stop();
    const ctx = ctxRef.current, { endSound, volume } = savedRef.current;
    if (!ctx || endSound === 'none') return;
    (endSound === 'coins' ? playCoin : playChime)(ctx, volume, ctx.currentTime + FADE_OUT);
  }, [stop]);

  useEffect(() => () => { voicesRef.current.forEach(v => v.stop(0)); void ctxRef.current?.close(); }, []);

  return { ...saved, playing, play, stop, toggle, finish, setSound, setVolume, setEndSound };
}
