// Favourite skills and prioritised projects, kept in workspace.favorites. A skill is keyed by its
// slug, a project by its repo path, both stable across reloads. Nothing here touches the DOM.
import type { Favorites, Workspace } from '../types';

export type FavoriteKind = keyof Favorites;

export const emptyFavorites = (): Favorites => ({ skills: [], projects: [] });
export const favoritesOf = (workspace: Workspace): Favorites => workspace.favorites ?? emptyFavorites();
export const isFavorite = (workspace: Workspace, kind: FavoriteKind, id: string) => favoritesOf(workspace)[kind].includes(id);

// Returns the workspace with `id` starred or unstarred, ready for commit().
export function toggleFavorite(workspace: Workspace, kind: FavoriteKind, id: string): Workspace {
  const current = favoritesOf(workspace);
  const list = current[kind].includes(id) ? current[kind].filter(x => x !== id) : [...current[kind], id];
  return { ...workspace, favorites: { ...current, [kind]: list } };
}

// Starred items first, in the order they were starred, then the rest in their existing order.
export function favoritesFirst<T>(items: T[], starred: string[], key: (item: T) => string): T[] {
  const rank = new Map(starred.map((id, i) => [id, i]));
  return [...items].map((item, i) => ({ item, i })).sort((a, b) => (rank.get(key(a.item)) ?? Infinity) - (rank.get(key(b.item)) ?? Infinity) || a.i - b.i).map(x => x.item);
}
