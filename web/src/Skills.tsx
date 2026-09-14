// The Skills page: every skill installed in ~/.claude/skills, read live through /api/skills
// (server/live.mjs), plus the skills written in this browser, marked Personal.
//
// Each skill is its own page, at #skills/<folder> or #skills/personal/<id>, rather than a
// modal: a page can be linked, bookmarked, opened in a new tab and left with Back. The links
// are plain <a href="#skills/..."> elements, and App's hashchange listener does the routing.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Copy, Download, Loader2, MessageSquare, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import type { Doc } from './types';
import { Markdown } from './Markdown';
import { RunPanel } from './RunPanel';
import './skills.css';

export type InstalledSkill = { name: string; slug: string; description: string; skill: string; readme: string | null; files: string[]; task: string | null };

// Splits the YAML frontmatter off the top of a SKILL.md into [key, value] pairs. No YAML
// library: it reads `key: value`, quoted values, the indented lines under a key (a `|` or
// `>` block), and a nested map under an empty key (`metadata:` then `  version: "2.9.1"`),
// whose keys become fields of their own. These are the shapes the installed skills use.
export function splitFrontmatter(text: string): { fields: [string, string][]; body: string } {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (lines[0]?.trim() !== '---' || end < 0) return { fields: [], body: text };
  const fields: [string, string][] = [];
  let map = false; // true under an empty `key:`, where indented `key: value` lines are nested keys, not text
  for (const line of lines.slice(1, end)) {
    const field = /^([\w.-]+):\s*(.*)$/.exec(line);
    const nested = map ? /^\s+([\w.-]+):\s*(.*)$/.exec(line) : null;
    if (field) { fields.push([field[1], field[2]]); map = !field[2].trim(); }
    else if (nested) fields.push([nested[1], nested[2]]);
    else if (fields.length && line.trim()) fields[fields.length - 1][1] += ' ' + line.trim();
  }
  const clean = fields.map(([key, value]): [string, string] => [key, value.replace(/^[|>]-?\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2')]).filter(([, value]) => value); // an emptied `metadata:` header has nothing to show
  return { fields: clean, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

// A personal skill has no description field unless it has frontmatter, so fall back to its first line.
function describe(doc: Doc) {
  const { fields, body } = splitFrontmatter(doc.content);
  return fields.find(([key]) => key === 'description')?.[1] || body.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
}

// The list shows a summary that fits one line, so every row has the same height: the whole
// description when it fits, else the sentences that fit, else the text up to the last clause (or
// word) that fits, with an ellipsis to show text was dropped. Asides in (brackets) go first. A
// piece under 40 characters is too short to say what the skill does ("Comprehensive design skill"),
// so the cut moves further along. A clause is only preferred when it ends in the last fifth of the
// room, so an ellipsis never sits in the middle of an empty column. `fits` says whether a text fits
// the row: the list passes one that measures the real column (see SkillList); without it, 100
// characters. The row's tooltip and the skill's page carry the whole description.
const SUMMARY = 100;
export function summary(description: string, fits = (text: string) => text.length <= SUMMARY) {
  const text = description.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (fits(text)) return text;
  let room = 0, over = text.length; // binary search: text.slice(0, room) fits, text.slice(0, over) does not
  while (over - room > 1) { const mid = (room + over) >> 1; if (fits(text.slice(0, mid))) room = mid; else over = mid; }
  const head = text.slice(0, room + 1);
  const ends = (pattern: RegExp) => [...head.matchAll(pattern)].map(match => match.index!);
  const sentence = Math.max(-1, ...ends(/[.!?](?=\s)/g));
  if (sentence >= 40) return head.slice(0, sentence + 1);
  // The last clause or space where the cut, ellipsis included, still fits
  const cut = (pattern: RegExp) => ends(pattern).reverse().find(i => fits(head.slice(0, i) + '\u2026')) ?? -1;
  const clause = cut(/[,;:](?=\s)| [-\u2013\u2014] /g); // a hyphen, en dash or em dash with a space each side
  return head.slice(0, clause >= 40 && clause >= 0.8 * room ? clause : cut(/ /g)) + '\u2026';
}

// The page title already names the skill, so a document that opens by saying it again
// (# /generate, # Design System) starts at its next line instead.
const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
function withoutTitle(body: string, name: string) {
  const [first, ...rest] = body.replace(/^\s+/, '').split('\n');
  const heading = /^#{1,6}\s+(.*)$/.exec(first);
  return heading && bare(heading[1]) === bare(name) ? rest.join('\n') : body;
}

type DocAction = (doc: Doc) => void;
type Props = {
  path: string;                       // what follows #skills/ in the address; empty for the list
  installed: InstalledSkill[] | null; // null while /api/skills is still being read
  error: string;
  personal: Doc[];
  newSkill: () => void;
  chat: (skill: InstalledSkill) => void;
  duplicate: (skill: InstalledSkill) => void;
  mine: { attach: DocAction; edit: DocAction; pin: DocAction; download: DocAction; remove: DocAction };
};

// key={path} gives each skill page fresh state (its selected tab) instead of reusing the last one's.
export function Skills(props: Props) { return props.path ? <SkillPage key={props.path} {...props}/> : <SkillList {...props}/>; }

// Measures the summary column, so each summary can be cut where the column ends rather than at a
// fixed character count. A canvas measures text in the rows' own font, and a ResizeObserver (a
// browser callback that fires when an element changes size) measures again when the window or the
// list changes. Without one (the unit tests' jsdom) it returns undefined and summary() counts
// characters instead.
function useColumnFit(list: RefObject<HTMLElement | null>) {
  const [fits, setFits] = useState<(text: string) => boolean>();
  useEffect(() => {
    const context = typeof ResizeObserver === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (!list.current || !context) return;
    const measure = () => {
      const cell = list.current?.querySelector<HTMLElement>('.skill-row-description');
      if (!cell) return;
      const style = getComputedStyle(cell);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = cell.clientWidth - 2; // canvas and layout round sub-pixels differently
      setFits(() => (text: string) => context.measureText(text).width <= width);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list.current);
    void document.fonts?.ready.then(measure); // measured before the web font arrived, the widths were the fallback font's
    return () => observer.disconnect();
  }, [list]);
  return fits;
}

const CODE = /\.(py|js|cjs|mjs|ts|ps1|sh)$/i;

function SkillList({ installed, error, personal, newSkill }: Props) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const fits = useColumnFit(list);
  // `code` is the skill's own code files (scripts Claude may run when it uses the skill), shown as a
  // Scripts chip so the list says which skills are more than instructions.
  const rows = [
    ...(installed || []).map(skill => ({ key: skill.slug, href: '#skills/' + skill.slug, name: skill.name, description: skill.description, personal: false, runs: !!skill.task, code: skill.files.filter(file => CODE.test(file)), meta: `${skill.files.length} ${skill.files.length === 1 ? 'file' : 'files'}` })),
    ...personal.map(doc => ({ key: doc.id, href: '#skills/personal/' + doc.id, name: doc.name, description: describe(doc), personal: true, runs: false, code: [], meta: new Date(doc.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(needle));
  // Groups give the list an entry point: the skills with a Run button first, then the ones written
  // here, then the rest. Each keeps the A to Z order; an empty group is not shown. The heading says
  // Runs here or Personal once, so no row repeats it on screen; a personal row shows the day it was
  // last edited where an installed one shows its file count. Its link still says Personal to a
  // screen reader (sr-only), which reads a link on its own, away from the heading above it.
  const groups = [
    { key: 'runs', title: 'Runs here', rows: shown.filter(row => row.runs) },
    { key: 'personal', title: 'Personal', rows: shown.filter(row => row.personal) },
    { key: 'installed', title: 'Installed', rows: shown.filter(row => !row.runs && !row.personal) },
  ].filter(group => group.rows.length);
  return <>
    <div className="page-heading skill-list-heading"><div><h1>Skills</h1><p>{installed ? `${installed.length} installed in ~/.claude/skills, read live, plus ${personal.length} you wrote here.` : 'Reading ~/.claude/skills…'}</p></div><div className="heading-actions"><label className="inline-search"><Search size={15}/><input aria-label="Search skills" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)}/></label><button className="button" onClick={newSkill}><Plus size={16}/>New skill</button></div></div>
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    <div className="panel skill-list" ref={list}>
      {installed === null && !shown.length && <div className="skill-empty"><Loader2 className="spin" size={16}/>Reading ~/.claude/skills…</div>}
      {groups.map(group => <section key={group.key}>
        <h2 className="skill-group"><span className={'skill-group-mark ' + group.key}/>{group.title} <span className="skill-group-count">{group.rows.length}</span></h2>
        {group.rows.map(row => <a className="skill-row" key={row.key} href={row.href}><span className="skill-row-name"><strong>{row.name}</strong>{row.personal && <span className="sr-only">, Personal</span>}</span><span className="skill-row-description" title={row.description}>{summary(row.description, fits) || 'No description yet.'}</span><span className="skill-row-kind">{row.code.length > 0 && <span className="tag" title={`${row.code.length} code ${row.code.length === 1 ? 'file' : 'files'}: ${row.code.slice(0, 3).join(', ')}${row.code.length > 3 ? ', …' : ''}`}>Scripts</span>}</span><span className="skill-row-meta">{row.meta}</span></a>)}
      </section>)}
      {installed !== null && !shown.length && <p className="skill-empty">{needle ? 'No skill matches that search.' : 'No skills yet. Install one in ~/.claude/skills, or write one with New skill.'}</p>}
    </div>
  </>;
}

function SkillPage({ path, installed, personal, chat, duplicate, mine: actions }: Props) {
  const [tab, setTab] = useState(0);
  useEffect(() => { document.documentElement.scrollTop = 0; }, []);
  const mine = path.startsWith('personal/') ? personal.find(doc => doc.id === path.slice('personal/'.length)) : undefined;
  const skill = mine ? undefined : installed?.find(item => item.slug === path);
  const back = <a className="text-button skill-back" href="#skills"><ArrowLeft size={15}/>All skills</a>;
  if (!mine && !skill) return <>{back}<div className="panel skill-empty">{installed === null && !path.startsWith('personal/') ? <><Loader2 className="spin" size={16}/>Reading ~/.claude/skills…</> : `Nothing at #skills/${path}. It may have been removed or renamed.`}</div></>;

  // README.md comes first when a skill has one; SKILL.md (or a personal skill's text) is always there.
  const docs = mine ? [{ name: 'Instructions', text: mine.content }] : [...(skill!.readme ? [{ name: 'README.md', text: skill!.readme }] : []), { name: 'SKILL.md', text: skill!.skill }];
  const main = splitFrontmatter(mine ? mine.content : skill!.skill);
  const fields = main.fields.filter(([key]) => key !== 'name'); // the name is already the page title
  const selected = Math.min(tab, docs.length - 1); // a README can vanish from disk while its tab is open
  const current = docs[selected];
  const title = mine ? mine.name : skill!.name;
  const body = withoutTitle(current.name === 'README.md' ? current.text : main.body, title);
  const tabbed = docs.length > 1; // a tab bar only when there are two documents to switch between
  // The description is the lede under the title; its label is kept for screen readers only. The
  // other fields (license, version) sit below it as small labels.
  return <div className="skill-page">
    {back}
    <div className="page-heading"><div><h1>{title}</h1>
      {fields.length > 0 && <ul className="skill-fields" aria-label="Skill details">{fields.map(([key, value], i) => <li key={i} className={key === 'description' ? 'skill-lede' : undefined}><span className={key === 'description' ? 'sr-only' : 'skill-field-key'}>{key}</span><span>{value}</span></li>)}</ul>}</div>
      <div className="heading-actions">{mine ? <>
        <button className="button primary" onClick={() => actions.attach(mine)}><MessageSquare size={16}/>Use in Chat</button>
        <button className="button" onClick={() => actions.edit(mine)}><Pencil size={16}/>Edit</button>
        <button className="button" onClick={() => actions.pin(mine)}><Pin size={16}/>{mine.pinned ? 'Unpin' : 'Pin'}</button>
        <button className="button" onClick={() => actions.download(mine)}><Download size={16}/>Download</button>
        <button className="button" onClick={() => actions.remove(mine)}><Trash2 size={16}/>Delete</button>
      </> : <>
        <button className="button primary" onClick={() => chat(skill!)}><MessageSquare size={16}/>Use in Chat</button>
        <button className="button" onClick={() => duplicate(skill!)}><Copy size={16}/>Duplicate to edit</button>
      </>}</div>
    </div>
    {skill?.task && <RunPanel id={skill.task}/>}
    {/* The path names the file shown below it, so a lone document needs no tab to say what it is */}
    <p className="skill-path">{mine ? 'Personal skill, written in this browser and saved on this device.' : `~/.claude/skills/${skill!.slug}/${current.name} · ${skill!.files.length} ${skill!.files.length === 1 ? 'file' : 'files'}`}</p>
    <section className="skill-doc">
      {tabbed && <div className="tabs" role="tablist" aria-label="Documents">{docs.map((doc, i) => <button key={doc.name} role="tab" id={`skill-tab-${i}`} aria-controls="skill-doc-panel" aria-selected={i === selected} className={i === selected ? 'selected' : ''} onClick={() => setTab(i)}>{doc.name}</button>)}</div>}
      <div id="skill-doc-panel" role={tabbed ? 'tabpanel' : 'region'} aria-labelledby={tabbed ? `skill-tab-${selected}` : undefined} aria-label={tabbed ? undefined : current.name}><Markdown joinLines content={body.trim() ? body : 'This document is empty.'}/></div>
    </section>
  </div>;
}
