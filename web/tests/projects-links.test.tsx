import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { LinksSection, type LinkGroup } from '../src/Projects';

// The Projects page's Links section and per-row links (Projects.tsx, from GET /api/links). Every URL is
// example.com, github.com/example or loopback; the real list lives in ~/.brain/links.json, outside the repo.
const repo = (name: string, path: string) => ({ name, path, branch: 'main', last: '2026-09-12', stale_days: 2, dirty: 0, desc: '' });
const projects = { repos: [repo('site', 'grignard/grignard-app-source'), repo('notes', 'notes')], courses: [], blueberry: null };
const groups: LinkGroup[] = [
  { name: 'On this computer', links: [{ label: 'Remote app', url: 'https://app.example.com/', note: 'Any of my devices' }, { label: 'Setup', url: 'http://127.0.0.1:5180/?setup=1', note: 'This PC only' }] },
  { name: 'Repositories', links: [{ label: 'site on GitHub', url: 'https://github.com/example/site', project: 'grignard/grignard-app-source' }, { label: 'site live', url: 'https://site.example.com/', project: 'grignard/grignard-app-source' }] },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url);
    const reply = path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} }
      : path.endsWith('/projects') ? projects : path.endsWith('/links') ? { groups } : path.endsWith('/project-plans') ? { plans: [] } : path.endsWith('/tasks') ? { tasks: [] } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
const linksSection = () => screen.getByRole('heading', { level: 2, name: 'Links' }).closest('section') as HTMLElement;

describe('Links on the Projects page', () => {
  it('shows each group as a card of links that open in a new tab, with host, note, copy button and the edit line', async () => {
    location.hash = '#projects'; render(<App />);
    await screen.findByRole('heading', { level: 2, name: 'Links' });
    const section = linksSection();
    for (const group of groups) expect(within(section).getByRole('heading', { level: 3, name: group.name })).toBeInTheDocument();
    const remote = within(section).getByRole('link', { name: /Remote app/ });
    expect(remote).toHaveAttribute('href', 'https://app.example.com/');
    expect(remote).toHaveAttribute('target', '_blank');
    expect(remote).toHaveAttribute('rel', 'noopener noreferrer');
    expect(remote).toHaveTextContent('app.example.com');
    expect(remote).toHaveTextContent('Any of my devices');
    expect(within(section).getByRole('link', { name: /Setup/ })).toHaveTextContent('This PC only');
    expect(within(section).getByRole('button', { name: 'Copy link: Remote app' })).toBeInTheDocument();
    expect(section).toHaveTextContent('Edit ~/.brain/links.json to change these');
  });

  it('copies a link through the clipboard helper', async () => {
    // After userEvent.setup(), which installs its own clipboard stub over navigator.clipboard.
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<LinksSection groups={groups}/>);
    await user.click(screen.getByRole('button', { name: 'Copy link: Remote app' }));
    expect(writeText).toHaveBeenCalledWith('https://app.example.com/');
  });

  it('puts a project\'s own links on its row, and none on a row without links', async () => {
    location.hash = '#projects'; render(<App />);
    await screen.findByRole('heading', { level: 2, name: 'Links' });
    // By href: the Links cards above also hold links whose names start with "site".
    const row = document.querySelector('a.project-row[href="#projects/grignard/grignard-app-source"]')?.closest('.project-line') as HTMLElement;
    expect(row).not.toBeNull();
    const github = within(row).getByRole('link', { name: 'site on GitHub' });
    expect(github).toHaveAttribute('href', 'https://github.com/example/site');
    expect(github).toHaveAttribute('target', '_blank');
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(row).getByRole('link', { name: 'site live' })).toHaveAttribute('href', 'https://site.example.com/');
    expect(document.querySelector('a.project-row[href="#projects/notes"]')?.closest('.project-line')).toBeNull();
  });

  it('dims PC-only links with a tooltip when the page is opened from another device, and not on the PC', () => {
    const { unmount } = render(<LinksSection groups={groups} host="phone.example.com"/>);
    const pcOnly = screen.getByRole('link', { name: /Setup/ }).closest('li') as HTMLElement;
    expect(pcOnly).toHaveClass('dim');
    expect(pcOnly).toHaveAttribute('title', 'Only works on the PC itself');
    expect(screen.getByRole('link', { name: /Remote app/ }).closest('li')).not.toHaveClass('dim');
    unmount();
    render(<LinksSection groups={groups} host="127.0.0.1"/>);
    const onPc = screen.getByRole('link', { name: /Setup/ }).closest('li') as HTMLElement;
    expect(onPc).not.toHaveClass('dim');
    expect(onPc).not.toHaveAttribute('title');
  });
});
