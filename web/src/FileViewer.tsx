// The viewer: the selected node readable inside the app. Markdown through the site's Markdown
// component, code and text in monospace with line numbers, images whole, PDFs on their first
// page, anything else as its metadata plus Open on device. The server reads at most 8 KB for
// the summary; the rest of a text file arrives in 64 KB chunks through Load more.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, File, FileCode2, FileText, FolderOpen, Folder, Globe, Image, Layers3, Loader2, Plug, Clock3, Brain, Zap, FileType2 } from 'lucide-react';
import { Markdown } from './Markdown';
import { api } from './lib/api';
import { copyText } from './lib/clipboard';
import { bytes, colorOf, type GraphNode, type Model } from './lib/network';

export type Linked = { id: string; name: string; kind: string; layer: string; type?: string };
export type NodeDetail = { id: string; name: string; kind: string; layer: string; path: string | null; root: string | null; size: number; mtime: number; summary: { title?: string; description?: string }; excerpt: string | null; next: number | null; linksIn: Linked[]; linksOut: Linked[]; children: Linked[]; group: string | null; where: string | null; file?: string };

export function KindIcon({ node, size = 16 }: { node: Pick<GraphNode, 'kind' | 'layer'>; size?: number }) {
  const Icon = node.kind === 'dept' ? Layers3 : node.kind === 'app' ? Plug : node.kind === 'skill' ? Zap : node.layer === 'routine' ? Clock3 : node.layer === 'memory' ? Brain : node.kind === 'folder' ? Folder : node.kind === 'note' ? FileText : node.kind === 'code' ? FileCode2 : node.kind === 'image' ? Image : node.kind === 'pdf' ? FileType2 : node.kind === 'html' ? Globe : File;
  return <Icon size={size}/>;
}
const KIND_LABEL: Record<string, string> = { dept: 'Department', app: 'Application', skill: 'Skill', folder: 'Folder', note: 'Markdown', code: 'Code', text: 'Text', image: 'Image', pdf: 'PDF', html: 'HTML', file: 'File' };
export const kindLabel = (node: Pick<GraphNode, 'kind' | 'layer'>) => node.layer === 'routine' ? 'Routine' : node.layer === 'memory' ? 'Memory' : KIND_LABEL[node.kind] || 'File';
const describe = (detail: NodeDetail) => `${kindLabel(detail)}${detail.group ? ` · ${detail.group}` : ''}${detail.size ? ` · ${bytes(detail.size)}` : ''}${detail.mtime ? ` · ${new Date(detail.mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`;
// A note's frontmatter is read into the summary card; the rendered body starts after it.
const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

function CodeView({ text }: { text: string }) {
  const lines = text.split('\n'); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return <pre className="code-view"><code>{lines.map((line, i) => <span key={i} className="code-line"><span className="code-number" aria-hidden="true">{i + 1}</span>{line}{'\n'}</span>)}</code></pre>;
}

type Props = { model: Model; index: number; detail: NodeDetail | null; loading: boolean; error: string; onSelect: (index: number) => void; notify: (text: string, error?: boolean) => void };
export function FileViewer({ model, index, detail, loading, error, onSelect, notify }: Props) {
  const [text, setText] = useState(''); const [next, setNext] = useState<number | null>(null); const [more, setMore] = useState(false); const [copied, setCopied] = useState(false); const [opening, setOpening] = useState('');
  const node = index >= 0 ? model.nodes[index] : null; const detailId = detail?.id;
  // Windows line endings become plain newlines: the Markdown component reads a heading to the end of its line.
  const lf = (value: string) => value.replace(/\r\n?/g, '\n');
  // The file on screen right now. A chunk read takes as long as the disk takes, and the reader can
  // pick another file while one is in flight; a chunk that comes back for a file no longer shown is
  // dropped, so one file's bytes never land inside another.
  const showing = useRef(detailId);
  useEffect(() => { showing.current = detailId; setText(lf(detail?.excerpt || '')); setNext(detail?.next ?? null); setMore(false); setCopied(false); }, [detailId, detail?.excerpt, detail?.next]);
  async function loadMore(offset: number) {
    if (!detail) return; const id = detail.id; setMore(true);
    try { const chunk = await api<{ text: string; next: number | null }>(`graph/text?id=${encodeURIComponent(id)}&offset=${offset}`); if (showing.current !== id) return; setText(t => t + lf(chunk.text)); setNext(chunk.next); }
    catch (error) { if (showing.current === id) notify(error instanceof Error ? error.message : 'Could not read more of this file', true); }
    finally { if (showing.current === id) setMore(false); }
  }
  // A skill reads whole: its SKILL.md keeps loading until the end (a few chunks at most).
  useEffect(() => { if (detail?.kind === 'skill' && next !== null && !more) void loadMore(next); }, [detail?.kind, next, more]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reading on past the end of a file also loads the next chunk: scrolling the viewer to its end,
  // or a wheel turned down there. Still one 64 KB request at a time, and only when asked for.
  const readOn = (target: EventTarget & HTMLElement, wheel = 0) => { if (next === null || more || detail?.kind === 'skill' || wheel < 0) return; if (target.scrollTop + target.clientHeight >= target.scrollHeight - 48) void loadMore(next); };
  async function open(reveal: boolean) {
    if (!detail) return; setOpening(reveal ? 'reveal' : 'open');
    try { const reply = await api<{ runnable?: boolean }>('graph/open', { id: detail.id, reveal }); notify(reply.runnable ? `${detail.name} is a script, so it was revealed in Explorer rather than run` : reveal ? `Revealed ${detail.name} in Explorer` : `Opened ${detail.name} on this computer`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not open the file', true); }
    finally { setOpening(''); }
  }
  async function copy() { if (!detail?.path) return; if (await copyText(detail.path)) { setCopied(true); notify('Path copied'); } else { notify('The clipboard is not available here. Select the path and copy it.', true); } }
  const pick = (link: Linked) => { const target = model.byId.get(link.id); if (target !== undefined) onSelect(target); };
  // Where a linked file lives, so two files with the same name (a DESIGN-TOKENS.md in two repos) read apart.
  const where = (link: Linked) => { const i = model.byId.get(link.id); if (i === undefined) return ''; const root = model.roots[model.nodes[i].root]?.path || ''; return model.paths[i] && root ? model.paths[i].slice(root.length + 1).split('/').slice(0, -1).join('/') : ''; };
  const links = (title: string, items: Linked[]) => <section className="viewer-links"><h3>{title} <span>{items.length}</span></h3>{items.length ? <ul>{items.map((item, i) => { const folder = where(item); return <li key={item.id + i}><button type="button" onClick={() => pick(item)} title={`${folder ? folder + '/' : ''}${item.name}${item.type ? ` (${item.type})` : ''}`}><span className="tree-icon" style={{ color: colorOf(item as GraphNode) }}><KindIcon node={item} size={13}/></span><span>{item.name}</span><small>{folder || kindLabel(item)}</small></button></li>; })}</ul> : <p className="muted">None found in the files.</p>}</section>;
  const frontmatter = FRONTMATTER.test(text); const left = detail && next !== null ? detail.size - next : 0;

  if (!node) return <aside className="file-viewer" aria-label="Viewer"><div className="viewer-empty"><Layers3 size={28}/><h2>Pick a file</h2><p>Click a node on the map or a row in the tree. Hover a node for a preview. Search reaches anything by name.</p></div></aside>;
  const file = detail?.file || detail?.path; const relative = detail?.root && detail.path ? detail.path.slice(detail.root.length + 1) : detail?.path;
  return <aside className="file-viewer" aria-label="Viewer" onScroll={event => readOn(event.currentTarget)} onWheel={event => readOn(event.currentTarget, event.deltaY)}>
    <header className="viewer-head">
      <span className="viewer-icon" style={{ color: colorOf(node) }}><KindIcon node={node} size={20}/></span>
      <div className="viewer-title"><h2>{node.name}</h2>{detail && <p className="muted">{describe(detail)}</p>}{relative && <p className="viewer-path" title={detail?.path || ''}>{relative}</p>}</div>
    </header>
    {detail?.path && <div className="viewer-actions">
      <button type="button" className="button small" onClick={() => void open(false)} disabled={opening !== ''}>{opening === 'open' ? <Loader2 className="spin" size={14}/> : <ExternalLink size={14}/>}Open on device</button>
      <button type="button" className="button small" onClick={() => void open(true)} disabled={opening !== ''}><FolderOpen size={14}/>Reveal in Explorer</button>
      <button type="button" className="button small" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>}Copy path</button>
    </div>}
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    {loading && !detail && <p className="viewer-note"><Loader2 className="spin" size={14}/>Reading…</p>}
    {detail && <div className="viewer-body">
      {/* The summary card only where the rendered body would not show it: a skill's or a note's frontmatter. */}
      {(detail.kind === 'note' || detail.kind === 'skill') && frontmatter && (detail.summary.title || detail.summary.description) && <div className="viewer-summary">{detail.summary.title && detail.summary.title !== node.name && <strong>{detail.summary.title}</strong>}{detail.summary.description && <p>{detail.summary.description}</p>}</div>}
      {detail.kind === 'app' && <dl className="viewer-facts"><div><dt>Configured in</dt><dd>{detail.where}</dd></div><div><dt>Kind</dt><dd>{detail.group}</dd></div></dl>}
      {detail.kind === 'image' && <img className="viewer-image" src={`/api/graph/file?id=${encodeURIComponent(detail.id)}`} alt={detail.name}/>}
      {detail.kind === 'pdf' && <><img className="viewer-image viewer-page" src={`/api/graph/preview?id=${encodeURIComponent(detail.id)}`} alt={`First page of ${detail.name}`}/><p className="muted">First page. Open on device for the whole document.</p></>}
      {(detail.kind === 'note' || detail.kind === 'skill') && text && <div className="viewer-markdown"><Markdown content={frontmatter ? text.replace(FRONTMATTER, '') : text} joinLines/></div>}
      {(detail.kind === 'code' || detail.kind === 'text' || detail.kind === 'html') && (text ? <CodeView text={text}/> : <p className="muted">This file is empty.</p>)}
      {next !== null && detail.kind !== 'skill' && <button type="button" className="button small viewer-more" onClick={() => void loadMore(next)} disabled={more}>{more ? <Loader2 className="spin" size={14}/> : null}Load more · {left <= 65536 ? `the last ${bytes(left)}` : `next 64 KB, ${bytes(left)} left`}</button>}
      {detail.kind === 'skill' && next !== null && <p className="viewer-note"><Loader2 className="spin" size={14}/>Reading the rest of SKILL.md…</p>}
      {detail.kind === 'file' && file && <p className="viewer-note">No preview for this kind of file. Open on device shows it in its own app.</p>}
      {/* The relations come before a folder's contents: what links here is the answer the map is
          asked for, and under a long Contains list it would sit below the fold. */}
      {links('Linked from', detail.linksIn)}
      {links(detail.kind === 'app' ? 'Used by' : 'Links to', detail.linksOut)}
      {(detail.kind === 'folder' || detail.kind === 'dept') && <section className="viewer-links"><h3>Contains <span>{detail.children.length}</span></h3><ul>{detail.children.slice(0, 400).map(child => <li key={child.id}><button type="button" onClick={() => pick(child)}><span className="tree-icon" style={{ color: colorOf(child as GraphNode) }}><KindIcon node={child} size={13}/></span><span>{child.name}</span></button></li>)}</ul>{detail.children.length > 400 && <p className="muted">And {detail.children.length - 400} more in the tree.</p>}</section>}
    </div>}
  </aside>;
}
