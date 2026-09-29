import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeChoice } from '@/components/ui/theme-controls';
import { BG_MOTION_KEY, BG_SPEED_KEY, backgroundAttrs, setBackground } from '@/lib/background';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../index.html'), 'utf8');
const prePaint = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const root = document.documentElement;
// setup.ts answers every media query true; these stubs pick which ones are on.
const media = (reduced: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') ? reduced : false, addEventListener: () => {}, removeEventListener: () => {} }));
const runPrePaint = () => { root.removeAttribute('data-bg'); root.removeAttribute('data-bg-speed'); new Function(prePaint)(); };

describe('the light theme background', () => {
  beforeEach(() => { localStorage.clear(); media(false); vi.stubGlobal('CSS', { registerProperty: () => {} }); setBackground({ motion: 'animated', speed: 'calm' }); });

  it('backgroundAttrs: animated only when chosen, motion is allowed and @property works', () => {
    expect(backgroundAttrs('animated', 'calm', false, true)).toEqual({ bg: 'animated', speed: 'calm' });
    expect(backgroundAttrs('animated', 'lively', false, true)).toEqual({ bg: 'animated', speed: 'lively' });
    expect(backgroundAttrs('still', 'lively', false, true).bg).toBe('still');
    expect(backgroundAttrs('animated', 'calm', true, true).bg).toBe('still');
    expect(backgroundAttrs('animated', 'calm', false, false).bg).toBe('still');
  });

  it('the pre-paint script in index.html sets the same attributes before the app loads', () => {
    localStorage.clear();
    runPrePaint();
    expect(root.dataset.bg).toBe('animated');
    expect(root.dataset.bgSpeed).toBe('calm');
    localStorage.setItem(BG_SPEED_KEY, 'lively');
    runPrePaint();
    expect(root.dataset.bgSpeed).toBe('lively');
    localStorage.setItem(BG_MOTION_KEY, 'still');
    runPrePaint();
    expect(root.dataset.bg).toBe('still');
  });

  it('reduced motion forces still, in the script and in the app', () => {
    media(true);
    runPrePaint();
    expect(root.dataset.bg).toBe('still');
    setBackground({ motion: 'animated' });
    expect(root.dataset.bg).toBe('still');
  });

  it('a browser without CSS.registerProperty stays still', () => {
    vi.stubGlobal('CSS', {});
    runPrePaint();
    expect(root.dataset.bg).toBe('still');
  });

  it('Appearance shows Animated / Still and Calm / Lively, and remembers them', async () => {
    const user = userEvent.setup();
    render(<ThemeChoice/>);
    expect(screen.getByRole('radio', { name: 'Animated' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Calm' })).toBeChecked();
    expect(screen.getByText(/Light theme only/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Lively' }));
    expect(localStorage.getItem(BG_SPEED_KEY)).toBe('lively');
    expect(root.dataset.bgSpeed).toBe('lively');

    await user.click(screen.getByRole('radio', { name: 'Still' }));
    expect(localStorage.getItem(BG_MOTION_KEY)).toBe('still');
    expect(root.dataset.bg).toBe('still');
    expect(screen.queryByRole('radio', { name: 'Calm' })).toBeNull(); // Speed only while it moves

    await user.click(screen.getByRole('radio', { name: 'Animated' }));
    expect(root.dataset.bg).toBe('animated');
    expect(screen.getByRole('radio', { name: 'Lively' })).toBeChecked();
  });

  it('a storage that throws still applies the choice for this visit', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    setBackground({ motion: 'still' });
    expect(root.dataset.bg).toBe('still');
  });
});
