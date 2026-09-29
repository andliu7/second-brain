// The sidebar's open / hidden / auto state machine (lib/useSidebarMode.ts), driven with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FocusEvent } from 'react';
import { AUTO_HIDE_MS, SIDEBAR_KEY, useSidebarMode } from '../src/lib/useSidebarMode';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
const blurTo = (inside: boolean) => {
  const aside = document.createElement('aside'); const link = document.createElement('a'); aside.appendChild(link);
  return { currentTarget: aside, relatedTarget: inside ? link : document.body } as unknown as FocusEvent<HTMLElement>;
};

describe('useSidebarMode', () => {
  it('starts open, and Ctrl B toggles open and hidden, persisted', () => {
    const { result } = renderHook(() => useSidebarMode());
    expect([result.current.mode, result.current.shown, result.current.shellClass]).toEqual(['open', true, 'sidebar-open']);
    act(() => result.current.toggle());
    expect([result.current.mode, result.current.shown, result.current.shellClass]).toEqual(['hidden', false, 'sidebar-hidden sidebar-away']);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('hidden');
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('open');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('open');
  });

  it('comes back from hidden as open when the burger is pressed', () => {
    localStorage.setItem(SIDEBAR_KEY, 'hidden');
    const { result } = renderHook(() => useSidebarMode());
    expect(result.current.shown).toBe(false);
    act(() => result.current.reveal());
    expect([result.current.mode, result.current.shown]).toEqual(['open', true]);
  });

  it('reads a folded icon rail from before as hidden', () => {
    localStorage.setItem('brain-sidebar-collapsed', '1');
    expect(renderHook(() => useSidebarMode()).result.current.mode).toBe('hidden');
  });

  it('in auto, shows first, then slides away after the pause, and the edge brings it back', () => {
    const { result } = renderHook(() => useSidebarMode());
    act(() => result.current.setMode('auto'));
    expect(result.current.shown).toBe(true);
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS - 1); });
    expect(result.current.shown).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect([result.current.shown, result.current.shellClass]).toEqual([false, 'sidebar-auto sidebar-away']);
    act(() => result.current.reveal());
    expect([result.current.mode, result.current.shown]).toEqual(['auto', true]);
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS); });
    expect(result.current.shown).toBe(false);
  });

  it('in auto, stays while the pointer is over it or focus is inside, and counts down from when both leave', () => {
    const { result } = renderHook(() => useSidebarMode());
    act(() => result.current.setMode('auto'));
    act(() => result.current.handlers.onPointerEnter());
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS * 3); });
    expect(result.current.shown).toBe(true);
    act(() => result.current.handlers.onFocus());
    act(() => result.current.handlers.onPointerLeave());
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS * 3); });
    expect(result.current.shown).toBe(true);                    // focus still holds it
    act(() => result.current.handlers.onBlur(blurTo(true)));    // focus moved to another link inside
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS * 3); });
    expect(result.current.shown).toBe(true);
    act(() => result.current.handlers.onBlur(blurTo(false)));   // focus left it
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS); });
    expect(result.current.shown).toBe(false);
    act(() => result.current.handlers.onFocus());               // tabbing back in brings it out
    expect(result.current.shown).toBe(true);
  });

  it('never hides open on its own, and leaving auto cancels the countdown', () => {
    const { result } = renderHook(() => useSidebarMode());
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS * 4); });
    expect(result.current.shown).toBe(true);
    act(() => result.current.setMode('auto'));
    act(() => result.current.setMode('open'));
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_MS * 4); });
    expect(result.current.shown).toBe(true);
    // Back to auto later: it shows again and counts down afresh.
    act(() => result.current.setMode('auto'));
    expect(result.current.shown).toBe(true);
  });
});
