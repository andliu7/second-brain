// Favourite skills, prioritised projects and skills marked for review, kept in workspace.favorites.
// A skill is keyed by its slug, a project by its repo path, both stable across reloads. Nothing here
// touches the DOM.
import type { Favorites, Workspace } from '../types';

export type FavoriteKind = 'skills' | 'projects' | 'review';

export const emptyFavorites = (): Required<Favorites> => ({ skills: [], projects: [], review: [] });
export const favoritesOf = (workspace: Workspace): Required<Favorites> => ({ ...emptyFavorites(), ...(workspace.favorites ?? {}) });
export const isFavorite = (workspace: Workspace, kind: FavoriteKind, id: string) => favoritesOf(workspace)[kind].includes(id);

// Returns the workspace with `id` marked or unmarked, ready for commit().
export function toggleFavorite(workspace: Workspace, kind: FavoriteKind, id: string): Workspace {
  const current = favoritesOf(workspace);
  const list = current[kind].includes(id) ? current[kind].filter(x => x !== id) : [...current[kind], id];
  return { ...workspace, favorites: { ...current, [kind]: list } };
}

// Marked items first, in the order they were marked, then the rest in their existing order. Projects
// use this; the Skills page deliberately does not (a star must not move the card).
export function favoritesFirst<T>(items: T[], starred: string[], key: (item: T) => string): T[] {
  const rank = new Map(starred.map((id, i) => [id, i]));
  return [...items].map((item, i) => ({ item, i })).sort((a, b) => (rank.get(key(a.item)) ?? Infinity) - (rank.get(key(b.item)) ?? Infinity) || a.i - b.i).map(x => x.item);
}
