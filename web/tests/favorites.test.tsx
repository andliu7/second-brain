import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavoriteButton } from '../src/components/ui/favorite-button';
import { favoritesFirst, isFavorite, toggleFavorite } from '../src/lib/favorites';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';

describe('favourite skills and prioritised projects', () => {
  it('toggles a star on and off in the workspace, and a workspace without favorites is valid and empty', () => {
    const base = initialWorkspace();
    expect(base.favorites).toBeUndefined();
    expect(validateWorkspace(base)).toBe(base);
    expect(isFavorite(base, 'skills', 'clean-up')).toBe(false);
    const starred = toggleFavorite(toggleFavorite(base, 'skills', 'clean-up'), 'projects', 'grignard/grignard-app-source');
    expect(starred.favorites).toEqual({ skills: ['clean-up'], projects: ['grignard/grignard-app-source'] });
    expect(isFavorite(starred, 'skills', 'clean-up')).toBe(true);
    expect(validateWorkspace(starred)).toBe(starred);
    const unstarred = toggleFavorite(starred, 'skills', 'clean-up');
    expect(unstarred.favorites).toEqual({ skills: [], projects: ['grignard/grignard-app-source'] });
    expect(base.favorites).toBeUndefined();
    expect(() => validateWorkspace({ ...base, favorites: { skills: ['a', 'a'], projects: [] } })).toThrow(/duplicate/);
    expect(() => validateWorkspace({ ...base, favorites: { skills: [''], projects: [] } })).toThrow(/favorites.skills\[0\]/);
  });

  it('puts starred items first in the order they were starred, then the rest in their own order', () => {
    const skills = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
    expect(favoritesFirst(skills, ['c', 'a'], s => s.slug).map(s => s.slug)).toEqual(['c', 'a', 'b', 'd']);
    expect(favoritesFirst(skills, [], s => s.slug).map(s => s.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(favoritesFirst(skills, ['zzz'], s => s.slug).map(s => s.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(skills.map(s => s.slug)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the star is a named toggle button that does not open the card it sits on', async () => {
    const user = userEvent.setup();
    const toggle = vi.fn(); const open = vi.fn();
    const { rerender } = render(<div role="button" tabIndex={0} onClick={open}><FavoriteButton on={false} name="Clean up" onToggle={toggle}/></div>);
    const star = screen.getByRole('button', { name: 'Favorite Clean up' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    rerender(<div role="button" tabIndex={0} onClick={open}><FavoriteButton on name="Pibble" label="Prioritize" onToggle={toggle}/></div>);
    expect(screen.getByRole('button', { name: 'Prioritize Pibble' })).toHaveAttribute('aria-pressed', 'true');
  });
});
