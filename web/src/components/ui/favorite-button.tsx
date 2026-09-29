// FavoriteButton: a star (or a bookmark) that toggles one mark. Props:
//   on: whether the thing is marked now
//   name: what it is, for the accessible name ("Favorite Clean up"); aria-pressed carries the state
//   onToggle: called on click; the caller commits toggleFavorite() (lib/favorites.ts)
//   label: optional word instead of "Favorite", such as "Prioritize" for a project or "Mark for review"
//   icon: 'star' (default) or 'bookmark'
// Drop into a skill card in Skills.tsx with one line:
//   <FavoriteButton on={isFavorite(workspace, 'skills', skill.slug)} name={skill.name} onToggle={() => commit(w => toggleFavorite(w, 'skills', skill.slug))}/>
// and into a project row in Projects.tsx with:
//   <FavoriteButton on={isFavorite(workspace, 'projects', repo.path)} name={repo.name} label="Prioritize" onToggle={() => commit(w => toggleFavorite(w, 'projects', repo.path))}/>
import type { MouseEvent } from 'react';
import { Bookmark, Star } from 'lucide-react';
import './favorite-button.css';

export function FavoriteButton({ on, name, onToggle, label = 'Favorite', icon = 'star' }: { on: boolean; name: string; onToggle: () => void; label?: string; icon?: 'star' | 'bookmark' }) {
  // A card or row is often itself clickable; the mark must not open it.
  const click = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); onToggle(); };
  const Icon = icon === 'bookmark' ? Bookmark : Star;
  return <button type="button" className="favorite-button" data-icon={icon} aria-pressed={on} aria-label={`${label} ${name}`} onClick={click}>
    <Icon size={15} fill={on ? 'currentColor' : 'none'}/>
  </button>;
}
