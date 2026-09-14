// A small Markdown renderer: headings, bullets (nested too), numbered lines, paragraphs, > quotes,
// --- rules, fenced code, | tables |, and inline `code`, **bold**, *italic* and links. Shared by
// Chat, the file preview and the Skills page, which is why it lives in its own file.
import type { ReactNode } from 'react';
import './markdown.css';

// An HTML entity in prose (a table cell reading `CLS &lt; 0.1`) shows as its character. Inside a
// `code` span it stays literal, as on GitHub. An entity not in this list is left as written.
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };
const entities = (text: string) => text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) =>
  name[0] !== '#' ? NAMED[name] ?? whole : String.fromCodePoint(/x/i.test(name[1]) ? parseInt(name.slice(2), 16) : Number(name.slice(1))));

// In a table cell, a word the browser may split at a hyphen, dash, slash or pipe
// ("reduced-motion", "Twitter/X") is kept on one line: a narrow table scrolls sideways instead of
// breaking a name in two. Words without those break the usual way, and so does Chinese or
// Japanese text, which breaks between characters. A `code` chip is kept whole by CSS
// (.markdown td code in markdown.css).
const KEEP = /[-\u2010-\u2015/|]/; // hyphen, the Unicode dashes, slash, pipe
const words = (text: string): ReactNode[] => text.split(/(\S+)/).map((part, i) => i % 2 && KEEP.test(part) ? <span key={i} className="nowrap">{part}</span> : part);

// `code` becomes a mono chip, **bold** <strong>, *italic* <em>, and [text](https://...) a link that
// opens in a new tab. split() with a capture group keeps the matches, at the odd indexes, so the
// text between them stays plain. Bold and italic text go through inline() again, because skills
// write **`code in bold`**. An image shows as its alt text (a README badge is a link around an
// image), and a relative link as its text, since its path means nothing inside this app.
// `cell` is true inside a table, where words() keeps split-prone words whole.
function inline(text: string, cell = false): ReactNode[] {
  const plain = cell ? words : (part: string) => part;
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^\s*](?:[^*]*[^\s*])?\*|\[[^\]]+\]\([^)\s]+\))/).map((part, i) => {
    if (i % 2 === 0) return plain(entities(part));
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>; // in a table, CSS keeps a code chip on one line
    if (part.startsWith('**')) return <strong key={i}>{inline(part.slice(2, -2), cell)}</strong>;
    if (part.startsWith('*')) return <em key={i}>{inline(part.slice(1, -1), cell)}</em>;
    const [, label, href] = /^\[(.*)\]\((.*)\)$/.exec(part)!;
    return /^https?:\/\//.test(href) ? <a key={i} href={href} target="_blank" rel="noreferrer">{label}</a> : label;
  });
}

// Splits a | table | row into its cells. A pipe written as \| or inside a `code span` is text,
// not a cell border, so `a\|b` stays one cell and shows as a|b.
function cells(line: string): string[] {
  const out = [''];
  let code = false;
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') { out[out.length - 1] += '|'; i++; }
    else if (row[i] === '|' && !code) out.push('');
    else { if (row[i] === '`') code = !code; out[out.length - 1] += row[i]; }
  }
  return out.map(cell => cell.trim());
}

// The first row is the header. Every row shows all its cells, even past the header's count. A
// column whose body cells all start with a digit, ~ or $ holds figures (a cost, a count) and is
// right-aligned so the numbers line up.
function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  const columns = [...Array(Math.max(...rows.map(row => row.length))).keys()];
  const figures = columns.map(c => body.length > 0 && body.every(row => /^[~$\d]/.test(row[c] ?? '')));
  const cell = (c: number) => figures[c] ? 'num' : undefined;
  return <div className="markdown-table"><table>
    <thead><tr>{columns.map(c => <th key={c} className={cell(c)}>{inline(head[c] ?? '', true)}</th>)}</tr></thead>
    <tbody>{body.map((row, r) => <tr key={r}>{columns.map(c => <td key={c} className={cell(c)}>{inline(row[c] ?? '', true)}</td>)}</tr>)}</tbody>
  </table></div>;
}

// Reads the text a line at a time. Each line of prose is its own paragraph, because a note or a chat
// message is typed with single line breaks that mean a new line. With `join` (the Skills page),
// consecutive lines join into one paragraph, as in any Markdown reader, because skill files
// hard-wrap their prose at about 80 characters; a bullet or a numbered line then starts a new
// paragraph and indented text under it continues it. Quoted lines are collected without their `> `
// and rendered by this same function, so a quote can hold bullets.
function blocks(content: string, join: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let code: string[] | null = null;   // lines inside an open ``` fence
  let table: string[][] | null = null; // cells of the | rows | read so far
  let quote: string[] | null = null;   // lines of an open > quote, without the >
  let para: { text: string; bullet: boolean; depth: number; task?: string } | null = null; // the paragraph being joined; task is ' ' or 'x' on a - [ ] line
  const end = () => {
    if (table) out.push(<Table key={out.length} rows={table}/>);
    if (quote) out.push(<blockquote key={out.length}>{blocks(quote.join('\n'), join)}</blockquote>);
    if (para) out.push(<p key={out.length} className={para.task ? 'markdown-task' + (para.task === 'x' ? ' done' : '') : para.bullet ? 'markdown-bullet' : undefined} style={para.depth ? { marginLeft: para.depth * 18 } : undefined}>{inline(para.text)}</p>);
    table = quote = para = null;
  };
  for (const line of content.split('\n')) {
    const fence = line.trimStart().startsWith('```');
    if (code) { if (fence) { out.push(<pre key={out.length}>{code.join('\n')}</pre>); code = null; } else code.push(line); continue; }
    if (fence) { end(); code = []; continue; }
    if (/^\s*>/.test(line)) { if (!quote) end(); (quote ??= []).push(line.replace(/^\s*>\s?/, '')); continue; }
    if (line.trimStart().startsWith('|')) {
      if (!table) end();
      const row = cells(line);
      if (!row.every(cell => /^:?-+:?$/.test(cell))) (table ??= []).push(row); // skip the |---|---| line
      continue;
    }
    if (table || quote) end();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line); // a bullet or a numbered line
    const depth = item ? Math.min(2, Math.round(item[1].length / 3)) : 0; // two to four spaces of indent per level
    if (!line.trim()) { end(); out.push(<div className="paragraph-gap" key={out.length}/>); }
    else if (heading) { end(); const Tag = (['h2', 'h3', 'h4'] as const)[heading[1].length - 1] ?? 'h5'; out.push(<Tag key={out.length}>{inline(heading[2])}</Tag>); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { end(); out.push(<hr key={out.length}/>); }
    else if (item) { end(); const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]); para = /\d/.test(item[2]) ? { text: item[2].trim() + ' ' + item[3], bullet: false, depth } : task ? { text: task[2], bullet: true, depth, task: task[1].toLowerCase() } : { text: item[3], bullet: true, depth }; }
    else if (para && join) para.text += ' ' + line.trim(); // a wrapped line continues the paragraph or bullet above it
    else { end(); para = { text: line.trim(), bullet: false, depth: 0 }; }
  }
  end();
  if (code) out.push(<pre key="unclosed">{code.join('\n')}</pre>); // a fence left open runs to the end
  return out;
}

export function Markdown({ content, joinLines = false }: { content: string; joinLines?: boolean }) {
  return <div className="markdown">{blocks(content, joinLines)}</div>;
}
