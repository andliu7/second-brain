import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useRef, useState } from 'react';
import { Resume, resumeText, emptyResume } from '../src/Resume';
import { parseLatexResume } from '../src/lib/latex-resume';
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
    // Re-pointed 2026-09-28: five more of Reactive Resume's templates joined the menu (Ditgar to Scizor).
    expect(Array.from((picker as HTMLSelectElement).options).map(o => o.textContent)).toEqual(['Classic', 'Onyx', 'Ditto', 'Azurill', 'Ditgar', 'Leafish', 'Kakuna', 'Meowth', 'Scizor']);
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
    for (const id of ['onyx', 'ditto', 'azurill', 'ditgar', 'leafish', 'kakuna', 'meowth', 'scizor']) expect(css).toContain(`.resume-page[data-template="${id}"]`);
  });

  it('has a print stylesheet that prints the letter page alone', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/resume.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(css).toContain('@media print');
    expect(print).toContain('@page{size:letter;margin:0}');
    expect(print).toContain('body:has(.resume-page) *:not(:has(.resume-page)):not(.resume-page):not(.resume-page *){display:none!important}');
  });
});

// 2026-09-28: the sidebar templates put the skills in a column of their own, and the resume reads and
// writes LaTeX (Andrew: "can we make it so that it reads latex too?").
describe('sidebar templates and LaTeX', () => {
  const readBlob = (blob: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
  const TEX = String.raw`\documentclass{article}
\begin{document}
\begin{center}
  \textbf{\Huge Lin Park} \\ \href{mailto:lin@example.com}{\underline{lin@example.com}} $|$ Rockville, MD
\end{center}
\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading{Research Assistant}{Jan. 2026 -- Present}{Chem Lab \& Co}{College Park, MD}
      \resumeItemListStart
        \resumeItem{Automated 90\% of the titrations}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\section{Technical Skills}
  \begin{itemize}[leftmargin=0.15in, label={}]
    \item{\textbf{Languages}{: Python, R}}
  \end{itemize}
\section{Hobbies}
  Climbing
\end{document}`;

  it('a sidebar template draws the skills in the side column and the sections in the main one', async () => {
    const user = userEvent.setup();
    const { resume } = parseLatexResume(TEX);
    render(<Host initial={{ ...initialWorkspace(), resume }}/>);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'Ditgar');
    expect(preview()).toHaveAttribute('data-template', 'ditgar');
    expect(preview().querySelector('.resume-side')!.textContent).toBe('SkillsLanguages: Python, R');
    expect(preview().querySelector('.resume-main')!.textContent).toContain('Chem Lab & Co');
  });

  it('Import LaTeX reads a pasted file, lists what it could not read, and replaces the resume only when asked, keeping the template', async () => {
    const user = userEvent.setup();
    render(<Host initial={{ ...initialWorkspace(), resume: { ...emptyResume(), profile: { ...emptyResume().profile, name: 'Old Name' }, template: 'scizor' } }}/>);
    await user.click(screen.getByRole('button', { name: 'Import LaTeX' }));
    const panel = screen.getByRole('region', { name: 'Import a LaTeX resume' });
    // user.type reads { and [ as key names, so the source is pasted the way a person would paste it.
    await user.click(within(panel).getByRole('textbox', { name: 'LaTeX source' }));
    await user.paste(TEX);
    await user.click(within(panel).getByRole('button', { name: 'Read it' }));
    const result = within(panel).getByRole('status');
    expect(result).toHaveTextContent('Found the name, 1 experience entry, 1 skills line.');
    expect(within(result).getAllByRole('listitem').map(li => li.textContent)).toEqual(['The Hobbies section has no place in this resume, so it was left out: "Climbing".']);
    // Nothing has changed yet.
    expect(within(profile()).getByLabelText('Name')).toHaveValue('Old Name');
    await user.click(within(panel).getByRole('button', { name: 'Replace my resume with this' }));
    expect(within(profile()).getByLabelText('Name')).toHaveValue('Lin Park');
    expect(result).toHaveTextContent('Imported. Found the name');
    expect(within(preview()).getByText('Chem Lab & Co')).toBeInTheDocument();
    await waitFor(async () => expect(await saved()).toMatchObject({ profile: { name: 'Lin Park', email: 'lin@example.com', location: 'Rockville, MD' }, skills: ['Languages: Python, R'], template: 'scizor' }), { timeout: 3000 });
    const [job] = (await saved())!.experience;
    expect(job).toMatchObject({ title: 'Chem Lab & Co', subtitle: 'Research Assistant', date: 'Jan. 2026 \u2013 Present', location: 'College Park, MD', bullets: ['Automated 90% of the titrations'] });
    expect(validateWorkspace(await loadWorkspace())).toBeTruthy();
  });

  it('Import LaTeX opens a .tex file too', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    await user.click(screen.getByRole('button', { name: 'Import LaTeX' }));
    await user.upload(screen.getByLabelText('Choose a .tex file'), new File([TEX], 'resume.tex', { type: 'application/x-tex' }));
    expect(await screen.findByText(/Found the name, 1 experience entry/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'LaTeX source' })).toHaveValue(TEX);
  });

  it('Export LaTeX downloads a .tex named for the person, which imports back to the same resume', async () => {
    const user = userEvent.setup();
    const { resume } = parseLatexResume(TEX);
    render(<Host initial={{ ...initialWorkspace(), resume }}/>);
    const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    create.mockClear();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('Lin-Park.tex'); });
    await user.click(screen.getByRole('button', { name: 'Export LaTeX' }));
    expect(click).toHaveBeenCalledTimes(1);
    const tex = await readBlob(create.mock.calls.at(-1)![0] as Blob);
    expect(tex).toContain('\\resumeSubheading');
    const back = parseLatexResume(tex).resume;
    expect(back.profile).toEqual(resume.profile);
    expect(back.experience.map(({ id: _id, ...e }) => e)).toEqual(resume.experience.map(({ id: _id, ...e }) => e));
    expect(back.skills).toEqual(resume.skills);
    click.mockRestore();
  });
});
