import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

// Today and Projects read /api/projects and /api/tasks. These fixtures have the shape
// server/live.mjs returns (OS/build_home.py --json), trimmed to what the pages show.
const repo = (name: string, path: string, branch: string, dirty: number | null, desc = '') => ({ name, path, branch, last: branch === 'not a repo' ? '\u2014' : '2026-09-12', stale_days: 2, dirty, known: true, untracked_project: false, desc });
const projects = {
  repos: [repo('grignard-app-source', 'grignard/grignard-app-source', 'ui/cta', 15, 'Blueberry: the site and the game'), repo('Pibble', 'Pibble', 'main', 0, 'Checkout bot'), repo('Portfolio', 'Portfolio', 'not a repo', 0)],
  courses: [{ name: 'CMSC423', title: 'CMSC423, computational genomics', projects: [repo('assignment-1', 'school/CMSC423/assignment-1', 'main', 2)] }, { name: 'CMSC434', title: 'CMSC434, human-computer interaction', projects: [] }],
  blueberry: { updated: '2026-09-10', entries: [{ what: 'Two measured checks now run', date: '2026-09-13', body: 'The **hit:targets** check passes.' }, { what: 'An older entry', date: '2026-09-12', body: 'Older.' }] },
  routines: [],
};
const tasks = [{ id: 'clean-up', label: 'Clean up', blurb: 'Kills stray headless browsers.', command: 'claude -p "/clean-up"', missing: null, run: { status: 'done', started: '2026-09-14T10:00:00.000Z', finished: '2026-09-14T10:00:42.000Z', exit: 0, output: 'ok' } }];

function stubFetch(projectsReply: object) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url);
    const reply = path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} }
      : path.endsWith('/projects') ? projectsReply : path.endsWith('/tasks') ? { tasks } : path.endsWith('/skills') ? { skills: [] } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
beforeEach(() => stubFetch(projects));
const section = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;

// The bare address is the home globe (Home.tsx) since 2026-09-24; Today is #agenda, "Today" in the nav.
const openAgenda = () => { location.hash = '#agenda'; render(<App />); };

describe('Today and Projects, live from disk', () => {
  // 2026-09-28: uncommitted work, courses, Blueberry's status, pinned files and skill runs left Today at
  // Andrew's word ("I don't see their use"); Projects and Skills carry them. Today is one screen: the
  // quote as a small box in the heading, a pencil for a new note (it was a plus named "Capture a thought"
  // until 2026-09-29), quick capture, todos. The mini board left the same day ("remove kanban from
  // today"): the board lives on Kanban only.
  it('opens on Today: one screen with the quote box, the pencil, quick capture and the todos, and no board', async () => {
    openAgenda();
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    for (const gone of [/Courses/, /Uncommitted work/, /Blueberry/, /Skill runs/, /Pinned/]) expect(screen.queryByRole('heading', { level: 2, name: gone })).toBeNull();
    expect(screen.getByRole('button', { name: 'New note' })).toHaveAttribute('title', 'New note');
    expect(document.querySelector('.today-heading .quote-board')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
    expect(document.querySelector('.kanban-board, .sticky-canvas')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Read for 15 minutes' })).toBeInTheDocument();
    expect(within(section(/Quick capture/)).getByLabelText('Your quick thought')).toBeInTheDocument();
    // 2026-09-28: the activity heat map lives in the calendar and activity card, not as a progress widget, and
    // there is one copy. Since 2026-09-29 the card is always expanded (it had a Show more that this clicked
    // first), and it comes before the todos in the page, the widest thing on it.
    const calendar = screen.getByRole('region', { name: 'Calendar and activity' });
    expect(within(screen.getByRole('list', { name: 'Progress widgets' })).queryByRole('heading', { name: 'Activity' })).toBeNull();
    expect(within(calendar).queryByRole('button', { name: /Show (more|less)/ })).toBeNull();
    expect(within(calendar).getByRole('heading', { level: 3, name: 'Activity' })).toBeInTheDocument();
    expect(calendar.compareDocumentPosition(screen.getByRole('region', { name: "Today's todos" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('.heat-grid')).toHaveLength(1);
    expect(calendar.querySelector('.heat-grid')).not.toBeNull();
    // No hero, no slogan, no stat cards: the header is the title, the quote and one action.
    expect(document.querySelector('.page-heading h1')?.textContent).toBe('Today');
    expect(document.querySelectorAll('main .eyebrow, main .stat-card, main .welcome')).toHaveLength(0);
    // One workspace: no switcher, and the nav in the order the piece names. Projects has no row (Today
    // links to it), Files is gone and Generate lives inside Chat (Andrew's decisions of 2026-09-24).
    expect(screen.queryByText('Personal workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('YOUR PERSONAL WORKSPACE')).not.toBeInTheDocument();
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getAllByRole('button').map(b => b.textContent?.replace(/\d+|AI$/g, ''))).toEqual(['Today', 'Kanban', 'Skills', 'andliu.ai', 'Docs', 'Whiteboard', 'Health']); // 2026-09-29: Health joined. 2026-09-25: one Kanban page; Network, Goals, Buy are not tabs. 2026-09-28: Docs, Whiteboard and Resume joined, and Resume then moved under Docs (a note of kind Resume); PDF tools joined after them, then folded into Docs (#pdf still opens)
    expect(screen.getByRole('link', { name: /^Projects/ })).toHaveAttribute('href', '#projects');
    expect(screen.getByRole('link', { name: /^Projects/ })).toHaveTextContent('4 repos');
  });

  it('lists every repo and course project on Projects, each opening to its details', async () => {
    const user = userEvent.setup();
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.click(screen.getByRole('link', { name: /^Projects/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    for (const item of [...projects.repos, ...projects.courses[0].projects]) expect(screen.getByRole('link', { name: new RegExp('^' + item.name) })).toHaveAttribute('href', '#projects/' + item.path);
    expect(screen.getByRole('link', { name: /^Pibble/ })).toHaveTextContent('clean');
    expect(screen.getByRole('link', { name: /^Portfolio/ })).toHaveTextContent('not a repo');
    await user.click(screen.getByRole('link', { name: /^grignard-app-source/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'grignard-app-source' })).toBeInTheDocument();
    expect(location.hash).toBe('#projects/grignard/grignard-app-source');
    expect(screen.getByText('Projects/grignard/grignard-app-source')).toBeInTheDocument();
    expect(screen.getByText('ui/cta')).toBeInTheDocument();
  });

  it('opens a project page straight from its link, a course project included', async () => {
    location.hash = '#projects/school/CMSC423/assignment-1';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'assignment-1' })).toBeInTheDocument();
    expect(screen.getByText('CMSC423, computational genomics')).toBeInTheDocument();
  });

  // The cold open is the home globe now, so Back to the bare address lands there, not on Today.
  it('returns to the home page when the address goes back to having no hash, as browser Back to the cold open does', async () => {
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    location.hash = '#projects/grignard/grignard-app-source';
    expect(await screen.findByRole('heading', { level: 1, name: 'grignard-app-source' })).toBeInTheDocument();
    location.hash = '';
    await waitFor(() => expect(document.querySelector('.app-shell')).toHaveClass('app-home'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Today' })).toBeNull();
  });

  it('opens with the caret in quick capture, but never takes focus from the nav', async () => {
    const user = userEvent.setup();
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.getByLabelText('Your quick thought')).toHaveFocus();
    await user.click(screen.getByRole('link', { name: /^Projects/ }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByLabelText('Your quick thought');
    expect(screen.getByRole('button', { name: 'Today' })).toHaveFocus();
  });

  // Was "opens Capture a thought with the caret in the title". Since 2026-09-29 the button is the pencil,
  // "New note", and opens the concise composer, which has no title field: the caret goes to its one box.
  it('opens New note with the caret in the note box, even though showModal focuses a button first', async () => {
    // What Chrome does: showModal() focuses the dialog's first focusable element.
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); };
    const user = userEvent.setup();
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const composer = screen.getByRole('dialog', { name: 'New note' });
    expect(within(composer).getByRole('textbox', { name: 'Note' })).toHaveFocus();
    expect(within(composer).queryByRole('textbox', { name: 'Title' })).toBeNull();
  });

  it('saves a note from New note with Save and with Ctrl+Enter, the first line as its title, and Cancel returns focus', async () => {
    const user = userEvent.setup();
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const pencil = screen.getByRole('button', { name: 'New note' });
    await user.click(pencil);
    let composer = within(screen.getByRole('dialog', { name: 'New note' }));
    expect(composer.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(composer.getByRole('textbox', { name: 'Note' }), 'Pencil title{Enter}the body');
    await user.click(composer.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull());
    expect(pencil).toHaveFocus();
    await user.click(pencil);
    composer = within(screen.getByRole('dialog', { name: 'New note' }));
    await user.type(composer.getByRole('textbox', { name: 'Note' }), 'Keyboard note');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull());
    await user.click(pencil);
    await user.type(within(screen.getByRole('dialog', { name: 'New note' })).getByRole('textbox', { name: 'Note' }), 'Thrown away');
    await user.click(within(screen.getByRole('dialog', { name: 'New note' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull();
    expect(pencil).toHaveFocus();
    const { loadWorkspace } = await import('../src/lib/storage');
    await waitFor(async () => {
      const notes = (await loadWorkspace()).docs.filter(doc => doc.tags.includes('Quick capture'));
      expect(notes.map(doc => [doc.name, doc.content, doc.kind])).toEqual([['Keyboard note', 'Keyboard note', 'note'], ['Pencil title', 'Pencil title\nthe body', 'note']]);
    });
  });

  it('has no footer slogan', async () => {
    openAgenda();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(document.body.textContent).not.toMatch(/A little less scattered|A little more you|SECOND BRAIN/);
  });

  it("gives a project's page its full folder path and a Copy folder path action", async () => {
    stubFetch({ ...projects, rootPath: 'C:\\Users\\andrew\\Downloads\\Projects' });
    location.hash = '#projects/grignard/grignard-app-source';
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('C:/Users/andrew/Downloads/Projects/grignard/grignard-app-source')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy folder path' }));
    expect(await navigator.clipboard.readText()).toBe('C:/Users/andrew/Downloads/Projects/grignard/grignard-app-source');
    expect(screen.getByRole('status')).toHaveTextContent('Folder path copied');
  });
});
