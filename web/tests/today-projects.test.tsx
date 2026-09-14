import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('Today and Projects, live from disk', () => {
  it('opens on Today: courses with git state, uncommitted repos, the newest STATUS.md entry, skill runs', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(await within(section(/Courses/)).findByText('assignment-1')).toBeInTheDocument();
    expect(within(section(/Courses/)).getByText('2 uncommitted')).toBeInTheDocument();
    expect(within(section(/Courses/)).getByText('No project folders in school/CMSC434 yet.')).toBeInTheDocument();
    const uncommitted = section(/Uncommitted work/);
    expect(within(uncommitted).getByText('grignard-app-source')).toBeInTheDocument();
    expect(within(uncommitted).getByText('15 uncommitted')).toBeInTheDocument();
    expect(within(uncommitted).queryByText('Pibble')).not.toBeInTheDocument();
    expect(within(uncommitted).queryByText('Portfolio')).not.toBeInTheDocument();
    const status = section(/Blueberry/);
    expect(within(status).getByText('Two measured checks now run')).toBeInTheDocument();
    expect(within(status).queryByText('An older entry')).not.toBeInTheDocument();
    expect(await within(section(/Skill runs/)).findByText('Done in 42s')).toBeInTheDocument();
    expect(within(section(/Skill runs/)).getByRole('link', { name: /Clean up/ })).toHaveAttribute('href', '#skills/clean-up');
    expect(within(section(/Pinned/)).getByText('Welcome to your second brain')).toBeInTheDocument();
    expect(within(section(/Quick capture/)).getByLabelText('Your quick thought')).toBeInTheDocument();
    // No hero, no slogan, no stat cards: the header is the title and one action.
    expect(document.querySelector('.page-heading')?.textContent).toBe('TodayCapture a thought');
    expect(document.querySelectorAll('main .eyebrow, main .stat-card, main .welcome')).toHaveLength(0);
    // One workspace: no switcher, and the nav in the order the piece names.
    expect(screen.queryByText('Personal workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('YOUR PERSONAL WORKSPACE')).not.toBeInTheDocument();
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getAllByRole('button').map(b => b.textContent?.replace(/\d+|AI$/g, ''))).toEqual(['Today', 'Projects', 'Skills', 'Files', 'Chat', 'Generate', 'Network', 'Goals']);
  });

  it('lists every repo and course project on Projects, each opening to its details', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
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

  it('returns to Today when the address goes back to having no hash, as browser Back to the cold open does', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    location.hash = '#projects/grignard/grignard-app-source';
    expect(await screen.findByRole('heading', { level: 1, name: 'grignard-app-source' })).toBeInTheDocument();
    location.hash = '';
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
  });

  it('opens with the caret in quick capture, but never takes focus from the nav', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.getByLabelText('Your quick thought')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByLabelText('Your quick thought');
    expect(screen.getByRole('button', { name: 'Today' })).toHaveFocus();
  });

  it('opens Capture a thought with the caret in the title, even though showModal focuses the Close button first', async () => {
    // What Chrome does: showModal() focuses the dialog's first focusable element, the Close X.
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await user.click(screen.getByRole('button', { name: 'Capture a thought' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });

  it('has no footer slogan', async () => {
    render(<App />);
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
