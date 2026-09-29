// The kinds of document the Docs page holds: Note, Journal, Idea, Resume and PDF. Doc.kind stays 'note'
// for the first four (the schema's kind means note, file or skill), and the kind is a tag instead, so no
// schema change and every other page still reads these as notes. A note with none of the kind tags, such
// as a quick capture from Today, counts as a Note. A Resume note opens the resume editor (Resume.tsx, whose
// data is workspace.resume) instead of the text editor, and there is one, so its body stays empty.
// A PDF is the exception: it is a real file, so it stays Doc.kind 'file' with its bytes in Doc.data,
// and Chat and the file preview keep treating it as one. It carries the PDF tag like the other kinds,
// but it is known by its MIME type, so a PDF saved from PDF tools before Docs listed PDFs shows up too.
// Opening one shows PDF tools (PdfTools.tsx) working on that document.
// Kept free of TipTap so it costs nothing at start.
//
// Notebooks and the left pane's views live here too, as plain functions over workspace.docs, so the
// page and the tests share one definition of "what is in this view".
import type { Doc } from '../types';
import { makeDoc, readData } from './storage';

export const DOC_KINDS = ['Note', 'Journal', 'Idea', 'Resume', 'PDF'] as const;
export type DocKind = typeof DOC_KINDS[number];
// The kinds a written note can switch between in its Kind menu. A note does not turn into the resume.
export const TEXT_KINDS: DocKind[] = ['Note', 'Journal', 'Idea'];

// A document's name may not be empty (shared/validate.mjs), so a blank title is saved as this and the
// title field shows it as empty again, with Untitled as its placeholder.
export const UNTITLED = 'Untitled';

// A stored PDF: a file doc whose bytes are a PDF, the same test PDF tools used to list them.
export const isPdfDoc = (doc: Doc) => doc.kind === 'file' && !!doc.data && (doc.mime ?? '').startsWith('application/pdf');
// What the Docs page lists: every note, and the stored PDFs. Other files and skills have their own homes.
export const isListed = (doc: Doc) => doc.kind === 'note' || isPdfDoc(doc);
export const kindOf = (doc: Doc): DocKind => isPdfDoc(doc) ? 'PDF' : DOC_KINDS.find(kind => kind !== 'PDF' && doc.tags.includes(kind)) ?? 'Note';

// Journals are titled by their date, in the local time zone, e.g. "Monday, September 28, 2026".
export const journalTitle = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const sameDay = (iso: string, date: Date) => new Date(iso).toDateString() === date.toDateString();

// Pinned first, then the newest edit. Pinned is Doc.pinned, the same flag Today's pinned notes read,
// so a note pinned here is pinned there too.
const byPinThenNewest = (a: Doc, b: Doc) => Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated);

// The documents the page lists: notes and PDFs (isListed), pinned first then newest edit, narrowed by
// kind when one is picked and by a search over title and body (a PDF's body is empty, so its name).
export function listDocs(docs: Doc[], kind: DocKind | null, query: string): Doc[] {
  const q = query.trim().toLowerCase();
  return docs
    .filter(isListed)
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

// shared/validate.mjs refuses a doc's data over 25 MiB, so an import or a save checks first and says so.
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

// Import PDF: each file as a PDF doc, or a reason it was skipped. A file is taken as a PDF by its first
// bytes ("%PDF-"), not its name, so a renamed file is caught here rather than failing inside PDF tools.
// The data URL is made from a Blob typed application/pdf, because a file the system could not type
// reads as application/octet-stream and the validator requires Doc.mime to match the data URL.
export async function importPdfs(files: File[]): Promise<{ docs: Doc[]; skipped: string[] }> {
  const docs: Doc[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (file.size > MAX_PDF_BYTES) { skipped.push(`${file.name} (${(file.size / 1048576).toFixed(1)} MiB; the workspace holds files up to 25 MiB)`); continue; }
    const data = await readData(new Blob([file], { type: 'application/pdf' }));
    if (!atob(data.slice(data.indexOf(',') + 1, data.indexOf(',') + 9)).startsWith('%PDF-')) { skipped.push(`${file.name} (not a PDF)`); continue; }
    docs.push({ ...makeDoc(file.name, '', 'file', ['PDF']), mime: 'application/pdf', data, size: file.size });
  }
  return { docs, skipped };
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
// Every typed tag across the notes and PDFs, for the left pane, alphabetical.
export const allUserTags = (docs: Doc[]) => [...new Set(docs.filter(isListed).flatMap(doc => userTags(doc.tags)))].sort((a, b) => a.localeCompare(b));

// What the left pane can show. A string rather than an object so a view compares with === and could
// go into an address later without a parser.
export type View = 'all' | 'journal' | 'ideas' | 'pdfs' | 'pinned' | `notebook:${string}` | `tag:${string}`;

// The documents in a view. The journal reads by the day each entry was written (created), newest
// first, since an entry is about its day; every other view keeps pinned first, then newest edit.
export function viewDocs(docs: Doc[], view: View, query: string): Doc[] {
  if (view === 'journal') return listDocs(docs, 'Journal', query).sort((a, b) => b.created.localeCompare(a.created));
  const listed = listDocs(docs, view === 'ideas' ? 'Idea' : view === 'pdfs' ? 'PDF' : null, query);
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
