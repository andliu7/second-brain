import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FocusTimer } from '../src/components/ui/focus-timer';
import { FOCUS_KEY, formatClock } from '../src/lib/useFocusTimer';

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
