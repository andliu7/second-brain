import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeButton, ThemeChoice } from '@/components/ui/theme-controls';
import { THEME_KEY, readPref, setThemePref } from '@/lib/theme';

describe('the theme switch', () => {
  // setup.ts answers every media query true; here the system is light, so System has something to resolve to.
  beforeEach(() => { vi.stubGlobal('matchMedia', (q: string) => ({ matches: !q.includes('dark'), addEventListener: () => {}, removeEventListener: () => {} })); setThemePref('system'); });

  it('the top bar button flips the theme, and Settings shows the pinned choice', async () => {
    const user = userEvent.setup();
    render(<><ThemeButton/><ThemeChoice/></>);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('System forgets the saved choice and follows the system again', async () => {
    const user = userEvent.setup();
    render(<ThemeChoice/>);
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(readPref()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('the inline script in index.html applies a saved theme before the app loads', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    localStorage.setItem(THEME_KEY, 'dark');
    document.documentElement.removeAttribute('data-theme');
    new Function(script)();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
