import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QuoteBoard } from '../src/QuoteBoard';
import { QUOTES, pickQuote, quoteText } from '../src/lib/quotes';
import { wrapText } from '../src/components/ui/text-flipping-board';

const ROWS = 6; const COLS = 22;
// Today's 2 by 36 board as its rows read once settled: the wrapped text, then blank rows to fill it.
const compact = (text: string) => { const lines = wrapText(text.toUpperCase(), 36, 2); while (lines.length < 2) lines.push(''); return lines; };
const rows = () => [...document.querySelectorAll('.flap-row')].map(row => row.textContent?.trimEnd() ?? '');

describe('the split-flap quote board', () => {
  it('has at least 40 short, attributed quotes that all fit the 22 by 6 grid once wrapped', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(40);
    for (const quote of QUOTES) {
      expect(quote.text.length, quote.text).toBeLessThan(60);
      expect(quote.by.trim().length, quote.text).toBeGreaterThan(0);
      const lines = wrapText(quoteText(quote).toUpperCase(), COLS);
      expect(lines.length, quote.text).toBeLessThanOrEqual(ROWS);
      for (const line of lines) expect(line.length, quote.text).toBeLessThanOrEqual(COLS);
      expect(lines[lines.length - 1]).toBe('- ' + quote.by.toUpperCase());
    }
    expect(new Set(QUOTES.map(q => q.text)).size).toBe(QUOTES.length);
  });

  it('picks a different quote for a different random draw, and the same one for the same draw', () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValue(0.05);
    const first = render(<QuoteBoard/>);
    const a = first.getByRole('img').getAttribute('aria-label');
    first.unmount();
    random.mockReturnValue(0.95);
    const second = render(<QuoteBoard/>);
    const b = second.getByRole('img').getAttribute('aria-label');
    second.unmount();
    expect(a).not.toBe(b);
    expect(pickQuote(() => 0.05)).toBe(pickQuote(() => 0.05));
    expect(pickQuote(() => 0.999999)).toBe(QUOTES[QUOTES.length - 1]);
  });

  it('shows the final text at once under prefers-reduced-motion, and blanks first when motion is allowed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // tests/setup.ts stubs matchMedia to match every query, so reduced motion is on.
    const expected = wrapText(quoteText(QUOTES[0]).toUpperCase(), COLS, ROWS);
    const { unmount } = render(<QuoteBoard/>);
    expect(rows()).toHaveLength(ROWS);
    expect(rows().slice(0, expected.length)).toEqual(expected);
    unmount();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<QuoteBoard/>);
    expect(rows().join('')).toBe('');
  });

  it('fits every quote on the compact Today board, 2 rows of 36, with the author under it', () => {
    for (const quote of QUOTES) {
      const lines = wrapText(quote.text.toUpperCase(), 36);
      expect(lines.length, quote.text).toBeLessThanOrEqual(2);
    }
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<QuoteBoard rows={2} cols={36} byline/>);
    expect(rows()).toHaveLength(2);
    expect(document.querySelectorAll('.flap-row')[0].children).toHaveLength(36);
    expect(rows()).toEqual(compact(QUOTES[0].text));
  });

  it('has the quote and its author as text in the region as soon as it mounts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<QuoteBoard rows={2} cols={36} byline/>);
    const region = screen.getByRole('region', { name: 'Quote of the day' });
    expect(region).toHaveTextContent(QUOTES[0].text);
    expect(region).toHaveTextContent('- ' + QUOTES[0].by);
  });

  it('always ends on the quote when motion is allowed, even when the interval runs late', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
      render(<QuoteBoard rows={2} cols={36} byline/>);
      expect(rows().join('')).toBe('');
      // A throttled background tab fires the interval once a second or less: six seconds pass on the
      // clock, the interval fires once, and the board still lands.
      vi.setSystemTime(Date.now() + 6000);
      act(() => { vi.advanceTimersByTime(45); });
      expect(rows()).toEqual(compact(QUOTES[0].text));
      expect(document.querySelectorAll('.flap-face[style*="rotateX(-90deg)"]')).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
});
