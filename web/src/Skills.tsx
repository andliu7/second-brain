// The Skills page: every skill installed in ~/.claude/skills, read live through /api/skills
// (server/live.mjs), plus the skills written in this browser, marked Personal.
//
// The skills show as a card grid or a list, as Linkwarden shows links: a two-button switch at the
// top right picks one, and this browser remembers it. Beside them, the skills the server can run
// sit in a column of run boxes (RunPanel.tsx). A skill opens in a pop-up over the page, as Claude's
// own skill viewer shows one. The pop-up has an address, #skills/<folder> or #skills/personal/<id>,
// so it can be linked, bookmarked and left with Back. The cards are plain <a href="#skills/...">
// elements, and App's hashchange listener does the routing.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Copy, Download, LayoutGrid, List, Loader2, MessageSquare, Pencil, Pin, Plus, Search, Trash2, X } from 'lucide-react';
import type { Doc } from './types';
import { Markdown } from './Markdown';
import { RunColumn } from './RunPanel';
import './skills.css';

// path is the skill's folder under ~/.claude/skills. A skill installed here has a folder of its own,
// so path is its slug; a plugin skill syncs one level deeper, into synced/<bucket>/<slug>, and source
// says which of the two it is so a card can name where the skill came from.
export type InstalledSkill = { name: string; slug: string; description: string; skill: string; readme: string | null; files: string[]; path: string; source: 'installed' | 'synced'; task: string | null };

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

// The list shows a summary that fits the one line its row gives it, so every row has the same height: the whole
// description when it fits, else the sentences that fit, else the text up to the last clause (or
// word) that fits, with an ellipsis to show text was dropped. Asides in (brackets) go first. A
// piece under 40 characters is too short to say what the skill does ("Comprehensive design skill"),
// so the cut moves further along. A clause is only preferred when it ends in the last fifth of the
// room, so an ellipsis never sits in the middle of an empty column. `fits` says whether a text fits
// the row: the list passes one that measures the real column (see Skills); without it, 100
// characters, which is what a card shows. The tooltip and the skill's pop-up carry the whole description.
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

// The pop-up title already names the skill, so a document that opens by saying it again
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

// Grid or list, remembered in this browser. Storage can be missing or refuse (a private window,
// blocked site data), so every read and write is wrapped, and the grid is what a fresh browser sees.
type View = 'grid' | 'list';
const VIEW_KEY = 'skills-view';
function storedView(): View { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } }

// How many lines a text takes in a column `room` wide, wrapped the way the browser wraps it: a word
// joins the line while it still fits, else it starts the next one.
function wrapped(context: CanvasRenderingContext2D, text: string, room: number) {
  let lines = 1, line = '';
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && context.measureText(next).width > room) { lines++; line = word; } else line = next;
  }
  return lines;
}

// Measures the summary block, so each summary can be cut where its line ends rather than at a
// fixed character count. A canvas measures text in the rows' own font, and a ResizeObserver (a
// browser callback that fires when an element changes size) measures again when the window or the
// list changes. Without one (the unit tests' jsdom) it returns undefined and summary() counts
// characters instead. `view` measures again on a switch to the list, whose column did not exist in the grid.
// Every row has the same columns, chip or no chip (skills.css), so one measurement cuts them all.
// Round 4, visual critic: the summary had one line in a 462px column, so 25 of the 32 installed
// descriptions were cut with an ellipsis and the column read as a wall of unfinished sentences. The
// summary runs the width of the row now and has two lines, which leaves 3 of 32 cut.
// Round 7, visual critic: two lines made every row a paragraph. One line, the width of the row.
const LINES = 1;
function useColumnFit(list: RefObject<HTMLElement | null>, view: View) {
  const [fits, setFits] = useState<(text: string) => boolean>();
  useEffect(() => {
    const context = typeof ResizeObserver === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (!list.current || !context) return;
    const measure = () => {
      const cell = list.current?.querySelector<HTMLElement>('.skill-row-description');
      if (!cell) return;
      const style = getComputedStyle(cell);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      // canvas and layout round sub-pixels differently, so a pixel of room is left at the end
      const room = cell.clientWidth - 2;
      setFits(() => (text: string) => wrapped(context, text, room) <= LINES);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list.current);
    void document.fonts?.ready.then(measure); // measured before the web font arrived, the widths were the fallback font's
    return () => observer.disconnect();
  }, [list, view]);
  return fits;
}

const CODE = /\.(py|js|cjs|mjs|ts|ps1|sh)$/i;
const scriptsTag = (code: string[]) => code.length > 0 && <span className="tag" title={`${code.length} code ${code.length === 1 ? 'file' : 'files'}: ${code.slice(0, 3).join(', ')}${code.length > 3 ? ', …' : ''}`}>Scripts</span>;
// A plugin skill syncs into ~/.claude/skills/synced/<bucket>/<slug> rather than getting a folder of its
// own, so its card says where it came from. The list row keeps one tag column (the Scripts slot every row
// reserves), so there the source is in the pop-up's path line, which names the real file either way.
const syncedTag = (path: string) => <span className="tag" title={`Synced plugin skill, at ~/.claude/skills/${path}`}>Synced</span>;

// The right-hand count, as two cells rather than one string: the number right-set in its own column and
// the word left-set in the next, so 1 file and 214 files line up on both edges down the whole list.
// Round 3, visual critic: "'Scripts' appears only on some rows, so the '2 files' / '214 files' values
// float". They floated because the whole count was one right-aligned cell, so its digits started
// wherever the word ended. A personal skill's last edit is the same two cells, the day then the month.
type Count = { n: string; unit: string };
const fileCount = (files: number): Count => ({ n: String(files), unit: files === 1 ? 'file' : 'files' });
const editedOn = (updated: string): Count => ({ n: new Date(updated).toLocaleDateString('en-US', { day: 'numeric' }), unit: new Date(updated).toLocaleDateString('en-US', { month: 'short' }) });
const countCells = (meta: Count) => <><span className="skill-row-num">{meta.n}</span><span className="skill-row-unit">{meta.unit}</span></>;

export function Skills(props: Props) {
  const { path, installed, error, personal, newSkill } = props;
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(storedView);
  const choose = (next: View) => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* switched for this visit, not remembered */ } };
  const list = useRef<HTMLDivElement>(null);
  const fits = useColumnFit(list, view);
  // Closing the pop-up puts focus back on the card or row it was opened from, so a keyboard user
  // carries on from where they were. The address says which one, so this works after Back too.
  const opened = useRef(path);
  useEffect(() => { const closed = opened.current; opened.current = path; if (closed && !path) [...list.current?.querySelectorAll('a') || []].find(a => a.getAttribute('href') === '#skills/' + closed)?.focus(); }, [path]);
  // `code` is the skill's own code files (scripts Claude may run when it uses the skill), shown as a
  // Scripts chip so the list says which skills are more than instructions.
  const rows = [
    ...(installed || []).map(skill => ({ key: skill.slug, href: '#skills/' + skill.slug, name: skill.name, description: skill.description, personal: false, synced: skill.source === 'synced' ? skill.path : '', code: skill.files.filter(file => CODE.test(file)), meta: fileCount(skill.files.length) })),
    ...personal.map(doc => ({ key: doc.id, href: '#skills/personal/' + doc.id, name: doc.name, description: describe(doc), personal: true, synced: '', code: [], meta: editedOn(doc.updated) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(needle));
  // Groups give the list an entry point: the skills written here, then the rest. Each keeps the A to Z
  // order; an empty group is not shown. The heading says Personal once, so no row repeats it on screen;
  // a personal row shows the day it was last edited where an installed one shows its file count. Its
  // link still says Personal to a screen reader (sr-only), which reads a link on its own, away from
  // the heading above it.
  // Round 3, visual critic: a Runs here group held the same two skills as the run column beside it, so
  // "the same two items appear twice on one screen". The run column is where a runnable skill is named
  // now, group and all; the list says every skill once.
  const groups = [
    { key: 'personal', title: 'Personal', rows: shown.filter(row => row.personal) },
    { key: 'installed', title: 'Installed', rows: shown.filter(row => !row.personal) },
  ].filter(group => group.rows.length);
  // The same groups in both views: bands in the list, section headings over the grid. The run column
  // comes first in the page's order, so on a narrow screen it sits above the skills; on a wide one
  // the CSS grid puts it in a column on the right.
  return <>
    <div className="page-heading skill-list-heading"><div><h1>Skills</h1></div><div className="heading-actions"><label className="inline-search"><Search size={15}/><input aria-label="Search skills" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)}/></label><button className="button primary" onClick={newSkill}><Plus size={16}/>New skill</button>
      <div className="view-switch" role="group" aria-label="View">{([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([id, Icon, label]) => <button key={id} type="button" className="icon-button" aria-label={label} title={label} aria-pressed={view === id} onClick={() => choose(id)}><Icon size={16}/></button>)}</div></div></div>
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    <div className="skills-body">
      <RunColumn/>
      <div className={view === 'grid' ? 'skill-grid' : 'panel skill-list'} ref={list}>
        {installed === null && !shown.length && <div className="skill-empty"><Loader2 className="spin" size={16}/>Reading ~/.claude/skills…</div>}
        {groups.map(group => <section key={group.key}>
          <h2 className="skill-group"><span className={'skill-group-mark ' + group.key}/>{group.title} <span className="skill-group-count">{group.rows.length}</span></h2>
          <div className="skill-items">{group.rows.map(row => view === 'grid'
            ? <a className="skill-card" key={row.key} href={row.href}><span className="skill-card-name"><strong>{row.name}</strong>{row.personal && <span className="sr-only">, Personal</span>}</span><span className="skill-card-description" title={row.description}>{summary(row.description) || 'No description yet.'}</span><span className="skill-card-foot"><span className="skill-card-tags">{row.synced && syncedTag(row.synced)}{scriptsTag(row.code)}</span><span className="skill-card-meta">{row.meta.n} {row.meta.unit}</span></span></a>
            : <a className="skill-row" key={row.key} href={row.href}><span className="skill-row-name"><strong>{row.name}</strong>{row.personal && <span className="sr-only">, Personal</span>}</span><span className="skill-row-description" title={row.description}>{summary(row.description, fits) || 'No description yet.'}</span><span className="skill-row-kind">{scriptsTag(row.code)}</span><span className="skill-row-meta">{countCells(row.meta)}</span></a>)}</div>
        </section>)}
        {installed !== null && !shown.length && <p className="skill-empty">{needle ? 'No skill matches that search.' : 'No skills yet. Install one in ~/.claude/skills, or write one with New skill.'}</p>}
      </div>
    </div>
    {/* key={path} gives each skill a fresh pop-up (its selected tab, its scroll) instead of reusing the last one's */}
    {path && <SkillDialog key={path} {...props}/>}
  </>;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

// One skill in a pop-up over the page, as Claude's own skill viewer shows one: the name at the top,
// level with Close, the file path under it; then the body, opening on the whole description with the
// other frontmatter labels, then the document and the skill's files at the end of it. It is a native
// <dialog> opened with showModal(), so the browser dims the page behind and keeps it out of reach
// until the pop-up closes. Escape, Close or a click on the dimmed page close it by going back to
// #skills, and Skills then puts focus back on the card.
function SkillDialog({ path, installed, personal, chat, duplicate, mine: actions }: Props) {
  const [tab, setTab] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null), thumb = useRef<HTMLSpanElement>(null);
  const close = () => { location.hash = 'skills'; };
  // The pop-up draws its own scroll rail beside the body. Round 2 of the resumed run, visual critic:
  // "the scrollable body fades out mid-sentence into the footer with no scrollbar, no scroll shadow and
  // no visible track, so the modal looks truncated rather than scrollable". Chrome's own scrollbar is an
  // overlay that a capture never paints (and headless Chrome hides it outright), so the track is drawn
  // here instead and the browser's is turned off (skills.css), leaving one rail rather than two.
  // The geometry is written straight to the two nodes rather than held in state: it is measured after
  // every render (the document, its tab, the window) and on every scroll, and state here would re-render
  // on each measurement for nothing.
  const measure = () => {
    const el = scroller.current, track = rail.current, bar = thumb.current;
    if (!el || !track || !bar) return;
    const room = el.clientHeight, all = el.scrollHeight, more = all > room + 1;
    track.style.display = more ? '' : 'none';
    if (!more) return;
    const height = Math.max(32, room * room / all);
    Object.assign(track.style, { top: el.offsetTop + 'px', height: room + 'px' });
    Object.assign(bar.style, { height: height + 'px', top: Math.min(room - height, el.scrollTop / all * room) + 'px' });
  };
  // Focus goes to the pop-up itself, not its first button, so a screen reader reads its name first
  // and a stray Enter cannot press Use in Chat.
  useEffect(() => { const element = dialog.current!; element.showModal(); element.focus({ preventScroll: true }); return () => element.close(); }, []);
  // After the pop-up is open, not before: a <dialog> that has not been shown has no height at all, so a
  // first measurement above this one would find nothing to scroll and hide the rail for good. The web
  // font arriving changes how long the document is, so that is measured again too.
  useEffect(measure);
  useEffect(() => { addEventListener('resize', measure); void document.fonts?.ready.then(measure); return () => removeEventListener('resize', measure); }, []);
  // Escape closes it (the browser's own Escape would close the <dialog> without changing the
  // address). The focus trap: Tab on the last stop goes to the first, Shift+Tab on the first (or on
  // the pop-up itself, which holds focus when it opens) goes to the last. Every other Tab is the
  // browser's own. Chrome also stops Tab on a block that scrolls and holds no control (a wide table,
  // a code block, the document itself), so it can be scrolled from the keyboard; those count as stops
  // too, or the trap would wrap before reaching them.
  function keys(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(`${FOCUSABLE}, pre, .markdown-table, .skill-dialog-body`)].filter(e => e.matches(FOCUSABLE) || ((e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight) && !e.querySelector(FOCUSABLE)));
    if (!items.length) return;
    const at = document.activeElement, first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (at === first || at === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus(); }
  }
  // The content fills the <dialog> edge to edge, so a click whose target is the <dialog> itself landed on the dimmed page around it.
  // Every pop-up ends in the same foot: a bar the full width of the frame, under the scrolling body, that
  // closes the object and says the way out from the keyboard. The document fades into it (skills.css).
  // Round 5, visual critic: the actions were crowded into the title band beside the description, so the
  // cluster read as pasted on rather than anchored. They are the foot's action bar now, on the content
  // column's own right edge, which also keeps them in reach however far the document is scrolled.
  const shell = (children: ReactNode, actions?: ReactNode) => <dialog ref={dialog} className="skill-dialog" aria-labelledby="skill-dialog-title" tabIndex={-1} onKeyDown={keys} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>{children}<div className="skill-dialog-foot"><span className="skill-dialog-hint">Esc closes this pop-up</span>{actions && <div className="heading-actions">{actions}</div>}</div></dialog>;
  const closeButton = <button type="button" className="icon-button skill-dialog-close" aria-label="Close" title="Close (Esc)" onClick={close}><X size={18}/></button>;
  const mine = path.startsWith('personal/') ? personal.find(doc => doc.id === path.slice('personal/'.length)) : undefined;
  const skill = mine ? undefined : installed?.find(item => item.slug === path);
  // A deep link opens the pop-up before /api/skills has answered, so until it does the pop-up is
  // still reading, not empty: the title says so too, or every cold #skills/<slug> would be titled
  // "Skill not found" (and read out as that) for as long as the list takes to arrive.
  const reading = installed === null && !path.startsWith('personal/');
  if (!mine && !skill) return shell(<><div className="skill-dialog-head"><div className="skill-dialog-bar"><h2 id="skill-dialog-title" className="skill-dialog-title">{reading ? 'Loading skill…' : 'Skill not found'}</h2>{closeButton}</div></div><div className="skill-empty">{reading ? <><Loader2 className="spin" size={16}/>Reading ~/.claude/skills…</> : `Nothing at #skills/${path}. It may have been removed or renamed.`}</div></>);

  // README.md comes first when a skill has one; SKILL.md (or a personal skill's text) is always there.
  const docs = mine ? [{ name: 'Instructions', text: mine.content }] : [...(skill!.readme ? [{ name: 'README.md', text: skill!.readme }] : []), { name: 'SKILL.md', text: skill!.skill }];
  const main = splitFrontmatter(mine ? mine.content : skill!.skill);
  const fields = main.fields.filter(([key]) => key !== 'name'); // the name is already the title
  const selected = Math.min(tab, docs.length - 1); // a README can vanish from disk while its tab is open
  const current = docs[selected];
  const title = mine ? mine.name : skill!.name;
  const body = withoutTitle(current.name === 'README.md' ? current.text : main.body, title);
  const tabbed = docs.length > 1; // a tab bar only when there are two documents to switch between
  // The head stays put while the body scrolls, so the title and Close are always in reach; the foot
  // holds the actions the same way. The description is the lede the body opens on; its label is kept
  // for screen readers only. The other fields (license, version) sit below it as small labels.
  // In the foot bar the quiet actions come first and the primary one is last, on the right edge.
  const actionBar = mine ? <>
    <button className="button" onClick={() => actions.remove(mine)}><Trash2 size={16}/>Delete</button>
    <button className="button" onClick={() => actions.download(mine)}><Download size={16}/>Download</button>
    <button className="button" onClick={() => actions.pin(mine)}><Pin size={16}/>{mine.pinned ? 'Unpin' : 'Pin'}</button>
    <button className="button" onClick={() => actions.edit(mine)}><Pencil size={16}/>Edit</button>
    <button className="button primary" onClick={() => actions.attach(mine)}><MessageSquare size={16}/>Use in Chat</button>
  </> : <>
    <button className="button" onClick={() => duplicate(skill!)}><Copy size={16}/>Duplicate to edit</button>
    <button className="button primary" onClick={() => chat(skill!)}><MessageSquare size={16}/>Use in Chat</button>
  </>;
  return shell(<>
    <div className="skill-dialog-head"><div className="skill-dialog-bar">
      <h2 id="skill-dialog-title" className="skill-dialog-title">{title}</h2>
      {closeButton}
    </div>
      {/* The meta row: the file shown below and the skill's file count. The path names that file, so a lone document needs no tab to say what it is */}
      <p className="skill-path">{mine ? 'Personal skill, written in this browser and saved on this device.' : `~/.claude/skills/${skill!.path}/${current.name} · ${skill!.files.length} ${skill!.files.length === 1 ? 'file' : 'files'}`}</p></div>
    <div className="skill-dialog-body" ref={scroller} onScroll={measure}>
      {/* Round 3, visual critic: the head "stacks a 26px title, a tiny monospace path and a truncated
          one-line description with a More link, so it reads as three competing levels ... remove the
          truncated description from the header. Keep the title plus one metadata line ... let the body
          open with the full description." The head is the title and the meta row; the description opens
          the body, whole, with the rest of the frontmatter as labels under it. Nothing is cut, so
          nothing needs a More. */}
      {fields.length > 0 && <ul className="skill-fields" aria-label="Skill details">{fields.map(([key, value], i) => key === 'description'
        ? <li key={i} className="skill-lede"><span className="sr-only">description</span><span className="skill-lede-text">{value}</span></li>
        : <li key={i}><span className="skill-field-key">{key}</span><span>{value}</span></li>)}</ul>}
      <div className="skill-dialog-main">
        <section className="skill-doc">
          {tabbed && <div className="tabs" role="tablist" aria-label="Documents">{docs.map((doc, i) => <button key={doc.name} role="tab" id={`skill-tab-${i}`} aria-controls="skill-doc-panel" aria-selected={i === selected} className={i === selected ? 'selected' : ''} onClick={() => setTab(i)}>{doc.name}</button>)}</div>}
          <div id="skill-doc-panel" role={tabbed ? 'tabpanel' : 'region'} aria-labelledby={tabbed ? `skill-tab-${selected}` : undefined} aria-label={tabbed ? undefined : current.name}><Markdown joinLines content={body.trim() ? body : 'This document is empty.'}/></div>
        </section>
        {/* Every file in the skill's folder, as Claude's viewer lists them, at the end of the document and
            on its measure. Only SKILL.md and a README open here, as the tabs above. */}
        {skill && <section className="skill-files" aria-labelledby="skill-files-title"><h3 id="skill-files-title">Files <span className="skill-group-count">{skill.files.length}</span></h3><ul>{skill.files.map(file => <li key={file}>{file}</li>)}</ul></section>}
      </div>
    </div>
    <div className="skill-scroll-rail" ref={rail} aria-hidden="true"><span ref={thumb}/></div>
  </>, actionBar);
}
