import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { splitFrontmatter, summary } from '../src/Skills';
import { Markdown } from '../src/Markdown';
import { initialWorkspace, loadWorkspace, makeDoc, saveWorkspace } from '../src/lib/storage';

// The Skills page lists what /api/skills reads from ~/.claude/skills, plus skills written in
// the browser. These fixtures have the same shape as the live route (server/live.mjs).
const installed = [
  { name: 'clean-up', slug: 'clean-up', description: 'Sweep this machine of stray processes.', skill: '---\nname: clean-up\ndescription: Sweep this machine of stray processes.\n---\n\n# clean-up\n\nA sweep, then a short report.', readme: null, files: ['SKILL.md', 'clean-up.ps1'], task: 'clean-up' },
  { name: 'generate', slug: 'generate', description: 'Generate images and videos through AI model APIs.', skill: '---\nname: generate\ndescription: Generate images and videos through AI model APIs.\n---\n\n# /generate\n\nOne command for making media.\n\nPick a model, then\nrun it.\n\n## Models\n\n| Task | Model | Cost |\n|---|---|---|\n| Image, default | Nano Banana 2 Lite | ~$0.034 / 1K image |\n\n**Read the recipe file** in `models/nano-banana-2.md` first.\n\n- **`Verified: not yet`** - fetch the Docs URL.', readme: null, files: ['SKILL.md'], task: null },
  { name: 'humanizer', slug: 'humanizer', description: 'Remove signs of AI-generated writing from text.', skill: '---\nname: humanizer\ndescription: |\n  Remove signs of AI-generated writing\n  from text.\nlicense: MIT\nmetadata:\n  version: "2.9.1"\n---\n\n# Humanizer: Remove AI Writing Patterns', readme: '# Humanizer README\n\n[![skills.sh installs](https://skills.sh/b/blader/humanizer)](https://skills.sh/blader/humanizer)\n\nInstall with git clone.\n\nSee [the guide](docs/guide.md).', files: ['README.md', 'SKILL.md'], task: null },
];
const tasks = [{ id: 'clean-up', label: 'Clean up', blurb: 'Kills stray headless browsers.', command: 'claude -p "/clean-up"', missing: null, run: null }];
let requests: { url: string; body: any }[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url); const body = options?.body ? JSON.parse(options.body) : undefined; requests.push({ url: path, body });
    const reply = path.endsWith('/status') ? { local: true, authRequired: false, providers: { claude: true, openai: false, gemini: true, kie: false, fal: false }, models: { claude: 'test-model' } }
      : path.endsWith('/skills') ? { skills: installed }
      : path.endsWith('/tasks') ? { tasks }
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
    expect(screen.getByRole('button', { name: /^Skills\s*\d*$/ })).toHaveTextContent(/^Skills3$/);
    // The old path to a skill is gone: nothing to browse and copy first.
    expect(screen.queryByRole('button', { name: /Browse installed|Browse skills|Save personal copy/ })).not.toBeInTheDocument();
  });

  it('groups the list under headings with counts: runnable skills first, then personal, then the rest', async () => {
    const workspace = initialWorkspace(); workspace.docs.push(makeDoc('Evidence review', 'Check the supporting evidence.', 'skill')); await saveWorkspace(workspace);
    await openSkills();
    const groups = screen.getAllByRole('heading', { level: 2 }).filter(h => h.classList.contains('skill-group'));
    expect(groups.map(h => h.textContent)).toEqual(['Runs here 1', 'Personal 1', 'Installed 2']);
    expect(screen.getAllByRole('link', { name: /^(clean-up|Evidence review|generate|humanizer)/ }).map(a => a.querySelector('strong')!.textContent)).toEqual(['clean-up', 'Evidence review', 'generate', 'humanizer']);
  });

  it('opens a skill as a page with README and SKILL.md tabs and frontmatter as labels', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^humanizer/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'humanizer' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('shows the Run control and its output area only where the runner can run the skill', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^clean-up/ }));
    const run = await screen.findByRole('button', { name: /^Run$/ });
    expect(run).toBeEnabled();
    expect(screen.getByRole('log', { name: /output/i })).toBeInTheDocument();
    await user.click(run);
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/run') && r.body.id === 'clean-up')).toBe(true));
    await user.click(screen.getByRole('link', { name: /All skills/ }));
    await user.click(await screen.findByRole('link', { name: /^generate/ }));
    await screen.findByRole('heading', { level: 1, name: 'generate' });
    expect(screen.queryByRole('button', { name: /^Run$/ })).not.toBeInTheDocument();
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

  it('keeps skills written in the browser, marked personal, and opens them as a page', async () => {
    const workspace = initialWorkspace(); const mine = makeDoc('Evidence review', 'Check the supporting evidence.', 'skill'); workspace.docs.push(mine); await saveWorkspace(workspace);
    const user = await openSkills();
    const row = screen.getByRole('link', { name: /^Evidence review/ });
    expect(row).toHaveTextContent('Personal');
    expect(screen.getByRole('button', { name: /^Skills\s*\d*$/ })).toHaveTextContent(/^Skills4$/);
    await user.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: 'Evidence review' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(location.hash).toBe('#skills/personal/' + mine.id);
    expect(screen.getByText('Check the supporting evidence.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('offers Duplicate to edit as an option that saves nothing until Save', async () => {
    const user = await openSkills();
    await user.click(screen.getByRole('link', { name: /^generate/ }));
    await user.click(await screen.findByRole('button', { name: /Duplicate to edit/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Title')).toHaveValue('generate');
    expect((within(dialog).getByRole('textbox', { name: /Instructions/ }) as HTMLTextAreaElement).value).toContain('# /generate');
    expect((await loadWorkspace()).docs.filter(doc => doc.kind === 'skill')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /Save skill/ }));
    await waitFor(async () => expect((await loadWorkspace()).docs.filter(doc => doc.kind === 'skill')).toHaveLength(1));
  });

  it('opens a skill page straight from its link', async () => {
    location.hash = '#skills/generate';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'generate' })).toBeInTheDocument();
    expect(screen.getByText('One command for making media.')).toBeInTheDocument();
    // The title names the skill once: SKILL.md's own "# /generate" is not shown again under it.
    expect(screen.queryByRole('heading', { name: '/generate' })).not.toBeInTheDocument();
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
    await screen.findByRole('heading', { level: 1, name: 'generate' });
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
  it('joins hard-wrapped lines on a skill page, but not in a note opened from Files', async () => {
    const workspace = initialWorkspace(); workspace.docs.push(makeDoc('Groceries', 'Groceries\nmilk\neggs\nbread')); await saveWorkspace(workspace);
    location.hash = '#skills/generate';
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'generate' });
    expect(screen.getByText('Pick a model, then run it.').tagName).toBe('P');
    await user.click(screen.getByRole('button', { name: /^Files\s*\d*$/ }));
    await user.click(await screen.findByRole('button', { name: /^Groceries/ }));
    expect([...screen.getByRole('dialog').querySelectorAll('.markdown p')].map(p => p.textContent)).toEqual(['Groceries', 'milk', 'eggs', 'bread']);
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
