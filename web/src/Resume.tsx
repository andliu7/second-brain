// Resume: a form on the left and a live one-page US letter preview on the right. Props:
//   workspace: the Workspace; the resume is workspace.resume, or emptyResume() when a saved workspace predates it
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mount from App.tsx with one line:
//   {page === 'resume' && <Resume workspace={workspace} commit={commit}/>}
//
// The form edits a local draft, so a keystroke does not write IndexedDB. The draft is saved SAVE_DELAY ms
// after the last change, and at once if the page unmounts before that. Download PDF is window.print():
// the print rules at the end of resume.css hide everything but the page, and the browser's Save as PDF
// makes the file, so no PDF library ships. The layout (form beside a letter-size preview, and the
// sections) is an idea taken from OpenResume; none of its code is used here, because it is AGPL-3.0.
//
// The page has nine looks, picked in the Template menu and saved as workspace.resume.template: Classic
// (the original), and eight whose layout and typography are adapted from the templates of the same names
// in Reactive Resume (https://github.com/amruthpillai/reactive-resume, at
// d9fdf7a30a3eb132986b3f82dea01c21738540eb), MIT License, Copyright (c) 2026 Amruth Pillai: Onyx, Ditto
// and Azurill first, then Ditgar and Leafish (a sidebar, left and right), Kakuna (centred and compact),
// Meowth (each entry's heading on one line) and Scizor (a rule across the top, ruled sections). Only the
// look is adapted, written again here as CSS (resume.css); its code and its data schema are not used.
// All of them draw the same markup, so a template is a data-template attribute and nothing else. The
// sections sit in a main column and the skills in a side column; the one-column looks let both columns
// fall away (display: contents), and the sidebar looks lay them side by side.
//
// Import LaTeX and Export LaTeX (2026-09-28) read and write the resume as a .tex file, in the shape of
// Jake Gutierrez's template that most student resumes start from; the parsing is lib/latex-resume.ts.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, FileCode2, FileUp, Plus, Trash2, X } from 'lucide-react';
import type { Resume as ResumeData, ResumeEntry, ResumeTemplate, Workspace } from './types';
import { download, uid } from './lib/storage';
import { copyText } from './lib/clipboard';
import { parseLatexResume, resumeToLatex, type LatexImport } from './lib/latex-resume';
import './resume.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type SectionKey = 'education' | 'experience' | 'projects';
type Hints = { title: string; subtitle: string; date: string; location: string; bullets: string };
// The three list sections share one entry shape; only the labels and the placeholder hints differ.
const SECTIONS: { key: SectionKey; heading: string; one: string; title: string; subtitle: string; hints: Hints }[] = [
  { key: 'education', heading: 'Education', one: 'education', title: 'School', subtitle: 'Degree', hints: { title: 'University name', subtitle: 'B.S. in your major, GPA', date: 'Aug 2023 to May 2027', location: 'City, State', bullets: 'Relevant coursework, honors, one per line' } },
  { key: 'experience', heading: 'Experience', one: 'experience', title: 'Company', subtitle: 'Role', hints: { title: 'Company name', subtitle: 'Job title', date: 'Jun 2025 to Aug 2025', location: 'City, State or Remote', bullets: 'What you did and what it changed, one per line' } },
  { key: 'projects', heading: 'Projects', one: 'project', title: 'Project', subtitle: 'Tech or link', hints: { title: 'Project name', subtitle: 'React, Python, or a link', date: '2026', location: '', bullets: 'What it does and your part in it, one per line' } },
];
const SAVE_DELAY = 600;
export const TEMPLATES: { id: ResumeTemplate; name: string; hint: string }[] = [
  { id: 'classic', name: 'Classic', hint: 'Centred name, ruled capital headings' },
  { id: 'onyx', name: 'Onyx', hint: 'Name on the left over a coloured rule' },
  { id: 'ditto', name: 'Ditto', hint: 'A coloured band across the top' },
  { id: 'azurill', name: 'Azurill', hint: 'Centred header, entries on a timeline' },
  { id: 'ditgar', name: 'Ditgar', hint: 'A tinted sidebar on the left, the name in a dark block at its top' },
  { id: 'leafish', name: 'Leafish', hint: 'A two-tone header band, skills in a column on the right' },
  { id: 'kakuna', name: 'Kakuna', hint: 'Centred and compact, headings ruled and centred' },
  { id: 'meowth', name: 'Meowth', hint: 'Each entry on one line: title, subtitle, dates' },
  { id: 'scizor', name: 'Scizor', hint: 'A coloured rule across the top, sections divided by rules' },
];

export const emptyResume = (): ResumeData => ({ profile: { name: '', email: '', phone: '', location: '', links: [] }, education: [], experience: [], projects: [], skills: [] });
const newEntry = (): ResumeEntry => ({ id: uid(), title: '', subtitle: '', date: '', location: '', bullets: [] });
// A textarea holds one item per line. Blank lines are kept while typing (so Enter works) and skipped when shown.
const lines = (text: string) => text === '' ? [] : text.split('\n');
const filled = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
const joined = (items: string[]) => filled(items).join(' | ');
const hasContent = (entry: ResumeEntry) => filled([entry.title, entry.subtitle, entry.date, entry.location, ...entry.bullets]).length > 0;
// Swap an entry with its neighbour; by is -1 for up, 1 for down. Out of range leaves the list as it was.
export function moveEntry<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// The resume as plain text, for pasting into an application form.
export function resumeText(resume: ResumeData): string {
  const { profile } = resume;
  const out = filled([profile.name, joined([profile.email, profile.phone, profile.location, ...profile.links])]);
  for (const section of SECTIONS) {
    const entries = resume[section.key].filter(hasContent);
    if (!entries.length) continue;
    out.push('', section.heading.toUpperCase());
    for (const entry of entries) {
      const head = joined([entry.title, entry.subtitle, entry.location, entry.date]);
      if (head) out.push(head);
      for (const bullet of filled(entry.bullets)) out.push(`- ${bullet}`);
    }
  }
  const skills = filled(resume.skills);
  if (skills.length) out.push('', 'SKILLS', ...skills);
  return out.join('\n');
}

export function Resume({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const [draft, setDraft] = useState<ResumeData>(() => workspace.resume ?? emptyResume());
  const [note, setNote] = useState('');
  // Refs, not state: the save timer and the unmount flush must read the newest commit and unsaved draft,
  // not the ones captured when the effect was set up. pending is null when everything is saved.
  const commitRef = useRef(commit);
  const pending = useRef<ResumeData | null>(null);
  useEffect(() => { commitRef.current = commit; });
  const save = () => { const next = pending.current; if (!next) return; pending.current = null; void commitRef.current(w => ({ ...w, resume: next })); };
  // Debounce: every change restarts the timer, so the save runs once typing pauses.
  useEffect(() => { if (!pending.current) return; const timer = setTimeout(save, SAVE_DELAY); return () => clearTimeout(timer); }, [draft]);
  // Leaving the page inside the delay would drop the last edit, so unmounting saves what is pending.
  useEffect(() => save, []);

  const update = (change: (resume: ResumeData) => ResumeData) => { const next = change(draft); pending.current = next; setDraft(next); };
  const setProfile = (key: keyof ResumeData['profile'], value: string | string[]) => update(r => ({ ...r, profile: { ...r.profile, [key]: value } }));
  const setSection = (key: SectionKey, change: (entries: ResumeEntry[]) => ResumeEntry[]) => update(r => ({ ...r, [key]: change(r[key]) }));

  async function copy() { setNote(await copyText(resumeText(draft)) ? 'Copied as plain text.' : 'Could not copy. Select the preview and copy it instead.'); }
  // Export LaTeX: the resume as a Jake-style .tex file, named after the person.
  const exportLatex = () => download(`${(draft.profile.name.trim() || 'resume').replace(/\s+/g, '-')}.tex`, new Blob([resumeToLatex(draft)], { type: 'application/x-tex' }));
  const [importing, setImporting] = useState(false);

  const { profile } = draft;
  return <section className="panel resume" aria-label="Resume">
    <div className="section-heading"><h2>Resume</h2>
      <div className="resume-actions">
        <label className="resume-template">Template<select value={draft.template ?? 'classic'} onChange={e => update(r => ({ ...r, template: e.target.value as ResumeTemplate }))}>{TEMPLATES.map(t => <option key={t.id} value={t.id} title={t.hint}>{t.name}</option>)}</select></label>
        <button type="button" className="button small" aria-expanded={importing} onClick={() => setImporting(value => !value)}><FileUp size={14}/>Import LaTeX</button>
        <button type="button" className="button small" onClick={exportLatex} title="A .tex file in the shape of Jake's resume template"><FileCode2 size={14}/>Export LaTeX</button>
        <button type="button" className="button small" onClick={copy}><Copy size={14}/>Copy as plain text</button>
        <button type="button" className="button small primary" onClick={() => window.print()} title="Opens the print dialog; choose Save as PDF"><Download size={14}/>Download PDF</button>
      </div>
    </div>
    {note && <p className="resume-note" role="status">{note}</p>}
    {importing && <LatexImporter close={() => setImporting(false)} apply={imported => update(r => ({ ...imported, template: r.template }))}/>}
    <div className="resume-body">
      <form className="resume-form" onSubmit={event => event.preventDefault()}>
        <fieldset className="resume-group">
          <legend>Profile</legend>
          <div className="resume-fields">
            <label>Name<input value={profile.name} onChange={e => setProfile('name', e.target.value)} placeholder="Your full name"/></label>
            <label>Email<input type="email" value={profile.email} onChange={e => setProfile('email', e.target.value)} placeholder="you@example.com"/></label>
            <label>Phone<input type="tel" value={profile.phone} onChange={e => setProfile('phone', e.target.value)} placeholder="(555) 555-0100"/></label>
            <label>Location<input value={profile.location} onChange={e => setProfile('location', e.target.value)} placeholder="City, State"/></label>
            <label className="resume-wide">Links<textarea rows={2} value={profile.links.join('\n')} onChange={e => setProfile('links', lines(e.target.value))} placeholder="linkedin.com/in/you, github.com/you, one per line"/></label>
          </div>
        </fieldset>
        {SECTIONS.map(section => <fieldset key={section.key} className="resume-group">
          <legend>{section.heading}</legend>
          {draft[section.key].map((entry, index, all) => <EntryEditor key={entry.id} section={section} entry={entry} index={index} count={all.length}
            onChange={next => setSection(section.key, list => list.map(e => e.id === entry.id ? next : e))}
            onMove={by => setSection(section.key, list => moveEntry(list, index, by))}
            onRemove={() => setSection(section.key, list => list.filter(e => e.id !== entry.id))}/>)}
          <button type="button" className="button small" onClick={() => setSection(section.key, list => [...list, newEntry()])}><Plus size={14}/>Add {section.one}</button>
        </fieldset>)}
        <fieldset className="resume-group">
          <legend>Skills</legend>
          <label className="resume-wide">Skills<textarea rows={3} value={draft.skills.join('\n')} onChange={e => update(r => ({ ...r, skills: lines(e.target.value) }))} placeholder="Languages: Python, Java, one line per group"/></label>
        </fieldset>
      </form>
      <div className="resume-preview"><ResumeSheet resume={draft}/></div>
    </div>
  </section>;
}

// Import LaTeX: paste the .tex or open the file, Read it to see what was found and what was not, then
// Replace the resume with it. Nothing changes until Replace, and the template is kept.
function LatexImporter({ close, apply }: { close: () => void; apply: (resume: ResumeData) => void }) {
  const [source, setSource] = useState('');
  const [read, setRead] = useState<LatexImport | null>(null);
  const [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const parse = (text: string) => { setRead(text.trim() ? parseLatexResume(text) : null); setDone(false); };
  // FileReader rather than file.text(): the same text, and it also works in the jsdom the tests run in.
  function open(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const text = String(reader.result); setSource(text); parse(text); };
    reader.readAsText(file);
  }
  const found = read && [
    read.resume.profile.name && 'the name',
    plural(read.resume.education.length, 'education entry', 'education entries'),
    plural(read.resume.experience.length, 'experience entry', 'experience entries'),
    plural(read.resume.projects.length, 'project'),
    plural(read.resume.skills.length, 'skills line'),
  ].filter(Boolean).join(', ');
  return <section className="resume-import" aria-label="Import a LaTeX resume">
    <div className="resume-import-bar">
      <strong>Import a LaTeX resume</strong>
      <span>Jake's template and most others built from \section and lists.</span>
      <button type="button" className="icon-button" aria-label="Close import" onClick={close}><X size={15}/></button>
    </div>
    <textarea aria-label="LaTeX source" rows={7} spellCheck={false} value={source} placeholder={'Paste the .tex here, from \\documentclass to \\end{document}'} onChange={event => { setSource(event.target.value); setRead(null); setDone(false); }}/>
    <input ref={picker} className="sr-only" type="file" accept=".tex,text/x-tex,application/x-tex,text/plain" aria-label="Choose a .tex file" onChange={event => { open(event.target.files?.[0]); event.target.value = ''; }}/>
    <div className="resume-import-actions">
      <button type="button" className="button small" onClick={() => picker.current?.click()}><FileUp size={14}/>Open a .tex file</button>
      <button type="button" className="button small" disabled={!source.trim()} onClick={() => parse(source)}>Read it</button>
      {read && !done && <button type="button" className="button small primary" onClick={() => { apply(read.resume); setDone(true); }}>Replace my resume with this</button>}
    </div>
    {read && <div className="resume-import-result" role="status">
      <p>{done ? 'Imported. ' : ''}Found {found || 'nothing that looks like a resume'}.</p>
      {read.unread.length > 0 && <><p>Could not be read:</p><ul>{read.unread.map((line, i) => <li key={i}>{line}</li>)}</ul></>}
    </div>}
  </section>;
}
const plural = (n: number, one: string, many = one + 's') => n ? `${n} ${n === 1 ? one : many}` : '';

function EntryEditor({ section, entry, index, count, onChange, onMove, onRemove }: { section: typeof SECTIONS[number]; entry: ResumeEntry; index: number; count: number; onChange: (entry: ResumeEntry) => void; onMove: (by: number) => void; onRemove: () => void }) {
  const name = `${section.heading} ${index + 1}`;
  const set = (key: 'title' | 'subtitle' | 'date' | 'location', value: string) => onChange({ ...entry, [key]: value });
  return <div className="resume-entry" role="group" aria-label={name}>
    <div className="resume-entry-bar">
      <span>{entry.title.trim() || name}</span>
      <button type="button" className="icon-button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14}/></button>
      <button type="button" className="icon-button" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14}/></button>
      <button type="button" className="icon-button" aria-label={`Remove ${name}`} onClick={onRemove}><Trash2 size={14}/></button>
    </div>
    <div className="resume-fields">
      <label>{section.title}<input value={entry.title} onChange={e => set('title', e.target.value)} placeholder={section.hints.title}/></label>
      <label>{section.subtitle}<input value={entry.subtitle} onChange={e => set('subtitle', e.target.value)} placeholder={section.hints.subtitle}/></label>
      <label>Dates<input value={entry.date} onChange={e => set('date', e.target.value)} placeholder={section.hints.date}/></label>
      <label>Location<input value={entry.location} onChange={e => set('location', e.target.value)} placeholder={section.hints.location}/></label>
      <label className="resume-wide">Bullets<textarea rows={3} value={entry.bullets.join('\n')} onChange={e => onChange({ ...entry, bullets: lines(e.target.value) })} placeholder={section.hints.bullets}/></label>
    </div>
  </div>;
}

// The page itself. resume.css sizes it to US letter and the print rules print it alone.
function ResumeSheet({ resume }: { resume: ResumeData }) {
  const { profile } = resume;
  const contact = filled([profile.email, profile.phone, profile.location, ...profile.links]);
  const skills = filled(resume.skills);
  const empty = !filled([profile.name, ...contact, ...skills]).length && SECTIONS.every(s => !resume[s.key].some(hasContent));
  return <article className="resume-page" data-template={resume.template ?? 'classic'} aria-label="Resume preview">
    {empty && <p className="resume-hint">Fill in the form and the page builds here.</p>}
    {/* One wrapper for the name and contact line, so a template can band or rule them as a block. */}
    {(profile.name.trim() || contact.length > 0) && <header className="resume-head">
      {profile.name.trim() && <h2 className="resume-name">{profile.name.trim()}</h2>}
      {contact.length > 0 && <p className="resume-contact">{contact.map((item, i) => <span key={i}>{item}</span>)}</p>}
    </header>}
    {/* The main column and the side column: the side holds the skills. One-column templates let both
        wrappers fall away in CSS; the sidebar templates lay them out side by side. */}
    <div className="resume-main">{SECTIONS.map(section => {
      const entries = resume[section.key].filter(hasContent);
      if (!entries.length) return null;
      return <section key={section.key} className="resume-section">
        <h3>{section.heading}</h3>
        {entries.map(entry => <div key={entry.id} className="resume-item">
          <div className="resume-row"><strong>{entry.title}</strong><span>{entry.date}</span></div>
          {(entry.subtitle.trim() || entry.location.trim()) && <div className="resume-row resume-sub"><em>{entry.subtitle}</em><span>{entry.location}</span></div>}
          {filled(entry.bullets).length > 0 && <ul>{filled(entry.bullets).map((bullet, i) => <li key={i}>{bullet}</li>)}</ul>}
        </div>)}
      </section>;
    })}</div>
    <div className="resume-side">{skills.length > 0 && <section className="resume-section"><h3>Skills</h3>{skills.map((line, i) => <p key={i} className="resume-skill">{line}</p>)}</section>}</div>
  </article>;
}
