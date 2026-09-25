import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { splitFrontmatter, summary } from '../src/Skills';
import { Markdown } from '../src/Markdown';
import { initialWorkspace, loadWorkspace, makeDoc, saveWorkspace } from '../src/lib/storage';

// The Skills page lists what /api/skills reads from ~/.claude/skills, plus skills written in
// the browser. These fixtures have the same shape as the live route (server/live.mjs).
// A synced plugin skill (pdf) is in here too: it lives one level deeper on disk, at
// synced/<bucket>/<slug>, and the page has to list it like any other installed skill.
const installed = [
  { name: 'clean-up', slug: 'clean-up', description: 'Sweep this machine of stray processes.', skill: '---\nname: clean-up\ndescription: Sweep this machine of stray processes.\n---\n\n# clean-up\n\nA sweep, then a short report.', readme: null, files: ['SKILL.md', 'clean-up.ps1'], path: 'clean-up', source: 'installed' as const, task: 'clean-up' },
  { name: 'generate', slug: 'generate', description: 'Generate images and videos through AI model APIs.', skill: '---\nname: generate\ndescription: Generate images and videos through AI model APIs.\n---\n\n# /generate\n\nOne command for making media.\n\nPick a model, then\nrun it.\n\n## Models\n\n| Task | Model | Cost |\n|---|---|---|\n| Image, default | Nano Banana 2 Lite | ~$0.034 / 1K image |\n\n**Read the recipe file** in `models/nano-banana-2.md` first.\n\n- **`Verified: not yet`** - fetch the Docs URL.', readme: null, files: ['SKILL.md'], path: 'generate', source: 'installed' as const, task: null },
  { name: 'humanizer', slug: 'humanizer', description: 'Remove signs of AI-generated writing from text.', skill: '---\nname: humanizer\ndescription: |\n  Remove signs of AI-generated writing\n  from text.\nlicense: MIT\nmetadata:\n  version: "2.9.1"\n---\n\n# Humanizer: Remove AI Writing Patterns', readme: '# Humanizer README\n\n[![skills.sh installs](https://skills.sh/b/blader/humanizer)](https://skills.sh/blader/humanizer)\n\nInstall with git clone.\n\nSee [the guide](docs/guide.md).', files: ['README.md', 'SKILL.md'], path: 'humanizer', source: 'installed' as const, task: null },
  { name: 'pdf', slug: 'pdf', description: 'Read, split, merge and fill PDF files.', skill: '---\nname: pdf\ndescription: Read, split, merge and fill PDF files.\n---\n\n# pdf\n\nEverything that touches a PDF.', readme: null, files: ['SKILL.md', 'scripts/fill.py'], path: 'synced/79b591c6-bucket/pdf', source: 'synced' as const, task: null },
];
// What /api/tasks answers (server/runner.mjs). A test that runs something sets doctorRun, never Clean up's.
const cleanUp = { id: 'clean-up', label: 'Clean up', blurb: 'Kills stray headless browsers.', command: 'claude -p "/clean-up"', missing: null, run: null };
const doctor = { id: 'doctor-plus', label: 'Doctor plus', blurb: 'Health check. Reports only.', command: 'claude -p "/doctor-plus"', missing: null };
let doctorRun: object | null = null;
let requests: { url: string; body: any }[] = [];

beforeEach(() => {
  requests = [];
  doctorRun = null;
  localStorage.clear(); // the grid or list choice is remembered in localStorage; each test starts fresh
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url); const body = options?.body ? JSON.parse(options.body) : undefined; requests.push({ url: path, body });
    const reply = path.endsWith('/status') ? { local: true, authRequired: false, providers: { claude: true, openai: false, gemini: true, kie: false, fal: false }, models: { claude: 'test-model' } }
      : path.endsWith('/skills') ? { skills: installed }
      : path.endsWith('/tasks') ? { tasks: [cleanUp, { ...doctor, run: doctorRun }] }
      : path.endsWith('/run') ? { ok: true }
      : path.endsWith('/chat') ? { text: 'TEST FIXTURE: answer' } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

async function openSkills() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: /Capture a thought/ });
  await user.click(screen.getByRole('button', { name: /^Skills\s*\d*$/ }));
  await screen.findByRole('link', { name: /^humanizer/ });
  return user;
}

describe('Skills page, live from disk', () => {
  it('lists every installed skill with its description, and the sidebar count matches', async () => {
    await openSkills();
    for (const skill of installed) {
      const row = screen.getByRole('link', { name: new RegExp('^' + skill.name) });
      expect(row).toHaveTextContent(skill.description);
    }
    expect(screen.getByRole('button', { name: /^Skills\s*\d*$/ })).toHaveTextContent(/^Skills4$/);
    // The old path to a skill is gone: nothing to browse and copy first.
    expect(screen.queryByRole('button', { name: /Browse installed|Browse skills|Save personal copy/ })).not.toBeInTheDocument();
  });

  // Round 3 of the resumed run, visual critic: "the right rail repeats the 'Runs here' group, so the same
  // two items appear twice on one screen ... drop the 'Runs here' group from the list". This replaces
  // "runnable skills first, then personal, then the rest" with the same assertion minus that group: the
  // runnable skills are named once on the page, in the run column, and are listed like any other skill.
  it('groups the list under headings with counts: personal first, then the rest, with the runnable skills named only in the run column', async () => {
    const workspace = initialWorkspace(); workspace.docs.push(makeDoc('Evidence review', 'Check the supporting evidence.', 'skill')); await saveWorkspace(workspace);
    await openSkills();
    const groups = screen.getAllByRole('heading', { level: 2 }).filter(h => h.classList.contains('skill-group'));
    expect(groups.map(h => h.textContent)).toEqual(['Personal 1', 'Installed 4']);
    expect(screen.getAllByRole('link', { name: /^(clean-up|Evidence review|generate|humanizer|pdf)/ }).map(a => a.querySelector('strong')!.textContent)).toEqual(['Evidence review', 'clean-up', 'generate', 'humanizer', 'pdf']);
    const runs = screen.getByRole('complementary', { name: 'Run on this computer' });
    expect(within(runs).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Clean up', 'Doctor plus']);
    expect(groups.some(h => /Runs here/.test(h.textContent || ''))).toBe(false);
  });

  it('opens a skill in a pop-up over the page, with README and SKILL.md tabs, frontmatter as labels, and its files', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^humanizer/ }));
    const panel = await screen.findByRole('dialog', { name: 'humanizer' });
    expect(within(panel).getByRole('heading', { name: 'humanizer' })).toBeInTheDocument();
    // P2b replaced "a page, not a dialog": the skill opens in a pop-up (a dialog) and the grid stays on the page under it.
    expect(screen.getByRole('link', { name: /^generate/ })).toBeInTheDocument();
    // P2b: the pop-up lists every file in the skill's folder, as Claude's own skill viewer does.
    const files = within(panel).getByRole('region', { name: /^Files/ });
    expect(within(files).getAllByRole('listitem').map(li => li.textContent)).toEqual(['README.md', 'SKILL.md']);
    // Round 2, visual critic: the files were a rail beside the document, in a column of their own that
    // ran out 380px above its foot. They follow the document in its column now, on the same measure.
    const doc = within(panel).getByRole('tabpanel');
    expect(files.previousElementSibling).toBe(doc.closest('.skill-doc'));
    expect(files.parentElement).toBe(doc.closest('.skill-dialog-main'));
    expect(location.hash).toBe('#skills/humanizer');
    expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Install with git clone.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'SKILL.md' }));
    expect(screen.getByRole('tab', { name: 'SKILL.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Humanizer: Remove AI Writing Patterns')).toBeInTheDocument();
    // Frontmatter is shown as labelled fields, never as raw YAML.
    const fields = screen.getByRole('list', { name: 'Skill details' });
    expect(within(fields).getByText('license')).toBeInTheDocument();
    expect(within(fields).getByText('MIT')).toBeInTheDocument();
    expect(within(fields).getByText('Remove signs of AI-generated writing from text.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('license: MIT');
    expect(document.body.textContent).not.toContain('description: |');
  });

  // P2b moved Run off the skill's own page into a column of run boxes on the Skills page, one per runner
  // task. "Only where the runner can run the skill" is now: a box per task, and no Run inside any pop-up.
  it('shows the Run control and its output area only where the runner can run the skill', async () => {
    const user = await openSkills();
    const runs = screen.getByRole('complementary', { name: 'Run on this computer' });
    expect(await within(runs).findByRole('button', { name: 'Run Clean up' })).toBeEnabled();
    expect(within(runs).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Clean up', 'Doctor plus']);
    expect(within(runs).getByRole('log', { name: 'Clean up output' })).toBeInTheDocument();
    await user.click(within(runs).getByRole('button', { name: 'Run Doctor plus' })); // never Clean up, even with the server stubbed
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/run') && r.body.id === 'doctor-plus')).toBe(true));
    for (const name of ['clean-up', 'generate']) {
      await user.click(screen.getByRole('link', { name: new RegExp('^' + name) }));
      const dialog = await screen.findByRole('dialog', { name });
      expect(within(dialog).queryByRole('button', { name: /^Run/ })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('log')).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Close' })); // P2b: the pop-up's Close replaced the page's All skills link
    }
  });

  it('uses an installed skill in Chat without saving a copy first', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    await user.click(await screen.findByRole('button', { name: /Use in Chat/ }));
    expect(await screen.findByRole('button', { name: 'Remove generate from context' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message'), 'Make me a poster');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('TEST FIXTURE: answer')).toBeInTheDocument();
    const sent = requests.find(r => r.url.endsWith('/chat'))!.body;
    expect(sent.context).toHaveLength(1);
    expect(sent.context[0].name).toBe('generate');
    expect(sent.context[0].content).toContain('One command for making media.');
    expect((await loadWorkspace()).docs.filter(doc => doc.kind === 'skill')).toHaveLength(0);
  });

  it('keeps skills written in the browser, marked personal, and opens them in the pop-up', async () => {
    const workspace = initialWorkspace(); const mine = makeDoc('Evidence review', 'Check the supporting evidence.', 'skill'); workspace.docs.push(mine); await saveWorkspace(workspace);
    const user = await openSkills();
    const row = screen.getByRole('link', { name: /^Evidence review/ });
    expect(row).toHaveTextContent('Personal');
    expect(screen.getByRole('button', { name: /^Skills\s*\d*$/ })).toHaveTextContent(/^Skills5$/);
    await user.click(row);
    const panel = await screen.findByRole('dialog', { name: 'Evidence review' });
    expect(within(panel).getByRole('heading', { name: 'Evidence review' })).toBeInTheDocument();
    // P2b replaced "a page, not a dialog": the grid, this skill's card included, stays under the pop-up.
    expect(screen.getByRole('link', { name: /^Evidence review/ })).toBeInTheDocument();
    expect(location.hash).toBe('#skills/personal/' + mine.id);
    expect(within(panel).getByText('Check the supporting evidence.')).toBeInTheDocument(); // the card shows it too, so read it in the pop-up
    expect(within(panel).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('offers Duplicate to edit as an option that saves nothing until Save', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    await user.click(await screen.findByRole('button', { name: /Duplicate to edit/ }));
    const dialog = screen.getByRole('dialog', { name: 'New skill' }); // the skill's pop-up is a dialog too now (P2b), so name the editor
    expect(within(dialog).getByLabelText('Title')).toHaveValue('generate');
    expect((within(dialog).getByRole('textbox', { name: /Instructions/ }) as HTMLTextAreaElement).value).toContain('# /generate');
    expect((await loadWorkspace()).docs.filter(doc => doc.kind === 'skill')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /Save skill/ }));
    await waitFor(async () => expect((await loadWorkspace()).docs.filter(doc => doc.kind === 'skill')).toHaveLength(1));
  });

  it('opens a skill pop-up straight from its link, with the grid under it', async () => {
    location.hash = '#skills/generate';
    render(<App />);
    const panel = await screen.findByRole('dialog', { name: 'generate' });
    expect(within(panel).getByRole('heading', { name: 'generate' })).toBeInTheDocument();
    expect(within(panel).getByText('One command for making media.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^humanizer/ })).toBeInTheDocument();
    // The title names the skill once: SKILL.md's own "# /generate" is not shown again under it.
    expect(screen.queryByRole('heading', { name: '/generate' })).not.toBeInTheDocument();
  });

  // A deep link opens the pop-up before /api/skills has answered. Until it does, the skill is not missing,
  // it is not read yet, and the title has to say so: it is the dialog's accessible name, so a screen reader
  // announced "Skill not found" on every cold #skills/<slug>. Holding the skills answer open keeps the page
  // in that first state for as long as the test needs it.
  it('titles a deep-linked pop-up as loading until the skill list arrives, and Skill not found only when the skill really is missing', async () => {
    let answer = () => {};
    const held = new Promise<void>(resolve => { answer = resolve; });
    const live = globalThis.fetch as typeof fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => { if (String(url).endsWith('/skills')) await held; return live(url, options); }));
    location.hash = '#skills/generate';
    render(<App />);
    const loading = await screen.findByRole('dialog', { name: /^Loading skill/ });
    expect(within(loading).getByText(/Reading ~\/\.claude\/skills/)).toBeInTheDocument();
    expect(screen.queryByText(/Skill not found|may have been removed/)).not.toBeInTheDocument();
    answer();
    expect(await screen.findByRole('dialog', { name: 'generate' })).toBeInTheDocument();
    // The same pop-up, once the list is in, on a slug that is not in it
    location.hash = '#skills/no-such-skill';
    const gone = await screen.findByRole('dialog', { name: 'Skill not found' });
    expect(within(gone).getByText(/Nothing at #skills\/no-such-skill/)).toBeInTheDocument();
    cleanup(); location.hash = '';
  });

  it('shows a nested metadata block as its own labels, never as YAML inside one label', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^humanizer/ }));
    const fields = await screen.findByRole('list', { name: 'Skill details' });
    const labels = within(fields).getAllByRole('listitem').map(li => [li.children[0].textContent, li.children[1].textContent]);
    expect(labels).toContainEqual(['version', '2.9.1']);
    for (const [, value] of labels) {
      expect(value).not.toMatch(/(^|\s)[\w.-]+:(\s|$)/); // no `key:` text left inside a value
      expect(value).not.toMatch(/^["']|["']$/);          // no YAML quotes around a value
    }
  });

  it('renders SKILL.md markdown: a real table, inline code as chips, bold as bold', async () => {
    location.hash = '#skills/generate';
    render(<App />);
    await screen.findByRole('dialog', { name: 'generate' });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Task', 'Model', 'Cost']);
    expect(within(table).getByRole('cell', { name: '~$0.034 / 1K image' })).toHaveClass('num');
    expect(screen.getByText('models/nano-banana-2.md').tagName).toBe('CODE');
    expect(screen.getByText('Read the recipe file').tagName).toBe('STRONG');
    expect(screen.getByText('Verified: not yet').tagName).toBe('CODE'); // code inside bold, as the real generate SKILL.md has
    expect(screen.getByText('Verified: not yet').parentElement!.tagName).toBe('STRONG');
    // generate has one document, so no tab bar: the document is a region named after its file.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'SKILL.md' }).textContent).not.toMatch(/\|\s*-{3}|\*\*|`/);
  });

  it('renders README links: a web link opens in a new tab, a badge image shows its alt text, a relative link its text', async () => {
    location.hash = '#skills/humanizer';
    render(<App />);
    const link = await screen.findByRole('link', { name: 'skills.sh installs' });
    expect(link).toHaveAttribute('href', 'https://skills.sh/blader/humanizer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('See the guide.')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel').textContent).not.toMatch(/\]\(|!\[/);
  });

  // Run 3, round 2 critic: the line join is scoped to skill documents. On a skill page a hard-wrapped
  // SKILL.md paragraph reads as one; a note in the Files preview keeps a paragraph per typed line.
  it('joins hard-wrapped lines on a skill page, but not in a note opened from search', async () => {
    const workspace = initialWorkspace(); workspace.docs.push(makeDoc('Groceries', 'Groceries\nmilk\neggs\nbread')); await saveWorkspace(workspace);
    location.hash = '#skills/generate';
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('dialog', { name: 'generate' });
    expect(screen.getByText('Pick a model, then run it.').tagName).toBe('P');
    // Files is no longer a page: a note's preview is reached from the workspace search (Ctrl K).
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByLabelText('Search files, goals and conversations'), 'Groceries');
    await user.click(await screen.findByRole('button', { name: /^Groceries/ }));
    expect([...screen.getByRole('dialog').querySelectorAll('.markdown p')].map(p => p.textContent)).toEqual(['Groceries', 'milk', 'eggs', 'bread']);
  });
});

// P2b: Andrew asked for the Skills page to work like Linkwarden's links view: a card grid or a list,
// picked with a two-button switch, and a skill's detail in a centred pop-up rather than a new page.
describe('Skills page, grid or list, with a pop-up', () => {
  it('shows a card grid by default, switches to a list, and remembers the choice in this browser', async () => {
    const user = await openSkills();
    const grid = screen.getByRole('button', { name: 'Grid view' }), list = screen.getByRole('button', { name: 'List view' });
    expect(screen.getByRole('group', { name: 'View' })).toContainElement(grid);
    // Round 3, visual critic: the toolbar had no primary, so New skill, the search and the switch read as
    // three interchangeable chips. New skill is the one button on the page that carries the accent fill.
    expect(screen.getByRole('button', { name: /New skill/ })).toHaveClass('primary');
    expect([grid, list].some(b => b.classList.contains('primary'))).toBe(false);
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    expect(list).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: /^generate/ })).toHaveClass('skill-card');
    await user.click(list);
    expect(list).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: /^generate/ })).toHaveClass('skill-row');
    // The groups stay in the list too
    expect(screen.getAllByRole('heading', { level: 2 }).filter(h => h.classList.contains('skill-group')).map(h => h.textContent)).toEqual(['Installed 4']);
    expect(localStorage.getItem('skills-view')).toBe('list');
    cleanup(); location.hash = '';
    await openSkills();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: /^generate/ })).toHaveClass('skill-row');
  });

  // Round 3, visual critic: the Scripts chip had a column only on the rows that carried a chip, so the
  // summary on a row without one ran further right and the trailing edge of the list zigzagged. Every row
  // has the same trailing columns now, the chip slot reserved and empty where the skill has no scripts.
  it('gives every list row the same trailing columns: a Scripts slot, empty or not, then the count', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('button', { name: 'List view' }));
    const rows = screen.getAllByRole('link', { name: /^(clean-up|generate|humanizer)/ });
    expect(rows.map(row => row.querySelector('strong')!.textContent)).toEqual(['clean-up', 'generate', 'humanizer']);
    for (const row of rows) expect(row.querySelector('.skill-row-kind')).toBeInTheDocument();
    expect(rows.map(row => row.querySelector('.skill-row-kind')!.textContent)).toEqual(['Scripts', '', '']); // only clean-up ships a script
    // Round 3 of the resumed run, visual critic: "'Scripts' appears only on some rows, so the '2 files' /
    // '214 files' values float". The count is two cells, the number and the word, each with its own column.
    expect(rows.map(row => row.querySelector('.skill-row-num')!.textContent)).toEqual(['2', '1', '2']);
    expect(rows.map(row => row.querySelector('.skill-row-unit')!.textContent)).toEqual(['files', 'file', 'files']);
  });

  it('still switches views when this browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    const user = await openSkills();
    expect(screen.getByRole('link', { name: /^generate/ })).toHaveClass('skill-card');
    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('link', { name: /^generate/ })).toHaveClass('skill-row');
  });

  it('opens as a modal pop-up with focus inside, and on Escape or Close puts focus back on the card', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    const panel = await screen.findByRole('dialog', { name: 'generate' });
    await waitFor(() => expect(panel).toHaveFocus());
    // The side panel marked its card aria-current to be found beside it; the pop-up is modal instead (showModal), with the page behind out of reach.
    expect(showModal.mock.contexts).toContain(panel);
    // Round 3, visual critic: the document was cut flat by the viewport with nothing under it. The pop-up
    // ends in a foot bar, the last thing inside the frame, which says the way out from the keyboard.
    expect(panel.lastElementChild).toHaveClass('skill-dialog-foot');
    expect(panel.lastElementChild).toHaveTextContent(/Esc closes/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(location.hash).toBe('#skills');
    await waitFor(() => expect(screen.getByRole('link', { name: /^generate/ })).toHaveFocus());
    await user.click(screen.getByRole('link', { name: /^humanizer/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'humanizer' })).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('link', { name: /^humanizer/ })).toHaveFocus());
  });

  // Round 3 of the resumed run, visual critic: the head "stacks a 26px title, a tiny monospace path and a
  // truncated one-line description with a More link ... let the body open with the full description". This
  // replaces "caps a long description and offers More to read the rest": the description is the first block
  // of the body, whole, so there is nothing left to uncap and the head is the title and one meta row.
  it('opens the pop-up body with the whole description, and keeps the head to the title and one meta row', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    const panel = await screen.findByRole('dialog', { name: 'generate' });
    const lede = panel.querySelector('.skill-lede-text')!;
    expect(lede.textContent).toBe(installed[1].description); // the whole description, not a cut of it
    expect(within(panel).queryByRole('button', { name: /^(More|Less)$/ })).not.toBeInTheDocument();
    const body = panel.querySelector('.skill-dialog-body')!;
    expect(body.firstElementChild).toBe(lede.closest('.skill-fields'));
    const head = panel.querySelector('.skill-dialog-head')!;
    expect(head.contains(lede)).toBe(false);
    expect(head.lastElementChild).toHaveClass('skill-path');
  });

  // T10: a plugin skill syncs into ~/.claude/skills/synced/<bucket>/<slug>, one level below the folders
  // the page used to read, so 16 skills on this machine were missing from a page whose badge still said it
  // listed every installed skill. They are listed now, tagged Synced on the card, and the pop-up's path
  // line names the real file rather than a folder that does not exist.
  it('lists a synced plugin skill, tags where it came from, and names its real path', async () => {
    const user = await openSkills();
    const card = screen.getByRole('link', { name: /^pdf/ });
    expect(card).toHaveTextContent('Read, split, merge and fill PDF files.');
    expect([...card.querySelectorAll('.tag')].map(tag => tag.textContent)).toEqual(['Synced', 'Scripts']);
    expect([...screen.getByRole('link', { name: /^generate/ }).querySelectorAll('.tag')].map(tag => tag.textContent)).toEqual([]);
    await user.click(card);
    const panel = await screen.findByRole('dialog', { name: 'pdf' });
    expect(panel.querySelector('.skill-path')).toHaveTextContent('~/.claude/skills/synced/79b591c6-bucket/pdf/SKILL.md · 2 files');
  });

  it('keeps Tab and Shift+Tab inside the pop-up', async () => {
    location.hash = '#skills/humanizer';
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole('dialog', { name: 'humanizer' });
    await waitFor(() => expect(panel).toHaveFocus());
    // Round 6, visual critic: the actions moved out of the title band into the foot's action bar, so the
    // first stop is Close at the top and the last is Use in Chat at the bottom right. Same assertion, new ends.
    const first = within(panel).getByRole('button', { name: 'Close' });
    const last = within(panel).getByRole('button', { name: /Use in Chat/ });
    expect(panel.querySelector('.skill-dialog-foot')).toContainElement(last); // the action bar, not the title band
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('leaves Escape to a dialog opened over the pop-up', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    await user.click(await screen.findByRole('button', { name: /Duplicate to edit/ }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'generate' })).toBeInTheDocument();
    expect(location.hash).toBe('#skills/generate');
  });
});

// P2b: the run boxes. Each run here is Doctor plus's, answered by the fetch stub above; nothing runs.
describe('Skills page, run boxes', () => {
  const started = () => new Date(Date.now() - 5000).toISOString();

  it('starts a run with one click, shows it running with its time and output, then the Takeaways', async () => {
    const user = await openSkills();
    const box = await screen.findByRole('region', { name: 'Doctor plus' });
    // Round 3, visual critic: before the first run the box still says where the output will appear, but
    // that line is plain copy, not the log's monospace pretending to be output (skills.css).
    expect(within(box).getByRole('log', { name: 'Doctor plus output' })).toHaveClass('run-output-empty');
    doctorRun = { status: 'running', started: started(), finished: null, exit: null, output: 'Reading settings.json\n', summary: null };
    await user.click(within(box).getByRole('button', { name: 'Run Doctor plus' }));
    expect(await within(box).findByText(/^Running · \d+s$/)).toBeInTheDocument();
    expect(within(box).getByRole('log', { name: 'Doctor plus output' })).toHaveTextContent('Reading settings.json');
    expect(within(box).getByRole('log', { name: 'Doctor plus output' })).not.toHaveClass('run-output-empty');
    expect(within(box).getByRole('button', { name: 'Run Doctor plus' })).toBeDisabled();
    expect(location.hash).toBe('#skills'); // no second page
    doctorRun = { status: 'done', started: started(), finished: new Date().toISOString(), exit: 0, output: 'Reading settings.json\nAll checks ran\n', summary: '## Findings\n\n- **Settings**: clean' };
    const takeaways = await within(box).findByRole('heading', { name: 'Takeaways' }, { timeout: 3000 }); // the next poll, a second later
    expect(takeaways.parentElement).toHaveTextContent('Settings: clean');
    expect(within(takeaways.parentElement!).getByText('Settings').tagName).toBe('STRONG');
    expect(within(box).getByRole('log', { name: 'Doctor plus output' })).toHaveTextContent('All checks ran');
    expect(within(box).getByRole('button', { name: 'Run Doctor plus' })).toBeEnabled();
  });

  // Round 2: a finished run's output folds to a short preview, so the box stays compact; while a
  // run is going the log is always open, streaming. The cap on Takeaways itself is CSS (skills.css).
  it('collapses a finished run\'s long output to a preview, and Show all output opens it', async () => {
    doctorRun = { status: 'done', started: started(), finished: new Date().toISOString(), exit: 0, output: Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n', summary: 'All good.' };
    const user = await openSkills();
    const box = await screen.findByRole('region', { name: 'Doctor plus' });
    const log = within(box).getByRole('log', { name: 'Doctor plus output' });
    expect(log).toHaveClass('run-output-collapsed');
    // The preview holds the lines it shows, so none of them is clipped through the middle
    expect(log).toHaveTextContent('line 1 line 2 line 3');
    expect(log).not.toHaveTextContent('line 4');
    await user.click(within(box).getByRole('button', { name: 'Show all output (12 lines)' }));
    expect(log).not.toHaveClass('run-output-collapsed');
    expect(log).toHaveTextContent('line 12');
    await user.click(within(box).getByRole('button', { name: 'Collapse output' }));
    expect(log).toHaveClass('run-output-collapsed');
    expect(log).not.toHaveTextContent('line 12');
  });

  it('says why a run failed and what to do next; out of usage credits links to the usage page', async () => {
    const credits = "You're out of usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";
    doctorRun = { status: 'failed', started: started(), finished: new Date().toISOString(), exit: 1, output: credits + '\n', summary: credits };
    await openSkills();
    const box = await screen.findByRole('region', { name: 'Doctor plus' });
    const failure = await within(box).findByRole('alert');
    expect(failure).toHaveTextContent('out of usage credits');
    expect(within(failure).getByRole('link', { name: 'claude.ai/settings/usage' })).toHaveAttribute('href', 'https://claude.ai/settings/usage');
    expect(failure).toHaveTextContent(/run it again/);
    expect(within(box).queryByRole('heading', { name: 'Takeaways' })).not.toBeInTheDocument();
    cleanup(); location.hash = '';
    doctorRun = { status: 'failed', started: started(), finished: new Date().toISOString(), exit: 1, output: 'Checking hooks\nError: could not read settings.json\n', summary: null };
    await openSkills();
    const other = await within(await screen.findByRole('region', { name: 'Doctor plus' })).findByRole('alert');
    expect(other).toHaveTextContent('It stopped with exit 1: Error: could not read settings.json');
    expect(other).toHaveTextContent(/run it again/);
  });
});

// Shapes the installed skills really use, found raw on their pages in round 3.
describe('Markdown', () => {
  it('keeps an escaped pipe inside a code cell and shows every cell of a row', () => {
    render(<Markdown content={'| Variable | Effect |\n|---|---|\n| `DCG_COLOR=auto\\|always\\|never` | Color mode |\n| a | b | extra |'}/>);
    expect(screen.getByText('DCG_COLOR=auto|always|never').tagName).toBe('CODE');
    expect(screen.getByRole('cell', { name: 'Color mode' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'extra' })).toBeInTheDocument();
  });

  // A link's label is inline text: archify's SKILL.md writes [`renderers/workflow/README.md`](...),
  // which left the backticks on the page when only the text between links was read as inline.
  it('reads a code span inside a link label, in a web link and in a relative one', () => {
    render(<Markdown content={'See [`a/README.md`](https://example.com/a) and [`b/README.md`](b/README.md#here).'}/>);
    expect(screen.getByRole('link', { name: 'a/README.md' })).toHaveAttribute('href', 'https://example.com/a');
    for (const path of ['a/README.md', 'b/README.md']) expect(screen.getByText(path).tagName).toBe('CODE');
    expect(screen.getByText(/^See/).textContent).not.toMatch(/`|\]\(/);
  });

  // P2b round 6: caveman-compress (installed 2026-09-22) writes code spans whose content is itself
  // backticks, and a lone ``` its prose never closes. Closing every span at the next backtick turned
  // the first into "CODE`CODE" on its page, which P2's "no raw markdown" walk caught.
  it('matches a code span by the length of its backtick run, and leaves a run nothing closes as text', () => {
    const { container } = render(<Markdown content={'- Code blocks (` ``` ` fenced or indented)\n- Inline code (`` `backtick content` ``)\n- Code blocks (fenced ``` and indented)'}/>);
    const [one, two, three] = [...container.querySelectorAll('.markdown-bullet')];
    const outside = (item: Element) => [...item.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('');
    expect(one.querySelector('code')).toHaveTextContent('```');
    expect(two.querySelector('code')).toHaveTextContent('`backtick content`');
    expect(outside(one) + outside(two)).not.toMatch(/`/);
    expect(three.querySelector('code')).toBeNull();
    expect(three.textContent).toBe('Code blocks (fenced ``` and indented)');
  });

  it('keeps a hyphenated or slashed word in a table cell whole, bold or not, and leaves plain words and prose alone', () => {
    render(<Markdown content={'| Issue | Fix |\n|---|---|\n| **Low-contrast** text | Respect reduced-motion on Twitter/X |\n\nA well-known phrase.'}/>);
    for (const word of ['Low-contrast', 'reduced-motion', 'Twitter/X']) expect(screen.getByText(word)).toHaveClass('nowrap');
    expect(screen.getByRole('cell', { name: 'Respect reduced-motion on Twitter/X' })).toBeInTheDocument();
    expect(screen.getByText('A well-known phrase.').tagName).toBe('P');
  });

  it('lets Chinese text in a table cell break between characters, as CJK typography does', () => {
    const { container } = render(<Markdown content={'| Request | Example |\n|---|---|\n| Colors | "What style fits?"、"推荐配色" |'}/>);
    expect(screen.getByRole('cell', { name: '"What style fits?"、"推荐配色"' })).toBeInTheDocument();
    expect([...container.querySelectorAll('.nowrap')].filter(span => /[\u2e80-\u9fff]/.test(span.textContent!))).toHaveLength(0);
  });

  it('joins hard-wrapped lines into one paragraph when asked, but not bullets or numbered lines', () => {
    render(<Markdown joinLines content={'The script does the mechanical part; you do the\npart that needs judgment.\n\n1. One\n2. Two\n- A bullet that\n  wraps'}/>);
    expect(screen.getByText('The script does the mechanical part; you do the part that needs judgment.').tagName).toBe('P');
    expect(screen.getByText('1. One')).toBeInTheDocument();
    expect(screen.getByText('2. Two')).toBeInTheDocument();
    expect(screen.getByText('A bullet that wraps')).toHaveClass('markdown-bullet');
  });

  // Run 3, round 2 critic: joining lines is for Markdown files from disk, which hard-wrap their prose.
  // A note, a file preview or a chat message is typed with single line breaks that each mean a line.
  it('keeps each typed line its own paragraph unless joinLines is set, in a quote too', () => {
    const { container } = render(<Markdown content={'Groceries\nmilk\neggs\nbread\n\n> first\n> second'}/>);
    expect([...container.querySelectorAll('.markdown > p')].map(p => p.textContent)).toEqual(['Groceries', 'milk', 'eggs', 'bread']);
    expect([...container.querySelectorAll('blockquote p')].map(p => p.textContent)).toEqual(['first', 'second']);
  });

  it('renders quotes (with bullets inside), #### headings, nested bullets, italics and rules', () => {
    const { container } = render(<Markdown content={'> Clean-up ran.\n>\n> - Killed: nothing\n\n#### Options\n\n1. Step\n   - Sub item\n\nWhat *would* be cleaned.\n\n---'}/>);
    const quote = container.querySelector('blockquote')!;
    expect(quote).toHaveTextContent('Clean-up ran.');
    expect(within(quote).getByText('Killed: nothing')).toHaveClass('markdown-bullet');
    expect(screen.getByRole('heading', { level: 5, name: 'Options' })).toBeInTheDocument();
    expect(screen.getByText('Sub item')).toHaveStyle({ marginLeft: '18px' });
    expect(screen.getByText('would').tagName).toBe('EM');
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^\s*[>#*-]|\*would\*|---/m);
  });

  it('shows task boxes as boxes and HTML entities as their characters, but keeps entities in code literal', () => {
    const { container } = render(<Markdown content={'- [ ] Five or fewer tabs\n- [x] Done already\n\n| Rule | Check |\n|---|---|\n| Reserve space | CLS &lt; 0.1 and `a &lt; b` |'}/>);
    expect(screen.getByText('Five or fewer tabs')).toHaveClass('markdown-task');
    expect(screen.getByText('Done already')).toHaveClass('markdown-task', 'done');
    expect(screen.getByText('Done already')).not.toHaveClass('markdown-bullet');
    expect(screen.getByRole('cell', { name: /CLS < 0\.1/ })).toBeInTheDocument();
    expect(screen.getByText('a &lt; b').tagName).toBe('CODE');
    expect(container.textContent).not.toMatch(/\[[ x]\]|CLS &lt;/);
  });

  // Round 5 of the resumed run: with the synced plugin skills listed, two of their SKILL.md files showed
  // their ** in the pop-up. Both hold an asterisk inside the bold run, which the old pattern forbade:
  // xlsx nests an italic, import-memory writes a glob as \*.
  it('renders a bold run that holds an asterisk: a nested italic, and an asterisk written out as \\*', () => {
    const { container } = render(<Markdown content={'**A workbook *you create* for someone** and **never write to /preferences/\\*.** Done.'}/>);
    expect(screen.getByText('you create').tagName).toBe('EM');
    expect(container.querySelectorAll('strong')).toHaveLength(2);
    expect(container.textContent).toBe('A workbook you create for someone and never write to /preferences/*. Done.');
  });
});

// Real descriptions from ~/.claude/skills. Round 4: the old cut left "Comprehensive design skill"
// and "UI/UX design intelligence.", which do not say what the skill does.
describe('summary', () => {
  it('fits one line: whole when short, else whole sentences, else a clause with an ellipsis', () => {
    expect(summary('Generate images and videos through AI model APIs. Routes each request.')).toBe('Generate images and videos through AI model APIs. Routes each request.');
    expect(summary('Generate images and videos through AI model APIs. Routes each request to the cheapest capable model, quotes cost before any paid video run.')).toBe('Generate images and videos through AI model APIs.');
    expect(summary('Comprehensive design skill: brand identity, design tokens, UI styling, logo generation (55 styles, Gemini AI), corporate identity program (50 deliverables, CIP mockups), HTML presentations.')).toBe('Comprehensive design skill: brand identity, design tokens, UI styling, logo generation…');
    expect(summary('UI/UX design intelligence. Searchable local database with 67 styles, 161 palettes, 57 font pairings, 25 charts, and 21 stacks (React, Next.js, Vue).')).toBe('UI/UX design intelligence. Searchable local database with 67 styles, 161 palettes, 57 font pairings…');
    expect(summary('Destructive Command Guard - High-performance Rust hook for Claude Code that blocks dangerous commands before execution.')).toBe('Destructive Command Guard - High-performance Rust hook for Claude Code that blocks dangerous…');
  });

  // Round 6: the list measures its column and passes that as `fits`, so the cut lands where the row ends.
  it('cuts where a given measure says the row ends: at a clause late in the row, else at the last word that fits', () => {
    const fits = (text: string) => text.length <= 80;
    expect(summary('Build fluid, ripple, droplet and glass surface effects for a web UI, without wrecking the bundle or the frame budget.', fits)).toBe('Build fluid, ripple, droplet and glass surface effects for a web UI…');
    // The comma after "projects" ends only 51 of 80 characters in, which would leave the row a third empty.
    expect(summary('Answer a question about your own files and projects, past decisions or preferences by querying the local second-brain index.', fits)).toBe('Answer a question about your own files and projects, past decisions or…');
    for (const text of ['Build fluid, ripple, droplet and glass surface effects for a web UI, without wrecking the bundle or the frame budget.', 'Answer a question about your own files and projects, past decisions or preferences by querying the local second-brain index.']) expect(fits(summary(text, fits))).toBe(true);
  });
});

describe('splitFrontmatter', () => {
  it('reads the shapes installed skills use: quoted values, block scalars and a nested metadata map', () => {
    const banner = splitFrontmatter('---\nname: banner-design\ndescription: "Design banners. Actions: design, create."\nargument-hint: "[platform] [style]"\nlicense: MIT\nmetadata:\n  author: claudekit\n  version: "1.0.0"\n---\n\n# Banner');
    expect(banner.fields).toEqual([['name', 'banner-design'], ['description', 'Design banners. Actions: design, create.'], ['argument-hint', '[platform] [style]'], ['license', 'MIT'], ['author', 'claudekit'], ['version', '1.0.0']]);
    expect(banner.body).toBe('# Banner');
    // An indented line under a `|` block is text, even when it has a colon in it.
    const humanizer = splitFrontmatter('---\nname: humanizer\ndescription: |\n  Detects and fixes patterns including:\n  inflated symbolism.\nlicense: MIT\nmetadata:\n  version: "2.9.1"\n---\n');
    expect(humanizer.fields).toEqual([['name', 'humanizer'], ['description', 'Detects and fixes patterns including: inflated symbolism.'], ['license', 'MIT'], ['version', '2.9.1']]);
  });
});
