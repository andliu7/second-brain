import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleWorkspace } from '../src/lib/sample-workspace';
import { SampleWorkspaceCard } from '../src/components/ui/sample-workspace';
import { initialWorkspace, parseBackup } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import { kindOf, notebookOf, onThisDay, viewDocs } from '../src/lib/docs-kinds';
import { projectProgress, todoStreak, dayKey } from '../src/lib/progress';
import type { Workspace } from '../src/types';

const TODAY = new Date(2026, 8, 28, 9, 30);
const later = (days: number) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days, 9, 30);

describe('the sample workspace', () => {
  it('passes the workspace validator', () => {
    expect(() => validateWorkspace(sampleWorkspace(TODAY))).not.toThrow();
    expect(() => validateWorkspace(sampleWorkspace())).not.toThrow();
  });

  it('is deterministic for a given day', () => {
    expect(sampleWorkspace(TODAY)).toEqual(sampleWorkspace(TODAY));
  });

  it('fills every optional part of the workspace', () => {
    const w = sampleWorkspace(TODAY);
    for (const key of ['relations', 'board', 'todos', 'buyList', 'favorites', 'resume', 'whiteboards', 'currentWhiteboard', 'misc', 'todayLayout', 'notebooks'] as const) expect(w[key], key).toBeDefined();
    expect(w.docs.length).toBeGreaterThan(0); expect(w.goals.length).toBeGreaterThan(0); expect(w.conversations.length).toBeGreaterThan(1);
    expect(w.generations.some(g => g.status === 'complete')).toBe(true);
    expect(w.conversations.some(c => c.messages.some(msg => msg.trace))).toBe(true);
    // Docs: every kind the Docs page writes, notebooks with notes in them, typed tags, a pinned note, a skill and a file.
    const kinds = new Set(w.docs.filter(d => d.kind === 'note').map(kindOf));
    for (const kind of ['Note', 'Journal', 'Idea', 'Resume']) expect(kinds.has(kind as never), kind).toBe(true);
    for (const nb of w.notebooks!) expect(w.docs.some(d => notebookOf(d) === nb.id), nb.name).toBe(true);
    expect(w.docs.some(d => d.pinned)).toBe(true);
    expect(w.docs.some(d => d.kind === 'skill')).toBe(true);
    expect(w.docs.some(d => d.kind === 'file' && d.data)).toBe(true);
    expect(viewDocs(w.docs, 'tag:exam-1', '').length).toBeGreaterThan(1);
    expect(onThisDay(w.docs, TODAY).length).toBeGreaterThan(0);
    // Board: a project with dated stages, some done and some not, and every category colour used.
    const project = w.board!.cards.find(c => c.project)!;
    expect(project.checklist.some(i => i.doneOn)).toBe(true);
    expect(project.checklist.some(i => !i.done)).toBe(true);
    expect(projectProgress(w.board).length).toBeGreaterThan(1);
    expect(new Set(w.board!.cards.map(c => c.category)).size).toBe(8);
    // Todos: three weeks of history, and a live streak.
    expect(Object.keys(w.todos!.history).length).toBeGreaterThanOrEqual(20);
    expect(todoStreak(w.todos, dayKey(TODAY))).toBeGreaterThan(10);
    expect(w.goals.every(g => g.milestones.length)).toBe(true);
    expect(w.goals.some(g => g.archived)).toBe(true);
    expect(w.resume!.template).toBeDefined();
    expect(w.whiteboards!.every(b => b.elements.length > 0)).toBe(true);
    expect(w.favorites!.skills.length).toBeGreaterThan(0);
    expect(w.buyList!.some(b => b.options.length)).toBe(true);
    expect(new Set(w.misc!.map(m => m.kind)).size).toBe(3);
  });

  it('moves its dates with today', () => {
    const a = sampleWorkspace(TODAY), b = sampleWorkspace(later(10));
    expect(a.todos!.day).toBe(dayKey(TODAY));
    expect(b.todos!.day).toBe(dayKey(later(10)));
    const shift = (w: Workspace, id: string) => Date.parse(w.docs.find(d => d.id === id)!.created);
    expect(Math.round((shift(b, 'doc-j-1') - shift(a, 'doc-j-1')) / 86400000)).toBe(10);
    expect(Math.max(...b.activity.map(e => Date.parse(e.created)))).toBeGreaterThan(Math.max(...a.activity.map(e => Date.parse(e.created))));
    expect(todoStreak(b.todos, dayKey(later(10)))).toBe(todoStreak(a.todos, dayKey(TODAY)));
  });

  it('ships as a backup in public/ that validates and parses', () => {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/sample-workspace.json'), 'utf8');
    const parsed = parseBackup(raw);
    expect(parsed.docs.length).toBe(sampleWorkspace(TODAY).docs.length);
    expect(parsed.resume!.profile.name).toBe('Sam Rivera');
  });
});

describe('SampleWorkspaceCard', () => {
  it('loads the sample only after the inline confirmation', async () => {
    const commit = vi.fn(async () => true);
    render(<SampleWorkspaceCard workspace={initialWorkspace()} commit={commit}/>);
    expect(screen.getByText(/replaces this browser's workspace/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load sample' }));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const [update] = commit.mock.calls[0] as unknown as [(w: Workspace) => Workspace];
    expect(update(initialWorkspace()).resume!.profile.name).toBe('Sam Rivera');
  });

  it('downloads the current workspace as a backup without loading anything', () => {
    const commit = vi.fn(async () => true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL ??= () => 'blob:x'; URL.revokeObjectURL ??= () => {};
    render(<SampleWorkspaceCard workspace={initialWorkspace()} commit={commit}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Download my backup first' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
