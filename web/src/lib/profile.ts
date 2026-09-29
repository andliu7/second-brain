// The local profile (Andrew, 2026-09-28: "the yourspace/local storage make that a 'profile' you can
// customize in settings and place it top right with the chat button"). A name, an avatar (initials or an
// emoji), a colour from the theme and an optional status line. It lives in the workspace as
// workspace.profile, so it travels with a backup like everything else; a workspace saved before it
// existed has none and reads as DEFAULT_PROFILE. shared/validate.mjs holds the same bounds.
// The default name is empty, not a placeholder like "Your space" whose initials (YS) read as someone's;
// with no name and no avatar the avatar is a person icon (Andrew, 2026-09-29).
import type { Profile, ProfileColor, Workspace } from '../types';

// Each colour is a theme token, so it holds in light and dark without a second value. Green is the dark
// green because the plain one is too pale for text on the light sheet.
export const PROFILE_COLORS: { id: ProfileColor; label: string; token: string }[] = [
  { id: 'accent', label: 'Purple', token: 'var(--acc)' },
  { id: 'green', label: 'Green', token: 'var(--green-dk)' },
  { id: 'amber', label: 'Amber', token: 'var(--amber)' },
  { id: 'red', label: 'Red', token: 'var(--red)' },
  { id: 'ink', label: 'Ink', token: 'var(--deep)' },
];
export const PROFILE_LIMITS = { name: 80, avatar: 16, status: 140 };
export const DEFAULT_PROFILE: Profile = { name: '', avatar: '', color: 'accent' };

export const profileOf = (workspace: Workspace): Profile => ({ ...DEFAULT_PROFILE, ...workspace.profile });
export const colorToken = (id: ProfileColor) => (PROFILE_COLORS.find(c => c.id === id) ?? PROFILE_COLORS[0]).token;

// Up to two letters from the name's first two words: "Andrew Liu" is AL, "andrew" is A.
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0].toUpperCase()).join('');
}
// What the avatar shows: the chosen initials or emoji, else the name's initials, else nothing (Avatar
// then draws a person icon).
export const avatarText = (profile: Profile) => profile.avatar.trim() || initialsOf(profile.name);

// Trims what was typed and drops an empty status, so what is saved is what is shown.
export function cleanProfile(draft: Profile): Profile {
  const status = draft.status?.trim();
  return { name: draft.name.trim().slice(0, PROFILE_LIMITS.name), avatar: draft.avatar.trim().slice(0, PROFILE_LIMITS.avatar), color: draft.color, ...(status ? { status: status.slice(0, PROFILE_LIMITS.status) } : {}) };
}
