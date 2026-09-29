import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useRef, useState } from 'react';
import { Resume, resumeText, emptyResume } from '../src/Resume';
import { initialWorkspace, loadWorkspace, saveWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Workspace } from '../src/types';

// Mounted the way App.tsx mounts a page: the workspace and a commit that saves it, so every
// persistence assertion reads real (fake-indexeddb) storage.
function Host({ initial }: { initial: Workspace }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
  return <Resume workspace={workspace} commit={commit}/>;
}
const preview = () => screen.getByRole('article', { name: 'Resume preview' });
const profile = () => screen.getByRole('group', { name: 'Profile' });
const saved = async () => (await loadWorkspace()).resume;

async function fillProfileAndOneJob(user: ReturnType<typeof userEvent.setup>) {
  await user.type(within(profile()).getByLabelText('Name'), 'Ada Example');
  await user.type(within(profile()).getByLabelText('Email'), 'ada@example.com');
  await user.click(screen.getByRole('button', { name: 'Add experience' }));
  const job = screen.getByRole('group', { name: 'Experience 1' });
  await user.type(within(job).getByLabelText('Company'), 'Acme');
  await user.type(within(job).getByLabelText('Role'), 'Intern');
  await user.type(within(job).getByLabelText('Bullets'), 'Built the parser{Enter}Cut load time in half');
}

describe('the resume page', () => {
  it('starts empty with placeholder hints only, and a workspace saved before the resume existed still loads', async () => {
    const { resume: _resume, ...older } = initialWorkspace();
    expect(validateWorkspace(older)).toBe(older);
    await saveWorkspace(older as Workspace);
    const loaded = await loadWorkspace();
    expect(loaded.resume).toBeUndefined();
    render(<Host initial={loaded}/>);
    const name = within(profile()).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(name.placeholder).not.toBe('');
    expect(within(preview()).getByText('Fill in the form and the page builds here.')).toBeInTheDocument();
    expect(resumeText(emptyResume())).toBe('');
  });

  it('shows the profile and an experience with two bullets in the preview, saves them, and keeps them after a reload', async () => {
    const user = userEvent.setup();
    const first = render(<Host initial={initialWorkspace()}/>);
    await fillProfileAndOneJob(user);
    const page = within(preview());
    expect(page.getByRole('heading', { name: 'Ada Example' })).toBeInTheDocument();
    expect(page.getByText('ada@example.com')).toBeInTheDocument();
    expect(page.getByText('Acme')).toBeInTheDocument();
    expect(page.getByText('Intern')).toBeInTheDocument();
    expect(page.getAllByRole('listitem').map(li => li.textContent)).toEqual(['Built the parser', 'Cut load time in half']);
    await waitFor(async () => expect((await saved())?.experience[0].bullets).toEqual(['Built the parser', 'Cut load time in half']), { timeout: 3000 });
    first.unmount();

    const reloaded = await loadWorkspace();
    expect(reloaded.resume?.profile.name).toBe('Ada Example');
    render(<Host initial={reloaded}/>);
    expect((within(profile()).getByLabelText('Name') as HTMLInputElement).value).toBe('Ada Example');
    expect((within(screen.getByRole('group', { name: 'Experience 1' })).getByLabelText('Company') as HTMLInputElement).value).toBe('Acme');
    expect(within(preview()).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Built the parser', 'Cut load time in half']);
  });

  it('saves a change made just before leaving the page, inside the autosave delay', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host initial={initialWorkspace()}/>);
    await user.type(within(profile()).getByLabelText('Phone'), '555');
    unmount();
    await waitFor(async () => expect((await saved())?.profile.phone).toBe('555'));
  });

  it('adds, reorders and removes entries', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    for (const title of ['First', 'Second']) {
      await user.click(screen.getByRole('button', { name: 'Add project' }));
      const groups = screen.getAllByRole('group', { name: /^Projects \d$/ });
      await user.type(within(groups[groups.length - 1]).getByLabelText('Project'), title);
    }
    const titles = () => Array.from(preview().querySelectorAll('strong')).map(el => el.textContent);
    expect(titles()).toEqual(['First', 'Second']);
    expect(screen.getByRole('button', { name: 'Move Projects 1 up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Projects 2 up' }));
    expect(titles()).toEqual(['Second', 'First']);
    await user.click(screen.getByRole('button', { name: 'Remove Projects 1' }));
    expect(titles()).toEqual(['First']);
    await waitFor(async () => expect((await saved())?.projects.map(p => p.title)).toEqual(['First']), { timeout: 3000 });
  });

  it('Download PDF prints, and Copy as plain text copies the resume as text', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<Host initial={initialWorkspace()}/>);
    await fillProfileAndOneJob(user);
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Copy as plain text' }));
    expect(await navigator.clipboard.readText()).toBe('Ada Example\nada@example.com\n\nEXPERIENCE\nAcme | Intern\n- Built the parser\n- Cut load time in half');
    expect(screen.getByRole('status')).toHaveTextContent('Copied as plain text.');
  });

  it('the Template menu changes the look of the preview, is saved, and comes back after a reload', async () => {
    const user = userEvent.setup();
    const first = render(<Host initial={initialWorkspace()}/>);
    const picker = screen.getByRole('combobox', { name: 'Template' });
    expect(Array.from((picker as HTMLSelectElement).options).map(o => o.textContent)).toEqual(['Classic', 'Onyx', 'Ditto', 'Azurill']);
    expect(preview()).toHaveAttribute('data-template', 'classic');
    await user.selectOptions(picker, 'Ditto');
    expect(preview()).toHaveAttribute('data-template', 'ditto');
    await waitFor(async () => expect((await saved())?.template).toBe('ditto'), { timeout: 3000 });
    first.unmount();
    render(<Host initial={await loadWorkspace()}/>);
    expect(preview()).toHaveAttribute('data-template', 'ditto');
    expect(screen.getByRole('combobox', { name: 'Template' })).toHaveValue('ditto');
    // Each template has its own rules in the stylesheet, not just a name in the menu.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/resume.css'), 'utf8');
    for (const id of ['onyx', 'ditto', 'azurill']) expect(css).toContain(`.resume-page[data-template="${id}"]`);
  });

  it('has a print stylesheet that prints the letter page alone', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/resume.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(css).toContain('@media print');
    expect(print).toContain('@page{size:letter;margin:0}');
    expect(print).toContain('body:has(.resume-page) *:not(:has(.resume-page)):not(.resume-page):not(.resume-page *){display:none!important}');
  });
});
