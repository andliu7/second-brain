// The Network page in a test DOM: the file tree, the viewer and the map share one selection,
// the tree expands lazily and answers the keyboard, the viewer renders by kind and pages a
// large file through Load more, and Open on device never fires without a click. The map's
// canvas has no 2D context here, so the page runs without it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Network from '../src/Network';
import App from '../src/App';
import { buildModel, layout, localScene, searchNodes } from '../src/lib/network';

// A payload shaped like /api/graph: parents before children, one root, two departments.
const node = (id: string, name: string, kind: string, parent: number, extra: Partial<{ layer: string; root: number; size: number }> = {}) => ({ id, name, kind, layer: extra.layer ?? '', parent, root: extra.root ?? 0, size: extra.size ?? 0, mtime: 0 });
const payload = {
  roots: [{ path: 'C:/Users/andrew/Downloads/Projects', count: 5 }],
  nodes: [
    node('dept1', 'Chemistry apps', 'dept', -1, { layer: 'dept' }),          // 0
    node('alpha', 'blueberry_game', 'folder', 0),                            // 1
    node('readme', 'README.md', 'note', 1, { size: 300 }),                   // 2
    node('docs', 'docs', 'folder', 1),                                       // 3
    node('mobbin', 'mobbin', 'folder', 3),                                   // 4
    node('pic', 'duolingo--onboarding--00.png', 'image', 4, { size: 900 }),  // 5
    node('big', 'index.tsv', 'text', 1, { size: 200000, layer: 'memory' }), // 6
    node('dept2', 'Skills', 'dept', -1, { layer: 'dept', root: 1 }),        // 7
    node('gen', 'generate', 'skill', 7, { layer: 'skill', root: 1 }),        // 8
    node('pdf', '160 practice.pdf', 'pdf', 4, { size: 5200000 }),            // 9
    node('vite', 'vite.config.js', 'code', 1, { size: 400 }),                // 10
  ],
  edges: [[2, 4, 'mention'], [2, 8, 'skill'], [2, 3, 'link']] as [number, number, string][],
};
const link = (index: number, type?: string) => ({ id: payload.nodes[index].id, name: payload.nodes[index].name, kind: payload.nodes[index].kind, layer: payload.nodes[index].layer, ...(type ? { type } : {}) });
const details: Record<string, object> = {
  readme: { id: 'readme', name: 'README.md', kind: 'note', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/README.md', root: 'C:/Users/andrew/Downloads/Projects', size: 300, mtime: 0, summary: { title: 'Blueberry game', description: 'The learning game.' }, excerpt: '# Blueberry game\n\nThe learning game.\n\n## Reference\n\nSee the mobbin captures.\n', next: null, linksIn: [], linksOut: [link(4, 'mention'), link(8, 'skill'), link(3, 'link')], children: [], group: null, where: null },
  mobbin: { id: 'mobbin', name: 'mobbin', kind: 'folder', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/docs/reference/mobbin', root: 'C:/Users/andrew/Downloads/Projects', size: 0, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [link(2, 'mention')], linksOut: [], children: [link(5)], group: null, where: null },
  pic: { id: 'pic', name: 'duolingo--onboarding--00.png', kind: 'image', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/docs/reference/mobbin/duolingo--onboarding--00.png', root: 'C:/Users/andrew/Downloads/Projects', size: 900, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [], linksOut: [], children: [], group: null, where: null },
  big: { id: 'big', name: 'index.tsv', kind: 'text', layer: 'memory', path: 'C:/Users/andrew/Downloads/Projects/second-brain/index.tsv', root: 'C:/Users/andrew/Downloads/Projects', size: 200000, mtime: 0, summary: {}, excerpt: 'row 1\nrow 2\n', next: 8192, linksIn: [], linksOut: [], children: [], group: null, where: null },
  gen: { id: 'gen', name: 'generate', kind: 'skill', layer: 'skill', path: 'C:/Users/andrew/.claude/skills/generate', file: 'C:/Users/andrew/.claude/skills/generate/SKILL.md', root: 'C:/Users/andrew/.claude/skills', size: 70000, mtime: 0, summary: { title: 'generate', description: 'Generate images.' }, excerpt: '# /generate\n\nFirst part.\n', next: 8192, linksIn: [link(2, 'skill')], linksOut: [], children: [], group: null, where: null },
  dept2: { id: 'dept2', name: 'Skills', kind: 'dept', layer: 'dept', path: null, root: 'C:/Users/andrew/.claude/skills', size: 0, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [], linksOut: [], children: [link(8)], group: null, where: null },
  docs: { id: 'docs', name: 'docs', kind: 'folder', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/docs', root: 'C:/Users/andrew/Downloads/Projects', size: 0, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [link(2, 'link')], linksOut: [], children: [link(4)], group: null, where: null },
  pdf: { id: 'pdf', name: '160 practice.pdf', kind: 'pdf', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/docs/mobbin/160 practice.pdf', root: 'C:/Users/andrew/Downloads/Projects', size: 5200000, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [], linksOut: [], children: [], group: null, where: null },
  vite: { id: 'vite', name: 'vite.config.js', kind: 'code', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/vite.config.js', root: 'C:/Users/andrew/Downloads/Projects', size: 400, mtime: 0, summary: {}, excerpt: 'export default {}\n', next: null, linksIn: [], linksOut: [], children: [], group: null, where: null },
};
let requests: { url: string; body: any }[] = [];
// A slow chunk read, held by the test until it releases it: the selection can move while one is in flight.
let holdText: Promise<void> | null = null;
beforeEach(() => {
  requests = []; holdText = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) : undefined; requests.push({ url: path, body });
    const params = new URL(path, 'http://localhost').searchParams;
    if (path.includes('/graph/text') && holdText) await holdText;
    const reply = path.includes('/graph/node') ? details[params.get('id')!] : path.includes('/graph/text') ? { text: `chunk at ${params.get('offset')}\n## The last heading\n`, offset: Number(params.get('offset')), next: params.get('id') === 'big' && Number(params.get('offset')) === 8192 ? 73728 : null, size: 200000 } : path.includes('/graph/open') ? { ok: true, command: 'explorer.exe', args: [], reveal: body?.reveal || body?.id === 'vite', runnable: body?.id === 'vite' } : path.endsWith('/graph') ? payload
      : path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} } : path.endsWith('/projects') ? { repos: [], courses: [], blueberry: null, routines: [] } : path.endsWith('/tasks') ? { tasks: [] } : path.endsWith('/skills') ? { skills: [] } : { error: 'no' };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  location.hash = ''; notify.mockClear();
});
const notify = vi.fn();
const viewer = () => screen.getByRole('complementary', { name: 'Viewer' });
const row = (name: string) => screen.getAllByRole('treeitem').find(item => item.textContent?.startsWith(name) || within(item).queryByText(name)) as HTMLElement;

describe('Network: one selection across tree, map and viewer', () => {
  it('lists departments, expands folders on demand, and opens a file in the viewer from the tree', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    expect(await screen.findByRole('treeitem', { name: /Chemistry apps/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /^blueberry_game/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('README.md')).not.toBeInTheDocument(); // collapsed rows are not rendered
    await user.click(screen.getByRole('button', { name: 'Expand blueberry_game' }));
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(row('README.md')).toHaveTextContent('3'); // three links out
    await user.click(row('README.md'));
    expect(await within(viewer()).findByRole('heading', { level: 2, name: 'README.md' })).toBeInTheDocument();
    // The note reads once, rendered: no summary card repeats its first paragraph above the document.
    expect(within(viewer()).getByText('The learning game.').closest('.viewer-markdown')).not.toBeNull();
    expect(viewer().querySelector('.viewer-summary')).toBeNull();
    expect(within(viewer()).getByRole('heading', { level: 3, name: 'Reference' })).toBeInTheDocument(); // markdown rendered
    expect(within(viewer()).getByText('blueberry_game/README.md')).toBeInTheDocument();
    expect(row('README.md')).toHaveAttribute('aria-selected', 'true');
    expect(location.hash).toBe('#network/readme'); // the selection is a link to this file
    // Two files with the same name read apart: each linked entry names its folder.
    const links = within(viewer()).getByRole('heading', { level: 3, name: /Links to/ }).parentElement as HTMLElement;
    expect(within(links).getByRole('button', { name: /^mobbin/ })).toHaveTextContent('blueberry_game/docs');
    expect(within(links).getByRole('button', { name: /^generate/ })).toHaveTextContent('Skill');
  });

  it('opens the node named in the hash, so the Ctrl+K search and a pasted link land on a file, without pushing history entries of its own', async () => {
    location.hash = 'network/pic'; const entries = history.length; // the link was just followed
    render(<Network notify={notify} path="pic"/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    expect(await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' })).toBeInTheDocument();
    expect(row('duolingo--onboarding--00.png')).toHaveAttribute('aria-selected', 'true');
    expect(location.hash).toBe('#network/pic');
    // Neither a bare #network nor a second #network/pic was pushed while the map loaded: Back leaves the page in one press.
    expect(history.length).toBe(entries);
  });

  it('shows a PDF as its first page rendered on the server, never the whole file in a frame', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('160 practice{Enter}');
    const page = await within(viewer()).findByRole('img', { name: 'First page of 160 practice.pdf' });
    expect(page).toHaveAttribute('src', '/api/graph/preview?id=pdf');
    expect(viewer().querySelector('iframe')).toBeNull();
    expect(within(viewer()).getByText('First page. Open on device for the whole document.')).toBeInTheDocument();
  });

  it('says so when Open revealed a script instead of running it', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('vite.config{Enter}');
    await user.click(await within(viewer()).findByRole('button', { name: 'Open on device' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('vite.config.js is a script, so it was revealed in Explorer rather than run'));
  });

  it('reaches a png inside the mobbin folder by typing once and clicking once', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    expect(screen.getByLabelText('Search files')).toHaveFocus();
    await user.keyboard('mobbin');
    expect(screen.getByRole('treeitem', { name: /^mobbin/ })).toBeInTheDocument();
    await user.click(row('duolingo--onboarding--00.png'));
    const image = await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' });
    expect(image).toHaveAttribute('src', '/api/graph/file?id=pic');
    expect(within(viewer()).getByRole('button', { name: 'Open on device' })).toBeInTheDocument();
  });

  it('selects the top match as you type, so a named file is one action plus typing, and a click during that moment wins', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    expect(screen.getByLabelText('Search files')).toHaveFocus(); // the cold open is already typing-ready
    await user.keyboard('duolingo--onboarding--00.png'); // no Enter
    expect(await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' })).toBeInTheDocument();
    expect(row('duolingo--onboarding--00.png')).toHaveAttribute('aria-selected', 'true');
    expect(within(viewer()).getByRole('button', { name: 'Open on device' })).toBeInTheDocument();
    // A row clicked while the query is still settling keeps its file: the top match does not steal it back.
    const box = screen.getByLabelText('Search files');
    await user.clear(box); await user.type(box, 'mobbin');
    await user.click(row('duolingo--onboarding--00.png'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    expect(within(viewer()).getByRole('heading', { level: 2, name: 'duolingo--onboarding--00.png' })).toBeInTheDocument();
  });

  it('walks a relation: a Links to entry moves the tree row, the viewer and the map selection together', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('blueberry_game/README{Enter}');
    await within(viewer()).findByRole('heading', { level: 2, name: 'README.md' });
    const links = within(viewer()).getByRole('heading', { level: 3, name: /Links to/ }).parentElement as HTMLElement;
    expect(within(links).getByRole('heading', { level: 3 })).toHaveTextContent('Links to 3');
    await user.click(within(links).getByRole('button', { name: /^mobbin/ }));
    expect(await within(viewer()).findByRole('heading', { level: 2, name: 'mobbin' })).toBeInTheDocument();
    expect(row('mobbin')).toHaveAttribute('aria-selected', 'true');
    expect(within(viewer()).getByRole('heading', { level: 3, name: /Linked from/ })).toHaveTextContent('Linked from 1');
    await user.click(within(viewer()).getByRole('button', { name: /README.md/ }));
    expect(await within(viewer()).findByRole('heading', { level: 2, name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Local graph' })).toBeEnabled();
  });

  it('puts what links here above a folder\'s contents, so the answer is not below a long list', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('mobbin{Enter}');
    await within(viewer()).findByRole('heading', { level: 2, name: 'mobbin' });
    expect(within(viewer()).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Linked from 1', 'Links to 0', 'Contains 1']);
  });

  it('pages a large text file in chunks on demand, and opens on the device only on a click', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('index.tsv{Enter}');
    expect(await within(viewer()).findByText('row 2')).toBeInTheDocument();
    expect(viewer().querySelectorAll('.code-number')).toHaveLength(2);
    expect(requests.some(r => r.url.includes('/graph/text'))).toBe(false);
    await user.click(within(viewer()).getByRole('button', { name: /Load more/ }));
    expect(await within(viewer()).findByText(/chunk at 8192/)).toBeInTheDocument();
    expect(requests.filter(r => r.url.includes('/graph/text')).map(r => new URL(r.url, 'http://x').searchParams.get('offset'))).toEqual(['8192']);
    expect(within(viewer()).getByRole('button', { name: /Load more/ })).toBeInTheDocument(); // more remains
    // Reading on past the end loads the next chunk without the button: a wheel turned down at the end of the viewer,
    // and never one turned anywhere above it (jsdom has no layout, so the scroll box is described by hand).
    const box = (scrollTop: number) => Object.defineProperties(viewer(), { scrollTop: { value: scrollTop, configurable: true }, clientHeight: { value: 300, configurable: true }, scrollHeight: { value: 800, configurable: true } });
    box(0); fireEvent.wheel(viewer(), { deltaY: 40 });
    box(500); fireEvent.wheel(viewer(), { deltaY: -40 });
    expect(requests.filter(r => r.url.includes('/graph/text'))).toHaveLength(1);
    fireEvent.wheel(viewer(), { deltaY: 40 });
    expect(await within(viewer()).findByText(/chunk at 73728/)).toBeInTheDocument();
    expect(requests.filter(r => r.url.includes('/graph/text')).map(r => new URL(r.url, 'http://x').searchParams.get('offset'))).toEqual(['8192', '73728']);
    expect(requests.some(r => r.url.includes('/graph/open'))).toBe(false);
    await user.click(within(viewer()).getByRole('button', { name: 'Open on device' }));
    await waitFor(() => expect(requests.find(r => r.url.includes('/graph/open'))?.body).toEqual({ id: 'big', reveal: false }));
    await user.click(within(viewer()).getByRole('button', { name: 'Reveal in Explorer' }));
    await waitFor(() => expect(requests.filter(r => r.url.includes('/graph/open')).at(-1)?.body).toEqual({ id: 'big', reveal: true }));
    await user.click(within(viewer()).getByRole('button', { name: 'Copy path' }));
    expect(await navigator.clipboard.readText()).toBe('C:/Users/andrew/Downloads/Projects/second-brain/index.tsv');
  });

  it('drops a chunk that arrives after the selection moved, so one file\'s bytes never show inside another', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    const box = screen.getByLabelText('Search files');
    await user.keyboard('index.tsv{Enter}');
    expect(await within(viewer()).findByText('row 2')).toBeInTheDocument();
    let release = () => {};
    holdText = new Promise<void>(resolve => { release = resolve; });
    await user.click(within(viewer()).getByRole('button', { name: /Load more/ }));
    expect(requests.filter(r => r.url.includes('/graph/text'))).toHaveLength(1);
    // The reader picks another file while that chunk is still on its way.
    await user.clear(box); await user.type(box, 'vite.config{Enter}');
    expect(await within(viewer()).findByText(/export default/)).toBeInTheDocument();
    holdText = null; release();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(within(viewer()).queryByText(/chunk at 8192/)).toBeNull(); // the index's bytes stayed out of vite.config.js
    expect(viewer().querySelectorAll('.code-line')).toHaveLength(1);
    // And the held read left nothing stuck: back on the index, Load more still works and reads once.
    await user.clear(box); await user.type(box, 'index.tsv{Enter}');
    const more = await within(viewer()).findByRole('button', { name: /Load more/ });
    expect(more).toBeEnabled();
    await user.click(more);
    expect(await within(viewer()).findByText(/chunk at 8192/)).toBeInTheDocument();
    expect(within(viewer()).getAllByText(/chunk at 8192/)).toHaveLength(1);
  });

  it('shows a skill whole, as its SKILL.md rendered, with what uses it', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('generate{Enter}');
    expect(await within(viewer()).findByRole('heading', { level: 3, name: 'The last heading' })).toBeInTheDocument();
    expect(within(viewer()).getByRole('heading', { level: 2, name: '/generate' })).toBeInTheDocument();
    expect(within(viewer()).queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
    expect(within(viewer()).getByRole('heading', { level: 3, name: /Linked from/ })).toHaveTextContent('Linked from 1');
  });

  it('answers the keyboard in the tree: arrows move, Right expands, Left collapses, Enter opens', async () => {
    const user = userEvent.setup(); render(<Network notify={notify}/>);
    await screen.findByRole('treeitem', { name: /Chemistry apps/ });
    await user.keyboard('{ArrowDown}'); // from the search box to the first row
    expect(screen.getByRole('treeitem', { name: /Chemistry apps/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /^blueberry_game/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /^blueberry_game/ })).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /^docs/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /^blueberry_game/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /^blueberry_game/ })).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await within(viewer()).findByRole('heading', { level: 2, name: 'Skills' })).toBeInTheDocument();
  });
});

describe('the front door reaches the map', () => {
  it('Ctrl+K finds a file on the map from the cold open, and Enter opens it in Network: two actions plus typing', async () => {
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const entries = history.length;
    await user.keyboard('{Control>}k{/Control}'); // action 1
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('duolingo--onboarding--00');
    const hit = await within(dialog).findByRole('button', { name: /^duolingo--onboarding--00\.png/ }, { timeout: 5000 }); // the map is fetched and built first
    expect(hit).toHaveTextContent('Image · blueberry_game/docs/mobbin');
    // The row carries its own actions, so neither of them is a hop past the file.
    expect(within(dialog).getByRole('button', { name: 'Open duolingo--onboarding--00.png on device' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reveal duolingo--onboarding--00.png in Explorer' })).toBeInTheDocument();
    expect(within(dialog).queryByText('No matches yet')).not.toBeInTheDocument();
    await user.keyboard('{Enter}'); // action 2
    // The Network page is lazy: it suspends inside the key event's act() and resumes on the plain event
    // loop, which findBy's act-wrapped polling can miss, so this yields to the real loop until it shows.
    for (let i = 0; i < 100 && !screen.queryByRole('heading', { level: 1, name: 'Network' }); i++) await new Promise(r => setTimeout(r, 50));
    expect(screen.getByRole('heading', { level: 1, name: 'Network' })).toBeInTheDocument();
    await screen.findByRole('treeitem', { name: /Chemistry apps/ }, { timeout: 5000 });
    expect(await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' }, { timeout: 5000 })).toBeInTheDocument();
    expect(within(viewer()).getByRole('button', { name: 'Open on device' })).toBeInTheDocument();
    expect(location.hash).toBe('#network/pic');
    expect(history.length).toBe(entries + 1); // one entry for the pick: Back returns to Today in one press
    // The search and the page share one build: at most one /graph request here, and none when an earlier test left loadGraph's promise warm.
    expect(requests.filter(r => r.url.endsWith('/graph')).length).toBeLessThanOrEqual(1);
  });

  it('Ctrl+Enter on the first result also opens it on this computer: two actions, and Open fires once, for that file', async () => {
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.keyboard('{Control>}k{/Control}'); // action 1
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('duolingo--onboarding--00');
    await within(dialog).findByRole('button', { name: /^duolingo--onboarding--00\.png/ }, { timeout: 5000 });
    expect(requests.some(r => r.url.includes('/graph/open'))).toBe(false);
    await user.keyboard('{Control>}{Enter}{/Control}'); // action 2
    await waitFor(() => expect(requests.filter(r => r.url.includes('/graph/open')).map(r => r.body)).toEqual([{ id: 'pic', reveal: false }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Opened duolingo--onboarding--00.png on this computer');
    for (let i = 0; i < 100 && !screen.queryByRole('heading', { level: 1, name: 'Network' }); i++) await new Promise(r => setTimeout(r, 50));
    expect(await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' }, { timeout: 5000 })).toBeInTheDocument();
    expect(requests.filter(r => r.url.includes('/graph/open'))).toHaveLength(1);
  });

  it('the result row opens the file on this computer in the same two actions, and Shift+Enter reveals it instead', async () => {
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.keyboard('{Control>}k{/Control}'); // action 1
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('duolingo--onboarding--00');
    await user.click(await within(dialog).findByRole('button', { name: 'Open duolingo--onboarding--00.png on device' }, { timeout: 5000 })); // action 2
    await waitFor(() => expect(requests.filter(r => r.url.includes('/graph/open')).map(r => r.body)).toEqual([{ id: 'pic', reveal: false }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Opened duolingo--onboarding--00.png on this computer');
    // The pick still lands on the file in Network, so the map and the viewer show what was opened.
    for (let i = 0; i < 100 && !screen.queryByRole('heading', { level: 1, name: 'Network' }); i++) await new Promise(r => setTimeout(r, 50));
    expect(await within(viewer()).findByRole('img', { name: 'duolingo--onboarding--00.png' }, { timeout: 5000 })).toBeInTheDocument();
    // Shift+Enter on the row reveals it in Explorer rather than opening it.
    await user.keyboard('{Control>}k{/Control}');
    const again = await screen.findByRole('dialog');
    await user.keyboard('duolingo--onboarding--00');
    await within(again).findByRole('button', { name: /^duolingo--onboarding--00\.png/ }, { timeout: 5000 });
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await waitFor(() => expect(requests.filter(r => r.url.includes('/graph/open')).map(r => r.body)).toEqual([{ id: 'pic', reveal: false }, { id: 'pic', reveal: true }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Revealed duolingo--onboarding--00.png in Explorer');
  });
});

describe('the model behind the map', () => {
  it('derives paths, counts and links, lays every node out, and searches by name or path', () => {
    const model = buildModel(payload);
    expect(model.paths[5]).toBe('C:/Users/andrew/Downloads/Projects/blueberry_game/docs/mobbin/duolingo--onboarding--00.png');
    expect(model.count[0]).toBe(5); expect(model.count[4]).toBe(2);
    expect(model.linksOut[2]).toEqual([4, 8, 3]); expect(model.linksIn[4]).toEqual([2]);
    const scene = layout(model);
    expect(scene.ids.length).toBe(payload.nodes.length);
    expect(Math.hypot(scene.x[5] - scene.x[4], scene.y[5] - scene.y[4])).toBeLessThan(40); // a file sits by its folder
    expect(searchNodes(model, 'mobbin')[0]).toBe(4);
    expect(searchNodes(model, 'blueberry_game/README')[0]).toBe(2);
    expect(searchNodes(model, 'readme').slice(0, 1)).toEqual([2]);
    const local = localScene(model, 2);
    expect([...local.ids]).toEqual([2, 1, 4, 8, 3]); // the node, its folder, then what it links to
    expect(local.edges).toHaveLength(3);
  });
});
