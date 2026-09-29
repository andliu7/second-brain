import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Projects, type ProjectsData } from '../src/Projects';
import { initialWorkspace } from '../src/lib/storage';
import { projectPlansContext } from '../src/lib/project-plans';

// Project plans on the Projects page (ProjectPlan.tsx): the summary on a row, the Walkthrough and Pipeline
// tabs on a project's page, the edit mode's saves, and the chat summary. fetch stands in for
// server/project-plans.mjs with a made-up plan; the real plans are private and never in the repository.
const repo = (path: string, name: string) => ({ name, path, branch: 'main', last: '2026-09-28', stale_days: 1, dirty: 0, desc: '' });
const data: ProjectsData = { repos: [repo('example-app', 'Example app'), repo('other', 'Other')], courses: [], blueberry: null };
const plan = () => ({ key: 'example-app', name: 'Example app', updated: '2026-09-28T10:00:00.000Z', walkthrough: '# How it fits together\n\nThe **server** reads the plan.',
  pipeline: { subtitle: 'Made-up delivery', layout: 'vertical', stages: [
    { id: 'scope', title: 'Scope', status: 'completed', detail: 'Decide what it is' },
    { id: 'build', title: 'Build', status: 'active', detail: 'Write it' },
    { id: 'ship', title: 'Ship', status: 'pending' },
  ] } });
const summary = { key: 'example-app', name: 'Example app', updated: '2026-09-28T10:00:00.000Z', total: 3, done: 1, counts: { pending: 1, queued: 0, active: 1, paused: 0, completed: 1, warning: 0, failed: 0, skipped: 0, cancelled: 0 }, active: ['Build'], next: 'Ship' };

function server() {
  const state = { plan: plan(), calls: [] as { method: string; url: string; body?: any }[] };
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, url, body });
    if (url === '/api/project-plans') return reply(200, { plans: [summary] });
    if (url === '/api/project-plans/example-app') return reply(200, { plan: structuredClone(state.plan) });
    if (url === '/api/project-plans/other') return reply(200, { plan: null });
    const stage = url.match(/^\/api\/project-plans\/example-app\/stages\/(\w+)$/);
    if (stage && method === 'PUT') { state.plan.pipeline.stages = state.plan.pipeline.stages.map(item => item.id === stage[1] ? { ...item, ...body } : item); return reply(200, { plan: structuredClone(state.plan) }); }
    if (url === '/api/project-plans/example-app/stages' && method === 'POST') { state.plan.pipeline.stages.push({ id: 'new', title: body.title, status: 'pending' }); return reply(201, { plan: structuredClone(state.plan) }); }
    return reply(404, { error: 'API route not found.' });
  }));
  return state;
}
const page = (path: string) => render(<Projects path={path} data={data} error="" refresh={() => {}} workspace={initialWorkspace()} commit={async () => true}/>);
afterEach(() => vi.unstubAllGlobals());

describe('project plans on the Projects page', () => {
  it('shows a pipeline summary on the row of a project that has a plan, and none on one without', async () => {
    server(); page('');
    const row = (await screen.findByText('Pipeline: 1 of 3 stages · 1 active')).closest('a')!;
    expect(row.getAttribute('href')).toBe('#projects/example-app');
    const other = screen.getByText('Other').closest('a')!;
    expect(within(other).queryByText(/Pipeline:/)).toBeNull();
  });

  it("a project's page has a Walkthrough tab with the plan's markdown and a Pipeline tab with its timeline", async () => {
    server(); page('example-app');
    expect(await screen.findByRole('heading', { name: 'How it fits together' })).toBeTruthy();
    expect(screen.getByText('server', { selector: 'strong' })).toBeTruthy();
    const walk = screen.getByRole('tab', { name: 'Walkthrough' });
    expect(walk.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Pipeline' }));
    expect(screen.getByRole('tab', { name: 'Pipeline' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Delivery pipeline' })).toBeTruthy();
    expect(screen.getByText('Made-up delivery')).toBeTruthy();
    expect(screen.getByText('1 of 3 stages')).toBeTruthy();
    const build = screen.getByText('Build', { selector: 'strong' }).closest('li')!;
    expect(build.getAttribute('aria-current')).toBe('step');
    expect(screen.queryByRole('heading', { name: 'How it fits together' })).toBeNull();
  });

  it('edit mode saves a status change through the PUT route and shows what the server sent back', async () => {
    const state = server(); page('example-app');
    fireEvent.click(await screen.findByRole('tab', { name: 'Pipeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit pipeline' }));
    fireEvent.click(screen.getByText('Ship', { selector: 'strong' }).closest('button')!);
    fireEvent.change(await screen.findByLabelText('Status of Ship'), { target: { value: 'active' } });
    await waitFor(() => expect(state.calls.some(call => call.method === 'PUT')).toBe(true));
    const put = state.calls.find(call => call.method === 'PUT')!;
    expect(put.url).toBe('/api/project-plans/example-app/stages/ship');
    expect(put.body).toEqual({ status: 'active' });
    await waitFor(() => expect((screen.getByLabelText('Status of Ship') as HTMLSelectElement).value).toBe('active'));
    // Add a stage through the POST route.
    fireEvent.change(screen.getByLabelText('New pipeline stage'), { target: { value: 'Write docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(await screen.findByText('Write docs', { selector: 'strong' })).toBeTruthy();
    expect(state.calls.find(call => call.method === 'POST')!.body).toEqual({ title: 'Write docs' });
  });

  it('a project without a plan says so and names the file to write', async () => {
    server(); page('other');
    expect(await screen.findByText(/No plan yet/)).toBeTruthy();
    expect(screen.getByText('~/.brain/project-plans/other.json')).toBeTruthy();
  });
});

describe('the chat summary of project plans', () => {
  it('names each plan with its done count, its active stages and the next one', async () => {
    server();
    const text = await projectPlansContext();
    expect(text).toContain('Project plans');
    expect(text).toContain('- Example app: 1 of 3 stages done; active: Build; next: Ship');
  });
  it('is empty when the API cannot be reached, so a chat never fails because of it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await projectPlansContext()).toBe('');
  });
});
