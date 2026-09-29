// The kinds of document the Docs page writes: Note, Journal, Idea and Resume. Doc.kind stays 'note' for
// all of them (the schema's kind means note, file or skill), and the kind is a tag instead, so no schema
// change and every other page still reads these as notes. A note with none of the kind tags, such as a
// quick capture from Today, counts as a Note. A Resume note opens the resume editor (Resume.tsx, whose
// data is workspace.resume) instead of the text editor, and there is one, so its body stays empty.
// Kept free of TipTap so it costs nothing at start.
//
// Notebooks and the left pane's views live here too, as plain functions over workspace.docs, so the
// page and the tests share one definition of "what is in this view".
import type { Doc } from '../types';
import { makeDoc } from './storage';

export const DOC_KINDS = ['Note', 'Journal', 'Idea', 'Resume'] as const;
export type DocKind = typeof DOC_KINDS[number];
// The kinds a written note can switch between in its Kind menu. A note does not turn into the resume.
export const TEXT_KINDS: DocKind[] = ['Note', 'Journal', 'Idea'];

// A document's name may not be empty (shared/validate.mjs), so a blank title is saved as this and the
// title field shows it as empty again, with Untitled as its placeholder.
export const UNTITLED = 'Untitled';

export const kindOf = (doc: Doc): DocKind => DOC_KINDS.find(kind => doc.tags.includes(kind)) ?? 'Note';

// Journals are titled by their date, in the local time zone, e.g. "Monday, September 28, 2026".
export const journalTitle = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const sameDay = (iso: string, date: Date) => new Date(iso).toDateString() === date.toDateString();

// Pinned first, then the newest edit. Pinned is Doc.pinned, the same flag Today's pinned notes read,
// so a note pinned here is pinned there too.
const byPinThenNewest = (a: Doc, b: Doc) => Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated);

// The documents the page lists: notes only (files and skills have their own homes), pinned first then
// newest edit, narrowed by kind when one is picked and by a search over title and body.
export function listDocs(docs: Doc[], kind: DocKind | null, query: string): Doc[] {
  const q = query.trim().toLowerCase();
  return docs
    .filter(doc => doc.kind === 'note')
    .filter(doc => !kind || kindOf(doc) === kind)
    .filter(doc => !q || doc.name.toLowerCase().includes(q) || doc.content.toLowerCase().includes(q))
    .sort(byPinThenNewest);
}

// What New does for a kind: a journal opens today's entry when it already exists (by the day it was
// created, so renaming it does not make a second one), the resume opens the one resume there is;
// anything else is a fresh, empty document.
export function newDocFor(kind: DocKind, docs: Doc[], today = new Date()): { doc: Doc; existing: boolean } {
  if (kind === 'Resume') {
    const found = docs.find(doc => doc.kind === 'note' && kindOf(doc) === 'Resume');
    return found ? { doc: found, existing: true } : { doc: makeDoc('Resume', '', 'note', ['Resume']), existing: false };
  }
  if (kind === 'Journal') {
    const found = docs.find(doc => doc.kind === 'note' && kindOf(doc) === 'Journal' && sameDay(doc.created, today));
    if (found) return { doc: found, existing: true };
    return { doc: makeDoc(journalTitle(today), '', 'note', ['Journal']), existing: false };
  }
  return { doc: makeDoc(UNTITLED, '', 'note', [kind]), existing: false };
}

// Notebooks. A note's notebook is one tag, "notebook:<id>", so a note sits in at most one notebook,
// needs no schema change, and still reads as a plain note everywhere else. The names live in the
// optional Workspace.notebooks, so renaming a notebook touches one record, not every note in it.
export const NOTEBOOK_TAG = 'notebook:';
export const notebookOf = (doc: Doc): string | null => doc.tags.find(tag => tag.startsWith(NOTEBOOK_TAG))?.slice(NOTEBOOK_TAG.length) ?? null;
export const withNotebook = (tags: string[], id: string | null) => [...tags.filter(tag => !tag.startsWith(NOTEBOOK_TAG)), ...(id ? [NOTEBOOK_TAG + id] : [])];

// The tags a person typed: every tag except the kind and the notebook, which have their own controls.
const isUserTag = (tag: string) => !(DOC_KINDS as readonly string[]).includes(tag) && !tag.startsWith(NOTEBOOK_TAG);
export const userTags = (tags: string[]) => tags.filter(isUserTag);
export const withUserTags = (tags: string[], next: string[]) => [...tags.filter(tag => !isUserTag(tag)), ...new Set(next.map(tag => tag.trim()).filter(tag => tag && isUserTag(tag)))];
// Every typed tag across the notes, for the left pane, alphabetical.
export const allUserTags = (docs: Doc[]) => [...new Set(docs.filter(doc => doc.kind === 'note').flatMap(doc => userTags(doc.tags)))].sort((a, b) => a.localeCompare(b));

// What the left pane can show. A string rather than an object so a view compares with === and could
// go into an address later without a parser.
export type View = 'all' | 'journal' | 'ideas' | 'pinned' | `notebook:${string}` | `tag:${string}`;

// The documents in a view. The journal reads by the day each entry was written (created), newest
// first, since an entry is about its day; every other view keeps pinned first, then newest edit.
export function viewDocs(docs: Doc[], view: View, query: string): Doc[] {
  if (view === 'journal') return listDocs(docs, 'Journal', query).sort((a, b) => b.created.localeCompare(a.created));
  const listed = listDocs(docs, view === 'ideas' ? 'Idea' : null, query);
  if (view === 'pinned') return listed.filter(doc => doc.pinned);
  if (view.startsWith('notebook:')) return listed.filter(doc => notebookOf(doc) === view.slice('notebook:'.length));
  if (view.startsWith('tag:')) return listed.filter(doc => doc.tags.includes(view.slice('tag:'.length)));
  return listed;
}

// Journal entries grouped under their month, "September 2026", in the order given (newest first).
export function journalMonths(entries: Doc[]): { month: string; entries: Doc[] }[] {
  const groups: { month: string; entries: Doc[] }[] = [];
  for (const entry of entries) {
    const month = new Date(entry.created).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (groups[groups.length - 1]?.month !== month) groups.push({ month, entries: [] });
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}

// On this day: entries written on today's day of the month in an earlier month or year, newest first.
export function onThisDay(docs: Doc[], today = new Date()): Doc[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return viewDocs(docs, 'journal', '').filter(doc => { const day = new Date(doc.created); return day.getDate() === today.getDate() && day.getTime() < start; });
}

// Words in a note's markdown: runs of text holding a letter or a digit, so list markers, checkbox
// brackets and heading hashes are not counted.
export const wordCount = (markdown: string) => markdown.replace(/\[[ xX]\]/g, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

// The list's two-line preview: the body's text with markdown line markers stripped, joined into one run.
export const previewOf = (markdown: string) => markdown.split('\n').map(line => line.replace(/^[\s#>*+-]*(\[[ xX]\]\s*)?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
