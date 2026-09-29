// LaTeX resumes in and out, for the resume editor's Import LaTeX and Export LaTeX (Resume.tsx). Pure
// functions over strings, no DOM, so the tests can feed them whole .tex files.
//
// Import reads the two shapes most student resumes come in. First, Jake Gutierrez's template (MIT), the
// one most computer science students start from: \resumeSubheading{..}{..}{..}{..}, \resumeItem{..},
// \resumeProjectHeading{..}{..} and \section{Education | Experience | Projects | Technical Skills}.
// Second, anything else built from \section and itemize lists: a top-level \item (or a loose line such as
// "\textbf{Acme} \hfill 2025") is an entry, and an \item nested under it is one of its bullets. Every
// other command is stripped to the text of its arguments (\textbf{Acme} is "Acme"), and the ones this
// file does not know are listed back, with any section that has no place in the resume (Awards, a
// summary), so the person sees what was not read. The preamble is template scaffolding and is skipped.
//
// Export writes a clean Jake-style file: the same command names and argument order, so it opens in the
// same Overleaf workflows, with the preamble written afresh here rather than copied.
import type { Resume, ResumeEntry } from '../types';
import { uid } from './storage';

export type LatexImport = { resume: Resume; unread: string[] };
type SectionKind = 'education' | 'experience' | 'projects' | 'skills';

// ---------------------------------------------------------------- reading LaTeX text

// A { } group starting at `at` (after any spaces): its inside, and where reading continues. Nested groups
// and escaped braces are skipped over; null when the next character is not a {.
function group(src: string, at: number): { inside: string; end: number } | null {
  let i = at;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return { inside: src.slice(i + 1, j), end: j + 1 };
  }
  return { inside: src.slice(i + 1), end: src.length };
}
// An [ ] option starting at `at` (after any spaces), the same way; null when there is none.
function option(src: string, at: number): { inside: string; end: number } | null {
  let i = at;
  while (i < src.length && /[ \t]/.test(src[i])) i++;
  if (src[i] !== '[') return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '{') depth++;
    else if (src[j] === '}') depth--;
    else if (src[j] === ']' && depth <= 0) return { inside: src.slice(i + 1, j), end: j + 1 };
  }
  return null;
}
// n groups in a row (options between them skipped), as far as they go.
function groups(src: string, at: number, n: number): { args: string[]; end: number } {
  const args: string[] = [];
  let end = at;
  while (args.length < n) {
    end = option(src, end)?.end ?? end;
    const next = group(src, end);
    if (!next) break;
    args.push(next.inside);
    end = next.end;
  }
  return { args, end };
}

// Commands that stand for a character or a gap. A gap that separates columns (\hfill, \quad) becomes a
// tab, which is how the entry and contact readers below find a line's right-hand column.
const SYMBOLS: Record<string, string> = {
  textbar: '|', textbullet: '\u2022', bullet: '\u2022', cdot: '\u00b7', diamond: '\u22c4', sim: '~', textasciitilde: '~',
  textasciicircum: '^', textbackslash: '\\', textless: '<', textgreater: '>', ldots: '\u2026', dots: '\u2026', textellipsis: '\u2026',
  textendash: '\u2013', textemdash: '\u2014', times: '\u00d7', pm: '\u00b1', approx: '\u2248', leq: '\u2264', geq: '\u2265',
  rightarrow: '\u2192', to: '\u2192', LaTeX: 'LaTeX', TeX: 'TeX', newline: '\n', linebreak: '\n',
  hfill: '\t', quad: '\t', qquad: '\t', enspace: ' ', thinspace: ' ', space: ' ', and: '\n', par: '\n',
};
// Commands whose arguments are lengths, colours or files, not text: dropped with those arguments.
const DROP: Record<string, number> = {
  vspace: 1, hspace: 1, vskip: 0, color: 1, fontsize: 2, setlength: 2, addtolength: 2, includegraphics: 1, pagestyle: 1,
  thispagestyle: 1, label: 1, titlespacing: 4, fontfamily: 1, usepackage: 1, faIcon: 1, phantom: 1, hphantom: 1, vphantom: 1,
};
// Formatting that keeps its text: the text of its arguments is read, the command itself drops.
const FORMAT = new Set(['textbf', 'textit', 'emph', 'underline', 'uline', 'textsc', 'texttt', 'textrm', 'textsf', 'textsl', 'textup',
  'textmd', 'textnormal', 'mbox', 'hbox', 'fbox', 'text', 'small', 'footnotesize', 'scriptsize', 'tiny', 'normalsize', 'large', 'Large',
  'LARGE', 'huge', 'Huge', 'bfseries', 'itshape', 'scshape', 'mdseries', 'upshape', 'normalfont', 'centering', 'noindent', 'selectfont',
  'bf', 'it', 'sc', 'rm', 'tt', 'raggedright', 'raggedleft', 'item', 'centerline', 'mathrm', 'mathbf', 'mathit', 'boldsymbol']);
// Environments whose \begin takes arguments that are layout, with how many { } groups to skip.
const ENV_ARGS: Record<string, number> = { tabular: 1, 'tabular*': 2, tabularx: 2, minipage: 1, multicols: 1, adjustwidth: 2 };

// LaTeX to plain text. Newlines in the source are spaces; \\ and \newline are line breaks ("\n") and a
// column gap or an unescaped & is a tab ("\t"), for the readers above that split on them. `unknown`
// collects the commands this file does not know, whose arguments are kept as text.
function toText(tex: string, unknown: Set<string>, math = false): string {
  let out = '';
  for (let i = 0; i < tex.length;) {
    const ch = tex[i];
    if (ch === '\\') {
      const next = tex[i + 1] ?? '';
      if (next === '\\') { out += '\n'; i = option(tex, i + 2)?.end ?? i + 2; continue; }
      if (next && '&%$#_{}'.includes(next)) { out += next; i += 2; continue; }
      if ((next && ' ,;:!/@-'.includes(next)) || next === '\n') { out += next === '-' || next === '/' ? '' : ' '; i += 2; continue; }
      const name = /^[a-zA-Z]+\*?/.exec(tex.slice(i + 1))?.[0];
      if (!name) { i++; continue; }
      i += 1 + name.length;
      const bare = name.replace(/\*$/, '');
      if (bare in SYMBOLS) out += SYMBOLS[bare];
      else if (bare in DROP) i = groups(tex, i, DROP[bare]).end;
      else if (bare === 'begin' || bare === 'end') {
        const env = group(tex, i);
        if (env) { i = env.end; if (bare === 'begin') i = groups(tex, i, ENV_ARGS[env.inside.trim()] ?? 0).end; }
      } else if (bare === 'href') { const { args, end } = groups(tex, i, 2); out += toText(args[1] ?? args[0] ?? '', unknown, math); i = end; }
      else if (bare === 'url') { const { args, end } = groups(tex, i, 1); out += args[0] ?? ''; i = end; }
      else if (bare === 'textcolor' || bare === 'colorbox' || bare === 'raisebox') { const { args, end } = groups(tex, i, 2); out += toText(args[1] ?? '', unknown, math); i = end; }
      else if (!FORMAT.has(bare)) unknown.add('\\' + bare); // its arguments follow as ordinary text
    } else if (ch === '$') {
      // Math: $...$ or $$...$$, read with the same rules, its ^ and _ dropped ($\sim$ is ~, $|$ is |).
      const fence = tex.startsWith('$$', i) ? '$$' : '$';
      let end = i + fence.length;
      while (end < tex.length && !tex.startsWith(fence, end)) end += tex[end] === '\\' ? 2 : 1;
      out += toText(tex.slice(i + fence.length, end), unknown, true);
      i = end + fence.length;
    } else if (ch === '{' || ch === '}' || (math && (ch === '^' || ch === '_'))) i++;
    else if (ch === '~') { out += ' '; i++; }
    else if (ch === '&') { out += '\t'; i++; }
    else if (ch === '\n' || ch === '\r') { out += ' '; i++; }
    else if (!math && tex.startsWith('---', i)) { out += '\u2014'; i += 3; }
    else if (!math && tex.startsWith('--', i)) { out += '\u2013'; i += 2; }
    else if (tex.startsWith('``', i) || tex.startsWith("''", i)) { out += '"'; i += 2; }
    else { out += ch; i++; }
  }
  return out.replace(/[ \u00a0]+/g, ' ').replace(/ *([\n\t]) */g, '$1');
}
// One line of text: breaks and column gaps become spaces.
const flat = (text: string) => text.replace(/[\n\t]+/g, ' ').replace(/ +/g, ' ').trim();

// ---------------------------------------------------------------- the resume's parts

// A date: a year, or Present / Current / Now / Expected. "Georgetown, TX" is not one.
const isDate = (text: string) => /\b(19|20)\d{2}\b|\b(present|current|now|expected)\b/i.test(text);
const blank = (): ResumeEntry => ({ id: uid(), title: '', subtitle: '', date: '', location: '', bullets: [] });

// Which part of the resume a \section heading is. Leadership, activities and volunteering are experience
// in all but name; a heading matching none (Awards, Summary) is null and is reported, not guessed at.
function kindOf(heading: string): SectionKind | null {
  const h = heading.toLowerCase();
  if (/skill|technolog|tools|languages|competenc/.test(h)) return 'skills';
  if (/project/.test(h)) return 'projects';
  if (/educat|academic|school/.test(h)) return 'education';
  if (/experience|employment|work|internship|leadership|activit|volunteer|involvement|research|positions/.test(h)) return 'experience';
  return null;
}

// The two right-hand columns of an entry go to date and location: whichever one looks like a date is
// the date. When neither or both do, Jake's positions decide: experience has the date on the first
// line and the place on the second, education the other way round.
function placeColumns(entry: ResumeEntry, first: string, second: string, kind: SectionKind) {
  const [date, location] = isDate(first) !== isDate(second) ? (isDate(first) ? [first, second] : [second, first]) : kind === 'education' ? [second, first] : [first, second];
  entry.date = date; entry.location = location;
}

// An entry written as lines of text rather than a template command: "\textbf{Acme} \hfill 2025 \\
// \textit{Intern} \hfill Remote". The first line is the title and a right-hand column, the second the
// subtitle and another; further lines are bullets. One line with "Title | subtitle" is split at the bar.
function entryFromLines(text: string, kind: SectionKind): ResumeEntry | null {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.replace(/\t/g, '').trim());
  if (!lines.length) return null;
  const entry = blank();
  const [title, ...right1] = lines[0].split('\t').map(flat);
  const [subtitle = '', ...right2] = (lines[1] ?? '').split('\t').map(flat);
  entry.title = title; entry.subtitle = subtitle;
  if (lines.length === 1 && title.includes(' | ')) [entry.title, entry.subtitle] = [title.slice(0, title.indexOf(' | ')), title.slice(title.indexOf(' | ') + 3)];
  placeColumns(entry, right1.filter(Boolean).join(' '), right2.filter(Boolean).join(' '), kind);
  entry.bullets = lines.slice(2).map(flat).filter(Boolean);
  return entry;
}

// The header: the name, then the contact line, split at | and bullets and column gaps. A piece that is
// an \href keeps its address beside its text, so a mailto: is known for an email even when its text is not.
function readHeader(src: string, resume: Resume, unknown: Set<string>) {
  const hrefs: string[] = [];
  // Each \href becomes a marker holding its number, so it survives toText and is found again after the split.
  const marked = src.replace(/\\href\s*\{([^{}]*)\}/g, (_, url: string) => { hrefs.push(url); return `\\url{\u0001${hrefs.length - 1}\u0002}`; });
  const lines = toText(marked, unknown).split('\n').map(line => line.split(/[|\u2022\u00b7\u22c4\t]/).map(flat).filter(Boolean)).filter(line => line.length);
  const pieces = lines.flat().map(piece => {
    // \href{url}{text} was read as \url{marker} followed by its text group; the text wins when there is one.
    const at = /\u0001(\d+)\u0002/.exec(piece);
    const url = at ? hrefs[Number(at[1])] : '';
    const text = flat(piece.replace(/\u0001\d+\u0002/g, '')) || url.replace(/^(mailto:|tel:|https?:\/\/)/, '').replace(/\/$/, '');
    const kind = url.startsWith('mailto:') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? 'email'
      : url.startsWith('tel:') || (/^\+?[\d\s().-]+$/.test(text) && text.replace(/\D/g, '').length >= 7) ? 'phone'
      : url || /^(https?:\/\/|www\.)|\w\.(com|org|net|io|dev|edu|me|ai|co)\b|linkedin|github/i.test(text) ? 'link' : 'text';
    // An email link whose text is a word ("Email") gives its address instead.
    return { kind, text: kind === 'email' && !text.includes('@') ? url.slice('mailto:'.length) : text };
  }).filter(piece => piece.text);
  // The name is the first line's first piece, unless that is already contact (a header with no name).
  if (pieces[0]?.kind === 'text' && lines[0].length === 1) resume.profile.name = pieces.shift()!.text;
  for (const { kind, text } of pieces) {
    if (kind === 'email') resume.profile.email ||= text;
    else if (kind === 'phone') resume.profile.phone ||= text;
    else if (kind === 'text' && !resume.profile.location) resume.profile.location = text;
    else resume.profile.links.push(text);
  }
}

// Where a section's lists and headings are found. \resumeSubHeadingListStart and \resumeItemListStart are
// Jake's names for \begin{itemize}; they nest the same way.
const STRUCTURE = /\\(resumeSubheading|resumeSubSubheading|resumeProjectHeading|resumeItem|resumeSubItem|resumeSubHeadingListStart|resumeSubHeadingListEnd|resumeItemListStart|resumeItemListEnd|item|begin\s*\{(?:itemize|enumerate|description)\}|end\s*\{(?:itemize|enumerate|description)\})(?![a-zA-Z])/g;

// One section's body into entries (or, for skills, lines), in the order written.
function readSection(src: string, kind: SectionKind, entries: ResumeEntry[], skills: string[], unknown: Set<string>) {
  const text = (raw: string) => toText(raw, unknown);
  let depth = 0;           // how many lists are open
  let entryDepth = -1;     // the list depth the current entry was made at; items deeper are its bullets
  // Set inside the helpers below; the casts keep TypeScript from reading them as always null out here.
  let entry = null as ResumeEntry | null;
  let item = null as { raw: string; depth: number } | null;
  const addSkills = (raw: string) => skills.push(...text(raw).split('\n').map(flat).filter(Boolean));
  const start = (made: ResumeEntry | null, at: number) => { if (made) { entries.push(made); entry = made; entryDepth = at; } };
  const bullet = (line: string) => {
    if (!line) return;
    if (kind === 'skills') skills.push(line);
    else if (entry) entry.bullets.push(line);
    else start({ ...blank(), title: line }, depth);
  };
  // Loose text, or a finished \item: a skills line, a bullet under the entry above, or a new entry.
  const settle = (raw: string, at: number) => {
    if (kind === 'skills') addSkills(raw);
    else if (entry && at > entryDepth) bullet(flat(text(raw)));
    else start(entryFromLines(text(raw), kind), at);
  };
  const finishItem = () => { if (item) { settle(item.raw, item.depth); item = null; } };

  let at = 0;
  STRUCTURE.lastIndex = 0;
  for (let match = STRUCTURE.exec(src); ; match = STRUCTURE.exec(src)) {
    const between = src.slice(at, match ? match.index : src.length);
    if (item) item.raw += between;
    else if (flat(text(between))) settle(between, depth);
    if (!match) break;
    const command = match[1];
    let end = match.index + match[0].length;
    if (command !== 'item') finishItem();
    if (command === 'resumeSubheading') {
      const { args, end: after } = groups(src, end, 4);
      const [t1, r1, t2, r2] = [0, 1, 2, 3].map(n => flat(text(args[n] ?? '')));
      const made = blank();
      // Jake's experience entries lead with the role and put the company second; education leads with the school.
      [made.title, made.subtitle] = kind === 'experience' ? [t2, t1] : [t1, t2];
      placeColumns(made, r1, r2, kind);
      start(made, depth);
      end = after;
    } else if (command === 'resumeSubSubheading') {
      // A second role at the company above: the same title, its own role and dates.
      const { args, end: after } = groups(src, end, 2);
      const made: ResumeEntry = { ...blank(), title: entry?.title ?? '', subtitle: flat(text(args[0] ?? '')) };
      placeColumns(made, flat(text(args[1] ?? '')), '', kind);
      start(made, depth);
      end = after;
    } else if (command === 'resumeProjectHeading') {
      // {\textbf{Name} $|$ \emph{Tech}}{Date}: the name and the tech either side of the first bar.
      const { args, end: after } = groups(src, end, 2);
      const head = flat(text(args[0] ?? ''));
      const bar = head.indexOf('|');
      const made: ResumeEntry = { ...blank(), title: (bar < 0 ? head : head.slice(0, bar)).trim(), subtitle: bar < 0 ? '' : head.slice(bar + 1).trim() };
      placeColumns(made, flat(text(args[1] ?? '')), '', kind);
      start(made, depth);
      end = after;
    } else if (command === 'resumeItem' || command === 'resumeSubItem') {
      // One argument in Jake's template; an older version has two, a label and its text.
      const { args, end: after } = groups(src, end, 1);
      end = after;
      let line = flat(text(args[0] ?? ''));
      if (/^\s*\{/.test(src.slice(end))) { const second = group(src, end)!; line = `${line.replace(/:$/, '')}: ${flat(text(second.inside))}`; end = second.end; }
      bullet(line);
    } else if (command === 'item') {
      finishItem();
      // \item[Languages] in a description list is a label for the text after it.
      const label = option(src, end);
      if (label) end = label.end;
      item = { raw: label ? `${label.inside}: ` : '', depth };
    } else if (/Start$|^begin/.test(command)) { depth++; end = option(src, end)?.end ?? end; }
    else depth = Math.max(0, depth - 1);
    at = end;
    STRUCTURE.lastIndex = end;
  }
  finishItem();
}

// A resume from a .tex file, and what could not be read.
export function parseLatexResume(source: string): LatexImport {
  const resume: Resume = { profile: { name: '', email: '', phone: '', location: '', links: [] }, education: [], experience: [], projects: [], skills: [] };
  const unread: string[] = [];
  const unknown = new Set<string>();
  // Comments go first: a % that is not \% ends the line's text.
  let body = source.replace(/\r\n?/g, '\n').replace(/(^|[^\\])%.*$/gm, '$1');
  const begin = body.indexOf('\\begin{document}');
  if (begin >= 0) body = body.slice(begin + '\\begin{document}'.length);
  const finish = body.indexOf('\\end{document}');
  if (finish >= 0) body = body.slice(0, finish);

  // The sections, found by \section{..} (starred too); the header is everything before the first.
  const heads = [...body.matchAll(/\\section\*?\s*(?=\{)/g)].map(match => {
    const heading = group(body, match.index! + match[0].length)!;
    return { at: match.index!, bodyAt: heading.end, name: flat(toText(heading.inside, unknown)) };
  });
  readHeader(heads.length ? body.slice(0, heads[0].at) : body, resume, unknown);
  if (!heads.length) unread.push('No \\section headings were found, so only the name and contact line were read.');
  heads.forEach((head, n) => {
    const src = body.slice(head.bodyAt, heads[n + 1]?.at ?? body.length);
    const kind = kindOf(head.name);
    if (kind) { readSection(src, kind, kind === 'skills' ? [] : resume[kind], resume.skills, unknown); return; }
    const words = flat(toText(src, unknown));
    unread.push(`The ${head.name || 'untitled'} section has no place in this resume, so it was left out${words ? `: "${words.length > 120 ? words.slice(0, 117) + '...' : words}"` : ''}.`);
  });
  if (unknown.size) unread.push(`Commands this reader does not know, kept as their text: ${[...unknown].sort().join(', ')}.`);
  return { resume, unread };
}

// ---------------------------------------------------------------- writing LaTeX

// Text into LaTeX: the ten special characters escaped, and the en and em dashes back to -- and ---.
// The backslash goes first, so the braces its replacement adds are not escaped again.
export const escapeLatex = (text: string) => text
  .replace(/\\/g, '\u0000').replace(/[&%$#_{}]/g, '\\$&').replace(/\u0000/g, '\\textbackslash{}')
  .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}').replace(/</g, '\\textless{}').replace(/>/g, '\\textgreater{}')
  .replace(/\|/g, '\\textbar{}').replace(/\u2014/g, '---').replace(/\u2013/g, '--');
// An address for \href: an email gets mailto:, a bare domain gets https://. % and # are escaped, the two
// characters hyperref needs escaped inside a URL.
const hrefOf = (text: string) => (/^[^\s@]+@[^\s@]+$/.test(text) ? 'mailto:' + text : /^[a-z]+:\/\//i.test(text) ? text : 'https://' + text).replace(/[%#]/g, '\\$&');
const looksLinked = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || /^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text);
const linked = (text: string) => `\\href{${hrefOf(text)}}{\\underline{${escapeLatex(text)}}}`;
const shown = (items: string[]) => items.map(item => item.trim()).filter(Boolean);

// The preamble: US letter, half-inch margins, small caps section titles over a rule, and the commands
// the body uses. The command names and their arguments follow Jake Gutierrez's resume template (MIT), so
// the file reads the way students' Overleaf copies do; the definitions are written here.
const PREAMBLE = String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}

\pagestyle{empty}
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-0.5in}
\addtolength{\textheight}{1in}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}
\urlstyle{same}

\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\titlerule\vspace{-5pt}]

% An entry: title and right column, then subtitle and right column, in italics.
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
  \begin{tabular*}{\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small #3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-7pt}
}
% A project: one line, the name and its tech on the left, the date on the right.
\newcommand{\resumeProjectHeading}[2]{
  \item
  \begin{tabular*}{\textwidth}{l@{\extracolsep{\fill}}r}
    \small #1 & #2 \\
  \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
`;

function entryBlock(entry: ResumeEntry, heading: string): string {
  const bullets = shown(entry.bullets);
  const items = bullets.length ? `\n      \\resumeItemListStart\n${bullets.map(b => `        \\resumeItem{${escapeLatex(b)}}`).join('\n')}\n      \\resumeItemListEnd` : '';
  return `    ${heading}${items}`;
}

// The resume as a .tex file, Jake-style. Empty sections are left out. Experience is written the way
// Jake's template orders it (role, dates, company, place) and education school first, which is the order
// parseLatexResume reads back, so an export imports again unchanged. A project's location has no column
// in Jake's project line and is not written.
export function resumeToLatex(resume: Resume): string {
  const { profile } = resume;
  const has = (entry: ResumeEntry) => shown([entry.title, entry.subtitle, entry.date, entry.location, ...entry.bullets]).length > 0;
  const contact = shown([profile.email, profile.phone, profile.location, ...profile.links])
    .map(item => looksLinked(item) ? linked(item) : escapeLatex(item));
  const parts = [PREAMBLE, '\\begin{document}', '', '\\begin{center}'];
  if (profile.name.trim()) parts.push(`  {\\Huge \\scshape ${escapeLatex(profile.name.trim())}} \\\\ \\vspace{1pt}`);
  if (contact.length) parts.push(`  \\small ${contact.join(' $|$ ')}`);
  parts.push('\\end{center}');
  const section = (title: string, entries: ResumeEntry[], heading: (entry: ResumeEntry) => string) => {
    const kept = entries.filter(has);
    if (kept.length) parts.push('', `\\section{${title}}`, '  \\resumeSubHeadingListStart', ...kept.map(entry => entryBlock(entry, heading(entry))), '  \\resumeSubHeadingListEnd');
  };
  const e = (text: string) => escapeLatex(text.trim());
  section('Education', resume.education, entry => `\\resumeSubheading\n      {${e(entry.title)}}{${e(entry.location)}}\n      {${e(entry.subtitle)}}{${e(entry.date)}}`);
  section('Experience', resume.experience, entry => `\\resumeSubheading\n      {${e(entry.subtitle)}}{${e(entry.date)}}\n      {${e(entry.title)}}{${e(entry.location)}}`);
  section('Projects', resume.projects, entry => `\\resumeProjectHeading\n      {\\textbf{${e(entry.title)}}${entry.subtitle.trim() ? ` $|$ \\emph{${e(entry.subtitle)}}` : ''}}{${e(entry.date)}}`);
  const skills = shown(resume.skills);
  if (skills.length) {
    // "Languages: Python, Java" becomes a bold label and its list, the way Jake's skills block reads.
    const line = (skill: string) => { const colon = skill.indexOf(':'); return colon > 0 ? `\\textbf{${escapeLatex(skill.slice(0, colon).trim())}}{: ${escapeLatex(skill.slice(colon + 1).trim())}}` : escapeLatex(skill); };
    parts.push('', '\\section{Technical Skills}', ' \\begin{itemize}[leftmargin=0.15in, label={}]', '    \\small{\\item{', skills.map(skill => `     ${line(skill)}`).join(' \\\\\n'), '    }}', ' \\end{itemize}');
  }
  parts.push('', '\\end{document}', '');
  return parts.join('\n');
}
