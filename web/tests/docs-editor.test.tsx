import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Docs } from '../src/Docs';
import DocEditor, { docExtensions, markdownOf } from '../src/components/ui/doc-editor';
import { Markdown } from '../src/Markdown';
import { journalMonths, journalTitle, listDocs, newDocFor, onThisDay, viewDocs, wordCount } from '../src/lib/docs-kinds';
import { initialWorkspace, loadWorkspace, makeDoc, saveWorkspace } from '../src/lib/storage';
import type { Workspace } from '../src/types';

// The page is mounted the way App.tsx will mount it: with the workspace and a commit that saves it,
// so every assertion about autosave reads real (fake-indexeddb) storage.
function Host({ initial }: { initial: Workspace }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); await saveWorkspace(next); current.current = next; setWorkspace(next); return true; };
  return <Docs workspace={workspace} commit={commit}/>;
}
const withDocs = (...docs: Workspace['docs']): Workspace => ({ ...initialWorkspace(), docs });

// A headless editor with the page's exact extensions.
const editorWith = (markdown = '') => new Editor({ element: document.createElement('div'), extensions: docExtensions(), content: markdown, contentType: 'markdown' });
// Typing one character at a time the way ProseMirror does it: offer the text to handleTextInput,
// which is where input rules listen, and insert it plainly when no rule takes it.
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', f => f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
// A real keydown on the editor, as the browser sends it. (TipTap's keyboardShortcut command replays
// only the steps of what the key did, and drops the selection, so it cannot test where the cursor ends up.)
function press(editor: Editor, keys: string) {
  const parts = keys.split('-');
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: parts[parts.length - 1], ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), bubbles: true, cancelable: true }));
}
const enter = (editor: Editor) => press(editor, 'Enter');
// The node types from the top down, nesting shown by indentation. Left out: text, an item's own
// paragraph, and the empty paragraph StarterKit keeps after a list at the end (not content).
function outline(editor: Editor) {
  const lines: string[] = [];
  const walk = (node: typeof editor.state.doc, depth: number) => node.forEach(child => {
    if (child.isText || (child.isTextblock && (depth > 0 || !child.content.size))) return;
    lines.push('  '.repeat(depth) + child.type.name + (child.type.name === 'taskItem' ? `(${child.attrs.checked ? 'x' : ' '})` : ''));
    walk(child, depth + 1);
  });
  walk(editor.state.doc, 0);
  return lines.join('\n');
}
// Put the cursor inside the text "needle".
function cursorAt(editor: Editor, needle: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle) + 1; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
}

const NESTED_BULLETS = '- Groceries\n    - Milk\n    - Eggs\n- Laundry';

describe('document kinds', () => {
  it('filters by kind, and a note without a kind tag counts as a Note', () => {
    const docs = [makeDoc('Quick', 'x', 'note', ['Quick capture']), makeDoc('Diary', '', 'note', ['Journal']), makeDoc('App idea', '', 'note', ['Idea']), makeDoc('a.pdf', '', 'file')];
    expect(listDocs(docs, 'Note', '').map(d => d.name)).toEqual(['Quick']);
    expect(listDocs(docs, 'Journal', '').map(d => d.name)).toEqual(['Diary']);
    expect(listDocs(docs, 'Idea', '').map(d => d.name)).toEqual(['App idea']);
    expect(listDocs(docs, null, '').map(d => d.name).sort()).toEqual(['App idea', 'Diary', 'Quick']);
  });
  it('a new journal entry is titled by the date and reopens today\'s entry when there is one', () => {
    const today = new Date(2026, 8, 28, 9);
    const first = newDocFor('Journal', [], today);
    expect(first.existing).toBe(false);
    expect(first.doc.name).toBe('Monday, September 28, 2026');
    expect(first.doc.name).toBe(journalTitle(today));
    first.doc.created = today.toISOString();
    const again = newDocFor('Journal', [first.doc], new Date(2026, 8, 28, 22));
    expect(again).toEqual({ doc: first.doc, existing: true });
    expect(newDocFor('Journal', [first.doc], new Date(2026, 8, 29)).existing).toBe(false);
  });
});

describe('typing shortcuts', () => {
  it('"- " and "* " start a bullet list, "1. " a numbered one, "[] " a checklist, "# " a heading', () => {
    for (const [typed, node] of [['- ', 'bulletList'], ['* ', 'bulletList'], ['1. ', 'orderedList'], ['[] ', 'taskList'], ['# ', 'heading']]) {
      const editor = editorWith();
      type(editor, typed + 'hello');
      expect(editor.state.doc.firstChild!.type.name, typed).toBe(node);
      expect(editor.state.doc.textContent).toBe('hello');
      editor.destroy();
    }
  });
  it('Tab makes a sub-point and Shift+Tab takes it back out', () => {
    const editor = editorWith();
    type(editor, '- one'); enter(editor); type(editor, 'two');
    press(editor, 'Tab');
    expect(outline(editor)).toBe('bulletList\n  listItem\n    bulletList\n      listItem');
    press(editor, 'Shift-Tab');
    expect(outline(editor)).toBe('bulletList\n  listItem\n  listItem');
    editor.destroy();
  });
  it('Tab nests checklist items too', () => {
    const editor = editorWith();
    type(editor, '[] one'); enter(editor); type(editor, 'two');
    press(editor, 'Tab');
    expect(outline(editor)).toBe('taskList\n  taskItem( )\n    taskList\n      taskItem( )');
    editor.destroy();
  });
});

describe('bullet list to checklist', () => {
  it('a two-level bullet list becomes a two-level checklist, sub-points as sub-checkboxes', () => {
    const editor = editorWith(NESTED_BULLETS);
    expect(outline(editor)).toBe('bulletList\n  listItem\n    bulletList\n      listItem\n      listItem\n  listItem');
    editor.commands.selectAll();
    expect(editor.commands.toggleChecklist()).toBe(true);
    expect(outline(editor)).toBe('taskList\n  taskItem( )\n    taskList\n      taskItem( )\n      taskItem( )\n  taskItem( )');
    expect(markdownOf(editor)).toBe('- [ ] Groceries\n    - [ ] Milk\n    - [ ] Eggs\n- [ ] Laundry');
    editor.destroy();
  });
  it('converts back to bullets with the nesting kept', () => {
    const editor = editorWith('- [x] Groceries\n    - [ ] Milk\n- [ ] Laundry');
    editor.commands.selectAll();
    editor.commands.toggleChecklist();
    expect(outline(editor)).toBe('bulletList\n  listItem\n    bulletList\n      listItem\n  listItem');
    editor.destroy();
  });
  it('a selection inside a sub-point converts the whole list it belongs to, and keeps the cursor', () => {
    const editor = editorWith('Intro\n\n' + NESTED_BULLETS + '\n\nOutro');
    cursorAt(editor, 'ilk');
    const before = editor.state.selection.from;
    editor.commands.toggleChecklist();
    expect(outline(editor)).toBe('paragraph\ntaskList\n  taskItem( )\n    taskList\n      taskItem( )\n      taskItem( )\n  taskItem( )\nparagraph');
    expect(editor.state.selection.from).toBe(before);
    editor.destroy();
  });
  it('Ctrl+Shift+9 is the same conversion', () => {
    const editor = editorWith(NESTED_BULLETS);
    cursorAt(editor, 'Eggs');
    press(editor, 'Ctrl-Shift-9');
    expect(outline(editor)).toBe('taskList\n  taskItem( )\n    taskList\n      taskItem( )\n      taskItem( )\n  taskItem( )');
    press(editor, 'Ctrl-Shift-9');
    expect(outline(editor)).toBe('bulletList\n  listItem\n    bulletList\n      listItem\n      listItem\n  listItem');
    editor.destroy();
  });
  it('the toolbar\'s Bullet list turns a checklist back into bullets, nesting kept', () => {
    const editor = editorWith('- [ ] a\n    - [ ] b');
    cursorAt(editor, 'b');
    editor.commands.toggleBullets();
    expect(outline(editor)).toBe('bulletList\n  listItem\n    bulletList\n      listItem');
    editor.destroy();
  });
  it('the selection toolbar\'s Checklist button converts the nested list', async () => {
    // floating-ui asks element.matches(':popover-open') and (':modal') while placing the toolbar; jsdom's
    // selector engine throws on both, slowly enough to stall the test for a minute. A browser answers natively.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) { return selector === ':popover-open' || selector === ':modal' ? false : matches.call(this, selector); });
    let saved = '';
    render(<DocEditor markdown={NESTED_BULLETS} onChange={markdown => { saved = markdown; }}/>);
    const editor = (screen.getByRole('textbox', { name: 'Document body' }) as HTMLElement & { editor: Editor }).editor;
    act(() => { editor.commands.focus(); editor.commands.selectAll(); });
    const toolbar = await screen.findByRole('toolbar', { name: 'Format selection' });
    expect(Array.from(toolbar.querySelectorAll('button')).map(b => b.getAttribute('aria-label'))).toEqual(['Bold', 'Italic', 'Heading', 'Bullet list', 'Checklist (Ctrl+Shift+9)']);
    fireEvent.click(screen.getByRole('button', { name: 'Checklist (Ctrl+Shift+9)' }));
    expect(saved).toBe('- [ ] Groceries\n    - [ ] Milk\n    - [ ] Eggs\n- [ ] Laundry');
    expect(screen.getByRole('button', { name: 'Checklist (Ctrl+Shift+9)' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('plain paragraphs become a new checklist', () => {
    const editor = editorWith('Buy milk');
    editor.commands.toggleChecklist();
    expect(markdownOf(editor)).toBe('- [ ] Buy milk');
    editor.destroy();
  });
});

describe('markdown round trip', () => {
  it('nested checklists, ticks and bullets come back exactly as written', () => {
    const md = '# Plan\n\nSome **bold** and *italic* text.\n\n- [ ] Groceries\n    - [x] Milk\n    - [ ] Eggs\n        - [ ] Brown\n- [x] Laundry\n\n- one\n    - one a\n\n1. first\n2. second';
    const editor = editorWith(md);
    expect(markdownOf(editor)).toBe(md);
    expect(editorWith(markdownOf(editor)).getMarkdown()).toBe(md);
    editor.destroy();
  });
  it('the app\'s Markdown renderer shows the saved checklist at its depth, ticks included', () => {
    const { container } = render(<Markdown content={'- [ ] Groceries\n    - [x] Milk'}/>);
    const tasks = container.querySelectorAll('.markdown-task');
    expect(tasks).toHaveLength(2);
    expect((tasks[0] as HTMLElement).style.marginLeft).toBe('');
    expect((tasks[1] as HTMLElement).style.marginLeft).toBe('18px');
    expect(tasks[1]).toHaveClass('done');
  });
});

describe('the Docs page', () => {
  const editorOnPage = async () => {
    const body = await screen.findByRole('textbox', { name: 'Document body' }, { timeout: 10000 });
    return (body as HTMLElement & { editor: Editor }).editor;
  };
  it('New makes a note, and the title and body save themselves after a pause', async () => {
    const user = userEvent.setup();
    render(<Host initial={withDocs()}/>);
    expect(screen.getByText('No documents yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const editor = await editorOnPage();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Groceries');
    act(() => { type(editor, '- Milk'); });
    expect(screen.getByRole('status')).toHaveTextContent('Saving');
    await waitFor(async () => {
      const [doc] = (await loadWorkspace()).docs;
      expect(doc).toMatchObject({ name: 'Groceries', content: '- Milk', kind: 'note', tags: ['Note'] });
    }, { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(screen.getByRole('button', { name: /Groceries/ })).toHaveAttribute('aria-current', 'true');
  });
  it('an unsaved edit is saved at once when another document is opened', async () => {
    const a = makeDoc('Alpha', 'first', 'note', ['Note']);
    const b = makeDoc('Beta', 'second', 'note', ['Idea']);
    a.updated = '2026-09-28T10:00:00.000Z'; b.updated = '2026-09-27T10:00:00.000Z';
    await saveWorkspace(withDocs(a, b));
    render(<Host initial={withDocs(a, b)}/>);
    const editor = await editorOnPage();
    act(() => { editor.commands.focus('end'); type(editor, ' edit'); });
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await waitFor(async () => expect((await loadWorkspace()).docs.find(d => d.id === a.id)!.content).toBe('first edit'));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Beta');
  });
  // Re-pointed 2026-09-28: the Note / Journal / Idea chips became the left pane's views (All notes, Journal,
  // Ideas, Pinned), so the test clicks Ideas and All notes, and the Journal's New is Today's entry.
  it('the views filter the list, and New follows the view', async () => {
    const user = userEvent.setup();
    // Last week's entry, so Today's entry has to make today's rather than reopen this one.
    const lastWeek = { ...makeDoc('Monday, September 21, 2026', '', 'note', ['Journal']), created: new Date(Date.now() - 7 * 864e5).toISOString() };
    render(<Host initial={withDocs(makeDoc('Shopping', '', 'note', ['Note']), makeDoc('Rocket app', '', 'note', ['Idea']), lastWeek)}/>);
    const list = () => screen.getAllByRole('listitem').map(li => li.querySelector('strong')!.textContent);
    expect(list()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Ideas' }));
    expect(list()).toEqual(['Rocket app']);
    expect(screen.getByRole('button', { name: 'New idea' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    expect(list()).toEqual(['Monday, September 21, 2026']);
    await user.click(screen.getByRole('button', { name: "Today's entry" }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(journalTitle(new Date())));
    await user.click(screen.getByRole('button', { name: 'All notes' }));
    expect(list()).toHaveLength(4);
    await user.type(screen.getByRole('searchbox', { name: 'Search documents' }), 'rocket');
    expect(list()).toEqual(['Rocket app']);
  });
});

// 2026-09-28: the notebook and journal. A note's notebook is a "notebook:<id>" tag and the names live in
// workspace.notebooks; the left pane's views are plain functions in lib/docs-kinds.ts.
const at = (iso: string, doc: Workspace['docs'][number]) => ({ ...doc, created: iso, updated: iso });

describe('views, the journal and word counts', () => {
  it('Journal, Ideas, Pinned, a notebook and a tag each narrow the list; pinned sits on top', () => {
    const plain = at('2026-09-28T10:00:00.000Z', makeDoc('Plain', '', 'note', ['Note']));
    const pinned = { ...at('2026-09-01T10:00:00.000Z', makeDoc('Pinned one', '', 'note', ['Note', 'notebook:nb1'])), pinned: true };
    const idea = at('2026-09-27T10:00:00.000Z', makeDoc('Idea one', '', 'note', ['Idea', 'Reading']));
    const entry = at('2026-09-20T10:00:00.000Z', makeDoc('Sunday, September 20, 2026', '', 'note', ['Journal']));
    const docs = [plain, pinned, idea, entry, makeDoc('a.pdf', '', 'file')];
    const names = (view: Parameters<typeof viewDocs>[1]) => viewDocs(docs, view, '').map(d => d.name);
    expect(names('all')).toEqual(['Pinned one', 'Plain', 'Idea one', 'Sunday, September 20, 2026']);
    expect(names('journal')).toEqual(['Sunday, September 20, 2026']);
    expect(names('ideas')).toEqual(['Idea one']);
    expect(names('pinned')).toEqual(['Pinned one']);
    expect(names('notebook:nb1')).toEqual(['Pinned one']);
    expect(names('tag:Reading')).toEqual(['Idea one']);
  });
  it('journal entries group by month, and On this day finds the same date in earlier months and years', () => {
    const entries = ['2026-09-28T09:00:00', '2026-09-03T09:00:00', '2026-08-28T09:00:00', '2025-09-28T09:00:00', '2026-08-27T09:00:00']
      .map(when => at(new Date(when).toISOString(), makeDoc(journalTitle(new Date(when)), '', 'note', ['Journal'])));
    const groups = journalMonths(viewDocs(entries, 'journal', ''));
    expect(groups.map(g => [g.month, g.entries.length])).toEqual([['September 2026', 2], ['August 2026', 2], ['September 2025', 1]]);
    expect(onThisDay(entries, new Date(2026, 8, 28, 20)).map(d => d.name)).toEqual(['Friday, August 28, 2026', 'Sunday, September 28, 2025']);
  });
  it('counts words, not list markers or checkboxes', () => {
    expect(wordCount('# Plan\n\n- [ ] Buy milk\n    - [x] eggs\n\n**Bold** text, 42.')).toBe(7);
    expect(wordCount('')).toBe(0);
  });
});

describe('the notebook and journal page', () => {
  const list = () => screen.getAllByRole('listitem').map(li => li.querySelector('strong')!.textContent);
  const nav = () => screen.getByRole('navigation', { name: 'Notebooks and tags' });
  it('makes, renames and deletes a notebook, and deleting it keeps its notes', async () => {
    const user = userEvent.setup();
    const a = at('2026-09-28T10:00:00.000Z', makeDoc('Alpha', 'first', 'note', ['Note']));
    const b = at('2026-09-27T10:00:00.000Z', makeDoc('Beta', 'second', 'note', ['Note']));
    await saveWorkspace(withDocs(a, b));
    render(<Host initial={withDocs(a, b)}/>);
    await user.click(screen.getByRole('button', { name: 'New notebook' }));
    await user.type(screen.getByRole('textbox', { name: 'New notebook name' }), 'School{Enter}');
    expect(await within(nav()).findByRole('button', { name: /^School/ })).toHaveTextContent('School0');
    // Alpha is open (newest); file it in School from the settings row.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Notebook' }), 'School');
    const [notebook] = (await loadWorkspace()).notebooks!;
    await waitFor(async () => expect((await loadWorkspace()).docs.find(d => d.id === a.id)!.tags).toEqual(['Note', 'notebook:' + notebook.id]));
    expect(within(nav()).getByRole('button', { name: /^School/ })).toHaveTextContent('School1');
    await user.click(within(nav()).getByRole('button', { name: /^School/ }));
    expect(list()).toEqual(['Alpha']);
    await user.click(screen.getByRole('button', { name: 'Rename School' }));
    const field = screen.getByRole('textbox', { name: 'Rename School' });
    await user.clear(field); await user.type(field, 'CMSC423{Enter}');
    expect(await within(nav()).findByRole('button', { name: /^CMSC423/ })).toBeInTheDocument();
    expect((await loadWorkspace()).notebooks).toEqual([{ id: notebook.id, name: 'CMSC423' }]);
    await user.click(screen.getByRole('button', { name: 'Delete CMSC423' }));
    await user.click(screen.getByRole('button', { name: 'Delete notebook' }));
    await waitFor(async () => expect((await loadWorkspace()).notebooks).toEqual([]));
    const saved = (await loadWorkspace()).docs;
    expect(saved.map(d => d.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(saved.find(d => d.id === a.id)!.tags).toEqual(['Note']);
    expect(list()).toEqual(['Alpha', 'Beta']);
    expect(within(nav()).queryByRole('button', { name: /^CMSC423/ })).toBeNull();
  });
  it('the Pinned and tag views, tags typed on a note, and pinning from the settings row', async () => {
    const user = userEvent.setup();
    const a = at('2026-09-28T10:00:00.000Z', makeDoc('Alpha', 'first', 'note', ['Note']));
    const b = at('2026-09-27T10:00:00.000Z', makeDoc('Beta', 'second', 'note', ['Idea', 'Reading']));
    await saveWorkspace(withDocs(a, b));
    render(<Host initial={withDocs(a, b)}/>);
    // Tags: only the typed ones, never the kind.
    expect(within(nav()).getAllByRole('button').map(button => button.textContent)).toEqual(['All notes', 'Journal', 'Ideas', 'Pinned', '', 'Reading1']);
    await user.click(within(nav()).getByRole('button', { name: /^Reading/ }));
    expect(list()).toEqual(['Beta']);
    await user.click(screen.getByRole('button', { name: 'All notes' }));
    // Alpha is open: tag it and pin it.
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'Reading, Exam{Enter}');
    await waitFor(async () => expect((await loadWorkspace()).docs.find(d => d.id === a.id)!.tags).toEqual(['Note', 'Reading', 'Exam']));
    expect(within(nav()).getByRole('button', { name: /^Reading/ })).toHaveTextContent('Reading2');
    await user.click(screen.getByRole('button', { name: 'Pin this document' }));
    await waitFor(async () => expect((await loadWorkspace()).docs.find(d => d.id === a.id)!.pinned).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(list()).toEqual(['Alpha']);
    expect(screen.getByRole('button', { name: /Alpha/ }).querySelector('[aria-label="Pinned"]')).not.toBeNull();
  });
  it("the Journal groups entries by month under their dates, with On this day and Today's entry at the top", async () => {
    const user = userEvent.setup();
    const today = new Date();
    const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate(), 9);
    const old = at(lastYear.toISOString(), makeDoc(journalTitle(lastYear), 'a year ago', 'note', ['Journal']));
    render(<Host initial={withDocs(old, makeDoc('Shopping', '', 'note', ['Note']))}/>);
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    const thisMonth = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const lastYearMonth = lastYear.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(within(screen.getByRole('region', { name: 'On this day' })).getByRole('button', { name: new RegExp(journalTitle(lastYear)) })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: lastYearMonth })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Today's entry" }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(journalTitle(today)));
    expect(within(screen.getByRole('region', { name: thisMonth })).getByRole('button', { name: new RegExp(journalTitle(today)) })).toHaveAttribute('aria-current', 'true');
    // A second press opens the same entry rather than making another.
    await user.click(screen.getByRole('button', { name: "Today's entry" }));
    expect((await loadWorkspace()).docs.filter(d => d.name === journalTitle(today))).toHaveLength(1);
  });
  it('at phone width the list and the note take turns: opening a note shows it, the back arrow shows the list', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host initial={withDocs(makeDoc('Alpha', 'first', 'note', ['Note']))}/>);
    const page = container.querySelector('.docs-page')!;
    expect(page).toHaveAttribute('data-pane', 'list');
    await user.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(page).toHaveAttribute('data-pane', 'note');
    await user.click(screen.getByRole('button', { name: 'All documents' }));
    expect(page).toHaveAttribute('data-pane', 'list');
  });
  it('Full screen and Ctrl+Shift+F open the note at #write/<id>, but not from a plain text field', async () => {
    const user = userEvent.setup();
    const a = makeDoc('Alpha', 'first', 'note', ['Note']);
    render(<Host initial={withDocs(a)}/>);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search documents' }), { key: 'F', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'F', ctrlKey: true, shiftKey: true });
    await act(async () => {});
    expect(window.location.hash).toBe('');
    fireEvent.keyDown(document.body, { key: 'F', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#write/' + a.id));
    window.location.hash = '';
    await user.click(screen.getByRole('button', { name: /Full screen/ }));
    await waitFor(() => expect(window.location.hash).toBe('#write/' + a.id));
  });
});

// 2026-09-28, later the same day: Save as PDF on every note, and the resume as a note of kind Resume.
describe('Save as PDF and the resume under Docs', () => {
  it('Save as PDF prints, and the print rules print the note alone on letter paper', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<Host initial={withDocs(makeDoc('Alpha', '- [x] done\n- [ ] not yet', 'note', ['Note']))}/>);
    expect(screen.getByRole('region', { name: 'Editor' })).toHaveClass('note-print');
    await user.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/docs.css'), 'utf8');
    const rules = css.slice(css.indexOf('@media print'));
    expect(rules).toContain('@page note{size:letter;');
    expect(rules).toContain('body:has(.note-print) *:not(:has(.note-print)):not(.note-print):not(.note-print *){display:none!important}');
    expect(rules).toContain('.note-print .docs-meta');
    expect(rules).toMatch(/\.note-print\{page:note;[^}]*--ink:#111/);
  });
  it('New offers Note, Journal entry, Idea and Resume; Resume opens the resume editor, and there is one', async () => {
    const user = userEvent.setup();
    render(<Host initial={withDocs(makeDoc('Alpha', 'first', 'note', ['Note']))}/>);
    await user.click(screen.getByRole('button', { name: 'New, other kinds' }));
    expect(within(screen.getByRole('menu', { name: 'New document' })).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Note', 'Journal entry', 'Idea', 'Resume, from a template']);
    await user.click(screen.getByRole('menuitem', { name: 'Resume, from a template' }));
    expect(await screen.findByRole('article', { name: 'Resume preview' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document body' })).toBeNull();
    // The resume prints its own page, so the note print mark is off while it is open.
    expect(screen.getByRole('region', { name: 'Editor' })).not.toHaveClass('note-print');
    expect(screen.getByRole('button', { name: /^Resume/ })).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByRole('button', { name: /Alpha/ }));
    // A written note cannot be switched into the resume.
    expect(Array.from((screen.getByRole('combobox', { name: 'Kind' }) as HTMLSelectElement).options).map(o => o.textContent)).toEqual(['Note', 'Journal', 'Idea']);
    await user.click(screen.getByRole('button', { name: 'New, other kinds' }));
    await user.click(screen.getByRole('menuitem', { name: 'Resume, from a template' }));
    await waitFor(async () => expect((await loadWorkspace()).docs.filter(d => d.tags.includes('Resume'))).toHaveLength(1));
    expect(await screen.findByRole('article', { name: 'Resume preview' })).toBeInTheDocument();
  });
});
