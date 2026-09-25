// FavoriteButton: a star that toggles one favourite. Props:
//   on: whether the thing is starred now
//   name: what it is, for the accessible name ("Favorite Clean up"); aria-pressed carries the state
//   onToggle: called on click; the caller commits toggleFavorite() (lib/favorites.ts)
//   label: optional word instead of "Favorite", such as "Prioritize" for a project
// Drop into a skill card in Skills.tsx with one line:
//   <FavoriteButton on={isFavorite(workspace, 'skills', skill.slug)} name={skill.name} onToggle={() => commit(w => toggleFavorite(w, 'skills', skill.slug))}/>
// and into a project row in Projects.tsx with:
//   <FavoriteButton on={isFavorite(workspace, 'projects', repo.path)} name={repo.name} label="Prioritize" onToggle={() => commit(w => toggleFavorite(w, 'projects', repo.path))}/>
import type { MouseEvent } from 'react';
import { Star } from 'lucide-react';
import './favorite-button.css';

export function FavoriteButton({ on, name, onToggle, label = 'Favorite' }: { on: boolean; name: string; onToggle: () => void; label?: string }) {
  // A card or row is often itself clickable; the star must not open it.
  const click = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); onToggle(); };
  return <button type="button" className="favorite-button" aria-pressed={on} aria-label={`${label} ${name}`} onClick={click}>
    <Star size={15} fill={on ? 'currentColor' : 'none'}/>
  </button>;
}
