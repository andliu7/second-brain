// The profile: the avatar menu in the top bar and the editor on Settings (components/ui/profile.tsx).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ProfileButton, ProfileSettings } from '../src/components/ui/profile';
import { avatarText, initialsOf, profileOf } from '../src/lib/profile';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Workspace } from '../src/types';

let latest: Workspace;
function Harness({ initial, openSettings = () => {} }: { initial: Workspace; openSettings?: () => void }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); latest = next; return next; }); return true; };
  return <><ProfileButton workspace={workspace} openSettings={openSettings}/><ProfileSettings workspace={workspace} commit={commit}/></>;
}

describe('the profile', () => {
  it('reads an old workspace as the default, and makes initials from the name', () => {
    expect(profileOf(initialWorkspace())).toEqual({ name: 'Your space', avatar: '', color: 'accent' });
    expect(initialsOf('andrew liu chen')).toBe('AL');
    expect(avatarText({ name: 'Andrew', avatar: ' 🫐 ', color: 'green' })).toBe('🫐');
    expect(avatarText({ name: '  ', avatar: '', color: 'green' })).toBe('?');
  });

  it('opens a menu with the name, the saved-on-this-device line, Edit profile, Settings and the theme', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    render(<Harness initial={{ ...initialWorkspace(), profile: { name: 'Andrew Liu', avatar: '', color: 'green', status: 'Exam week' } }} openSettings={openSettings}/>);
    const button = screen.getByRole('button', { name: 'Profile, Andrew Liu' });
    expect(button).toHaveTextContent('AL');
    await user.click(button);
    const menu = screen.getByRole('group', { name: 'Profile' });
    expect(within(menu).getByText('Exam week')).toBeInTheDocument();
    expect(within(menu).getByText('Saved on this device')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /Switch to (light|dark) theme/ })).toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: 'Settings' }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: 'Profile' })).toBeNull();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Profile' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('saves a new name, avatar, colour and status to the workspace, trimmed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={initialWorkspace()}/>);
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), ' Andrew ');
    await user.type(screen.getByLabelText('Avatar'), 'AL');
    await user.click(screen.getByRole('radio', { name: 'Amber' }));
    await user.type(screen.getByLabelText('Status'), '  ');
    await user.click(save);
    expect(latest.profile).toEqual({ name: 'Andrew', avatar: 'AL', color: 'amber' });
    expect(screen.getByRole('button', { name: 'Profile, Andrew' })).toHaveTextContent('AL');
    expect(save).toBeDisabled();
  });
});
