// The profile (lib/profile.ts) in two places. ProfileButton is the avatar in the top bar, beside the
// andliu.ai button: it opens a small menu with the name and status, the fact that everything is saved on
// this device (the line the old sidebar footer carried), Edit profile and Settings. The theme is not here:
// Settings and the top bar already switch it (Andrew, 2026-09-29). Props:
//   workspace, commit: as every page gets them
//   openSettings(): App's navigate('settings')
// ProfileSettings is the editor on the Settings page: name, avatar (initials or an emoji), colour and
// status, with a live preview; Save writes it to the workspace. Props: workspace, commit.
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, HardDrive, Pencil, Settings, UserRound } from 'lucide-react';
import type { Profile, Workspace } from '../../types';
import { avatarText, cleanProfile, colorToken, PROFILE_COLORS, PROFILE_LIMITS, profileOf } from '../../lib/profile';
import './profile.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
// The editor's name field; Edit profile in the menu puts the caret there once Settings has rendered.
export const PROFILE_NAME_ID = 'profile-name';

export function Avatar({ profile, size = 30 }: { profile: Profile; size?: number }) {
  return <span className="pf-avatar" style={{ '--pf': colorToken(profile.color), width: size, height: size, fontSize: Math.round(size * 0.42) } as CSSProperties} aria-hidden="true">{avatarText(profile) || <UserRound size={Math.round(size * 0.55)}/>}</span>;
}

export function ProfileButton({ workspace, openSettings }: { workspace: Workspace; openSettings: () => void }) {
  const profile = profileOf(workspace);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();
  // A press anywhere outside closes it, the way any menu does. Escape is handled on the box below.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const go = (focusName: boolean) => {
    setOpen(false);
    openSettings();
    // Settings renders on the next commit, so the field exists a frame later.
    if (focusName) requestAnimationFrame(() => document.getElementById(PROFILE_NAME_ID)?.focus());
  };
  return <div className="pf" ref={box} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
    <button ref={button} type="button" className="pf-button" aria-label={profile.name ? `Profile, ${profile.name}` : 'Profile'} aria-expanded={open} aria-controls={open ? menu : undefined} title={profile.name || 'Profile'} onClick={() => setOpen(v => !v)}>
      <Avatar profile={profile} size={28}/>
    </button>
    {open && <div id={menu} className="pf-menu panel" role="group" aria-label="Profile">
      <div className="pf-who"><Avatar profile={profile} size={36}/><span><strong>{profile.name}</strong>{profile.status && <small>{profile.status}</small>}</span></div>
      <p className="pf-local"><span className="status-dot"/><HardDrive size={13} aria-hidden="true"/>Saved on this device</p>
      <button type="button" className="pf-item" onClick={() => go(true)}><Pencil size={15}/>Edit profile</button>
      <button type="button" className="pf-item" onClick={() => go(false)}><Settings size={15}/>Settings</button>
    </div>}
  </div>;
}

export function ProfileSettings({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const saved = profileOf(workspace);
  const [draft, setDraft] = useState<Profile>(saved);
  const [busy, setBusy] = useState(false);
  const hint = useId();
  const set = (patch: Partial<Profile>) => setDraft(d => ({ ...d, ...patch }));
  const clean = cleanProfile(draft);
  const dirty = JSON.stringify(clean) !== JSON.stringify(cleanProfile(saved));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (await commit(w => ({ ...w, profile: clean }), 'Profile saved')) setDraft(clean);
    setBusy(false);
  }
  return <section className="panel settings-section pf-settings" id="profile-settings" aria-labelledby="pf-heading">
    <div className="section-heading"><h2 id="pf-heading"><UserRound size={17}/>Profile</h2></div>
    <p className="settings-intro">How you appear in the top bar. Kept in this workspace on this device, and in its backups.</p>
    <form className="pf-form" onSubmit={event => void save(event)}>
      <div className="pf-preview"><Avatar profile={clean} size={56}/><span><strong>{clean.name}</strong>{clean.status && <small>{clean.status}</small>}</span></div>
      <label>Name<input id={PROFILE_NAME_ID} value={draft.name} maxLength={PROFILE_LIMITS.name} onChange={e => set({ name: e.target.value })} placeholder="Your name"/></label>
      <label>Avatar<input value={draft.avatar} maxLength={PROFILE_LIMITS.avatar} onChange={e => set({ avatar: e.target.value })} placeholder="Initials or an emoji" aria-describedby={hint}/></label>
      <small className="pf-hint" id={hint}>Empty uses your initials.</small>
      {/* Real radio inputs under the chips, so arrow keys move between colours and it is announced as a group. */}
      <fieldset className="pf-colors"><legend>Colour</legend>
        {PROFILE_COLORS.map(c => <label key={c.id} className="pf-color" style={{ '--pf': c.token } as CSSProperties} title={c.label}>
          <input type="radio" name="profile-color" value={c.id} checked={draft.color === c.id} onChange={() => set({ color: c.id })}/>
          <span aria-hidden="true">{draft.color === c.id && <Check size={13}/>}</span><span className="sr-only">{c.label}</span>
        </label>)}
      </fieldset>
      <label>Status<input value={draft.status ?? ''} maxLength={PROFILE_LIMITS.status} onChange={e => set({ status: e.target.value })} placeholder="Optional, e.g. Exam week"/></label>
      <div><button type="submit" className="button primary" disabled={!dirty || busy}>Save profile</button></div>
    </form>
  </section>;
}
