import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FocusTimer } from '../src/components/ui/focus-timer';
import { FOCUS_KEY, formatClock } from '../src/lib/useFocusTimer';
import { AMBIENCE_KEY } from '../src/lib/ambience';
import { COIN_SECONDS, playCoin, playReward, REWARD_KEY } from '../src/lib/sounds';

// The clock is driven by Date.now() and a 250 ms setInterval, so only those two are faked; setTimeout stays
// real so user-event and Testing Library's own waits keep working. Each forward() also fires the tick.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); localStorage.removeItem(FOCUS_KEY); });
afterEach(() => { vi.useRealTimers(); });
const forward = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
// The card's clock; the button's name carries the same time while a session runs, so read the card itself.
const bigClock = () => document.querySelector('.focus-clock-big strong')?.textContent;

describe('the focus timer in the top bar', () => {
  it('starts as a quiet button, opens to a card, and Escape closes it back to the button', async () => {
    const user = userEvent.setup();
    render(<FocusTimer/>);
    const region = screen.getByRole('region', { name: 'Focus timer' });
    expect(region).toHaveClass('is-idle');
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Start focus' })).toBeInTheDocument();
    expect(bigClock()).toBe('25:00');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Start focus' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveFocus();
  });

  it('counts down a focus block, forces an eye rest at twenty minutes, then resumes, and survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    forward(5 * 60_000);
    expect(bigClock()).toBe('20:00');
    expect(screen.getByText('Next eye rest in 15:00')).toBeInTheDocument();
    forward(15 * 60_000 + 250);
    // Twenty minutes in: the eye rest starts on its own and the card says so.
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('phase-eyeRest');
    expect(bigClock()).toBe('00:20');
    forward(20_000 + 250);
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('phase-focus');
    expect(bigClock()).toBe('05:00');
    expect(screen.getByText('Rests taken this session: 1')).toBeInTheDocument();
    // A reload keeps the running clock, measured from the phase's start stamp; the card stays closed until asked.
    unmount();
    render(<FocusTimer/>);
    forward(250);
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('is-running');
    await user.click(screen.getByRole('button', { name: /Focusing, 05:00 left/ }));
    expect(bigClock()).toBe('05:00');
    // Focus runs out into a break; the break runs out into idle with the minutes banked.
    forward(5 * 60_000 + 250);
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('phase-break');
    forward(5 * 60_000 + 250);
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('phase-idle');
    expect(JSON.parse(localStorage.getItem(FOCUS_KEY) || '{}').phase).toBe('idle');
  });

  it('pause banks the minutes and Start continues them; settings change the block length', async () => {
    const user = userEvent.setup();
    render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    forward(3 * 60_000 + 250);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('3 min banked; Start continues it.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    forward(250);
    expect(bigClock()).toBe('22:00');
    await user.click(screen.getByRole('button', { name: 'Reset the timer' }));
    expect(bigClock()).toBe('25:00');
    await user.click(screen.getByText('Settings'));
    await user.clear(screen.getByLabelText('Focus, minutes'));
    await user.type(screen.getByLabelText('Focus, minutes'), '50');
    expect(bigClock()).toBe('50:00');
    expect(formatClock(61_000)).toBe('01:01');
  });

  // 2026-09-28: the timer moved from a fixed bottom-right button (which covered the buy list's Add while
  // scrolling) to the top bar, so the old check that the page kept a clearance for it is now a check that
  // nothing of it is fixed over the page, that the card is anchored to the button, and that the badge shows.
  it('sits in the top bar with a minutes badge while running, and its card is anchored below the button', async () => {
    const user = userEvent.setup();
    render(<FocusTimer/>);
    const button = screen.getByRole('button', { name: 'Focus' });
    expect(button).toHaveAttribute('title', 'Focus');
    expect(button).toHaveClass('icon-button');
    expect(document.querySelector('.focus-badge')).toBeNull();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    forward(250);
    expect(document.querySelector('.focus-badge')?.textContent).toBe('25m');
    forward(90_000);
    expect(document.querySelector('.focus-badge')?.textContent).toBe('24m');
    // jsdom does not apply stylesheets, so the placement is read from the file.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/components/ui/focus-timer.css'), 'utf8');
    expect(css).not.toContain('position:fixed');
    expect(css).not.toContain('has-focus-timer');
    expect(css).toMatch(/\.focus-timer\{position:relative/);
    expect(css).toMatch(/\.focus-card\{position:absolute;right:0;top:calc\(100% \+ 8px\)/);
  });
});

// jsdom has no Web Audio, so a fake AudioContext records the graph: every source and oscillator made, when
// each was started and stopped, and every value a gain or frequency was set or ramped to. Params keep the
// last value written, so an oscillator's frequency reads as the note it settles on.
type Call = [string, number, number?];
class FakeParam { value = 0; calls: Call[] = [];
  private rec(kind: string, v: number, t?: number) { this.calls.push([kind, v, t]); this.value = v; return this; }
  setValueAtTime(v: number, t: number) { return this.rec('set', v, t); }
  linearRampToValueAtTime(v: number, t: number) { return this.rec('linear', v, t); }
  exponentialRampToValueAtTime(v: number, t: number) { return this.rec('exp', v, t); }
  cancelScheduledValues() { return this; } }
class FakeNode { outputs: unknown[] = []; connect<T>(to: T) { this.outputs.push(to); return to; } disconnect() {} }
class FakeSource extends FakeNode { buffer: unknown = null; loop = false; playbackRate = new FakeParam(); starts: number[] = []; stops: number[] = [];
  start(t = 0) { this.starts.push(t); } stop(t = 0) { this.stops.push(t); } }
class FakeOsc extends FakeSource { type = 'sine'; frequency = new FakeParam(); }
class FakeGain extends FakeNode { gain = new FakeParam(); }
const made = { contexts: [] as FakeAudioContext[], sources: [] as FakeSource[], oscillators: [] as FakeOsc[], gains: [] as FakeGain[] };
class FakeAudioContext {
  currentTime = 0; sampleRate = 3000; destination = new FakeNode();
  constructor() { made.contexts.push(this); }
  resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { const s = new FakeSource(); made.sources.push(s); return s; }
  createOscillator() { const o = new FakeOsc(); made.oscillators.push(o); return o; }
  createGain() { const g = new FakeGain(); made.gains.push(g); return g; }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
}
// The master gain is the first gain wired straight to a context's speakers.
const master = () => made.gains.find(g => g.outputs.some(o => made.contexts.some(c => c.destination === o)))!;
// Looping buffer sources are the beds; the chime and coin are oscillators above 800 Hz (the LFOs are under 1 Hz).
const beds = () => made.sources.filter(s => s.loop);
const tones = () => made.oscillators.filter(o => o.frequency.value > 800);

describe('ambient sound, the end-of-block cue, the wider settings and the pop-out', () => {
  beforeEach(() => {
    made.contexts.length = 0; made.sources.length = 0; made.oscillators.length = 0; made.gains.length = 0;
    localStorage.removeItem(AMBIENCE_KEY); localStorage.removeItem(REWARD_KEY);
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  const openWith = async (user: ReturnType<typeof userEvent.setup>, sound: string) => {
    render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByText('Settings'));
    await user.selectOptions(screen.getByLabelText('Sound'), sound);
  };

  it('Play builds the chosen bed and fades it in; Pause stops every source', async () => {
    const user = userEvent.setup();
    await openWith(user, 'Brown noise');
    expect(made.contexts).toHaveLength(0); // no context before the click that asks for sound
    await user.click(screen.getByRole('button', { name: 'Play sound' }));
    expect(made.contexts).toHaveLength(1);
    expect(beds()).toHaveLength(2); // the two coprime-length buffers
    expect(beds().every(s => s.starts.length === 1 && s.stops.length === 0)).toBe(true);
    const gain = master();
    expect(gain.gain.calls.at(-1)).toEqual(['exp', 0.5, 0.9]); // up to the saved volume over the fade-in
    await user.click(screen.getByRole('button', { name: 'Pause sound' }));
    expect(beds().every(s => s.stops.length === 1)).toBe(true);
    expect(gain.gain.value).toBeCloseTo(0.0001);
    expect(screen.getByRole('button', { name: 'Play sound' })).toBeInTheDocument();
    expect(tones()).toHaveLength(0); // stopping by hand is not the end of a block: no chime
    // Fire is a flickering brown bed with crackles over it: the bed's two buffers plus scheduled bursts,
    // and the flicker's two sub-hertz oscillators on top of the filter's.
    await user.selectOptions(screen.getByLabelText('Sound'), 'Fire');
    await user.click(screen.getByRole('button', { name: 'Play sound' }));
    expect(made.sources.filter(s => !s.loop).length).toBeGreaterThan(0);
    expect(made.oscillators.filter(o => o.frequency.value > 0.2 && o.frequency.value < 1)).toHaveLength(2);
  });

  it('the block running out stops the sound at once and rings the chime; pausing a block does too, with coins if chosen', async () => {
    const user = userEvent.setup();
    await openWith(user, 'White noise');
    await user.clear(screen.getByLabelText('Focus, minutes'));
    await user.type(screen.getByLabelText('Focus, minutes'), '1');
    await user.click(screen.getByRole('button', { name: 'Play sound' }));
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    forward(30_000);
    expect(beds().every(s => s.stops.length === 0)).toBe(true); // playing through the block
    forward(30_000 + 250);
    expect(screen.getByRole('region', { name: 'Focus timer' })).toHaveClass('phase-break');
    expect(beds().every(s => s.stops.length === 1 && s.stops[0] <= 0.3)).toBe(true);
    expect(screen.getByRole('button', { name: 'Play sound' })).toBeInTheDocument();
    expect(tones().map(o => o.frequency.value).sort((a, b) => a - b)).toEqual([880, 1318.5]);
    expect(tones().every(o => o.starts[0] > 0)).toBe(true); // after the fade, not over it
    // Gold coins as the end sound; the user pausing a block ends it too.
    await user.selectOptions(screen.getByLabelText('When focus ends'), 'Gold coins');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Play sound' }));
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    const before = tones().length;
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(beds().every(s => s.stops.length === 1)).toBe(true);
    expect(tones().length - before).toBeGreaterThanOrEqual(5); // the ching's two partials plus three or more clinks
  });

  it('opening Settings widens the card and closing it restores the compact size', async () => {
    const user = userEvent.setup();
    render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    const card = document.querySelector('.focus-card') as HTMLElement;
    expect(card).not.toHaveClass('is-wide');
    await user.click(screen.getByText('Settings'));
    expect(card).toHaveClass('is-wide');
    expect(document.querySelector('.focus-settings')).toHaveAttribute('open');
    await user.click(screen.getByText('Settings'));
    expect(card).not.toHaveClass('is-wide');
    // The width and its animation are CSS; jsdom applies none, so read the rules from the file.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/components/ui/focus-timer.css'), 'utf8');
    expect(css).toMatch(/\.focus-card\.is-wide\{width:min\(420px,calc\(100vw - 32px\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{\.focus-card\{transition:width/);
  });

  it('Pop out shows only with Document Picture-in-Picture, and renders the live timer into the new window', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull();
    unmount();
    // A real second document to portal into: an iframe's window stands in for the PiP window.
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    const win = frame.contentWindow as Window; const doc = win.document; // kept: jsdom drops a closed window's document
    const requestWindow = vi.fn(async () => win);
    vi.stubGlobal('documentPictureInPicture', { requestWindow });
    render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByRole('button', { name: 'Pop out' }));
    expect(requestWindow).toHaveBeenCalledWith({ width: 320, height: 220 });
    await waitFor(() => expect(doc.body.querySelector('.focus-pip')).not.toBeNull());
    const pip = within(doc.body);
    expect(pip.getByText('25:00')).toBeInTheDocument();
    expect(screen.getByText('The timer is in its own window.')).toBeInTheDocument();
    // Live and in step: starting from the window runs the one clock the top bar badge reads.
    fireEvent.click(pip.getByRole('button', { name: 'Start focus' }));
    forward(60_250);
    expect(pip.getByText('24:00')).toBeInTheDocument();
    expect(document.querySelector('.focus-badge')?.textContent).toBe('24m');
    // Closing the window brings the view back to the card.
    act(() => { win.dispatchEvent(new Event('pagehide')); });
    expect(doc.body.querySelector('.focus-pip')).toBeNull();
    expect(bigClock()).toBe('24:00');
    frame.remove();
  });

  it('playCoin schedules a ching and three to five clinks, all silent within 0.8 s; the reward preference off is silent', async () => {
    const ctx = new FakeAudioContext();
    playCoin(ctx as unknown as AudioContext, 0.5, 0);
    const oscs = [...made.oscillators];
    expect(oscs.length).toBeGreaterThanOrEqual(5); expect(oscs.length).toBeLessThanOrEqual(7);
    expect(oscs[0].frequency.value).toBeCloseTo(1975.5); // the strike: two partials a few cents apart
    expect(oscs[1].frequency.value / oscs[0].frequency.value).toBeCloseTo(1.006, 3);
    expect(oscs[0].frequency.calls[0][1]).toBeLessThan(oscs[0].frequency.value); // the small rise into the note
    expect(COIN_SECONDS).toBeLessThan(0.8);
    expect(oscs.every(o => o.starts[0] >= 0 && o.stops[0] <= COIN_SECONDS)).toBe(true);
    // The preference, turned off from the timer settings, makes playReward silent; on again, it plays.
    const user = userEvent.setup();
    render(<FocusTimer/>);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByText('Settings'));
    await user.click(screen.getByLabelText('Coins when a todo is done'));
    expect(localStorage.getItem(REWARD_KEY)).toBe('off');
    const count = made.oscillators.length;
    playReward();
    expect(made.oscillators.length).toBe(count);
    await user.click(screen.getByLabelText('Coins when a todo is done'));
    playReward();
    expect(made.oscillators.length).toBeGreaterThanOrEqual(count + 5);
  });
});
