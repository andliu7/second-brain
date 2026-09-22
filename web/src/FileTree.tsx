// The file tree beside the map, like Obsidian's file explorer: departments at the top, folders
// that expand on demand (a collapsed folder's rows are never rendered, so the tree stays light
// with 13,000 files), a kind icon and a link count on each row, and the filter box that also
// drives the map's search. It shares one selection with the map and the viewer.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ancestors, colorOf, isFolder, searchNodes, type Model } from './lib/network';
import { KindIcon } from './FileViewer';

type Props = { model: Model; selected: number; onSelect: (index: number) => void; onHover: (index: number, x: number, y: number) => void; query: string; setQuery: (value: string) => void };

export function FileTree({ model, selected, onSelect, onHover, query, setQuery }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(model.tops));
  const [cursor, setCursor] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => searchNodes(model, query, 400), [model, query]);

  // The rows on screen. Without a filter: the expanded tree. With one: every match, the folders
  // above it, and the contents of a matched folder, so one typed word reaches a file inside it.
  const rows = useMemo(() => {
    const out: { index: number; depth: number }[] = [];
    if (!query.trim()) {
      const walk = (index: number, depth: number) => { out.push({ index, depth }); if (expanded.has(index)) for (const child of model.children[index]) walk(child, depth + 1); };
      for (const top of model.tops) walk(top, 0);
      return out;
    }
    const show = new Set<number>(); const open = new Set<number>();
    for (const m of matches) { show.add(m); for (const a of ancestors(model, m)) { show.add(a); open.add(a); } if (isFolder(model.nodes[m])) { open.add(m); for (const child of model.children[m].slice(0, 300)) show.add(child); } }
    const walk = (index: number, depth: number) => { if (!show.has(index)) return; out.push({ index, depth }); if (open.has(index)) for (const child of model.children[index]) walk(child, depth + 1); };
    for (const top of model.tops) walk(top, 0);
    return out;
  }, [model, expanded, query, matches]);

  // Typing is enough to reach a file: a moment after the query settles, its top match is selected,
  // so the map, the tree and the viewer all follow the box live and Enter is a confirmation rather
  // than the only way in. Only once per query, and never over a row the reader picked in the
  // meantime: a click during that moment wins and the query is left as it is.
  const auto = useRef(''); const chose = useRef('');
  useEffect(() => {
    const q = query.trim(); if (!q) { auto.current = ''; return; }
    if (auto.current === q || chose.current === q) return;
    const timer = setTimeout(() => { auto.current = q; if (chose.current !== q && matches[0] !== undefined) onSelect(matches[0]); }, 160);
    return () => clearTimeout(timer);
  }, [query, matches, onSelect]);

  // A node picked on the map or in the viewer is revealed here: its folders open and its row scrolls into view.
  useEffect(() => {
    if (selected < 0) return;
    setExpanded(prev => { const next = new Set(prev); for (const a of ancestors(model, selected)) next.add(a); return next; });
    setCursor(selected);
  }, [selected, model]);
  // The cursor row scrolls into view, and takes focus when a key moved the cursor there (the row
  // may only exist after this render, when Right expanded its folder). Every row is the same
  // height, so scrolling by whole rows keeps the top edge of the list on a row boundary: a row is
  // never sliced through the middle up there, whichever row was revealed.
  const wantFocus = useRef(false);
  useEffect(() => {
    if (cursor < 0) return;
    const box = list.current; const el = box?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    const at = rows.findIndex(r => r.index === cursor); const pitch = el?.offsetHeight || 0;
    if (box && el && at >= 0 && pitch) {
      const visible = Math.max(1, Math.floor(box.clientHeight / pitch)); const first = Math.round(box.scrollTop / pitch);
      box.scrollTop = (at < first ? at : at > first + visible - 1 ? at - visible + 1 : first) * pitch;
    } else el?.scrollIntoView({ block: 'nearest' });
    if (wantFocus.current && el) { wantFocus.current = false; el.focus(); }
  }, [cursor, rows]);

  const toggle = (index: number) => setExpanded(prev => { const next = new Set(prev); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  // A file the reader picked under this query wins: the top match does not pull the selection back.
  const pick = (index: number) => { chose.current = query.trim(); onSelect(index); };
  const focusRow = (index: number) => { wantFocus.current = true; setCursor(index); };
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = rows.findIndex(row => row.index === cursor); if (at < 0 && rows.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); focusRow(rows[0].index); return; }
    const row = rows[at]; if (!row) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); if (rows[at + 1]) focusRow(rows[at + 1].index); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (rows[at - 1]) focusRow(rows[at - 1].index); }
    else if (event.key === 'Home') { event.preventDefault(); focusRow(rows[0].index); }
    else if (event.key === 'End') { event.preventDefault(); focusRow(rows[rows.length - 1].index); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); if (!isFolder(model.nodes[row.index])) return; if (!expanded.has(row.index)) toggle(row.index); else if (model.children[row.index][0] !== undefined) focusRow(model.children[row.index][0]); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); if (isFolder(model.nodes[row.index]) && expanded.has(row.index)) toggle(row.index); else if (model.nodes[row.index].parent >= 0) focusRow(model.nodes[row.index].parent); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(row.index); }
  }

  return <aside className="file-tree" aria-label="Files">
    <label className="inline-search file-filter"><Search size={15}/><input aria-label="Search files" placeholder="Search files and folders" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches[0] !== undefined) { event.preventDefault(); pick(matches[0]); } if (event.key === 'ArrowDown' && rows.length) { event.preventDefault(); focusRow(rows[0].index); } }} autoFocus/></label>
    {/* Hovering a row previews it like hovering its node, and lights its neighbours on the map. */}
    <div className="tree-rows" role="tree" aria-label="File tree" ref={list} onKeyDown={onKey} onMouseLeave={() => onHover(-1, 0, 0)}>
      {rows.map(({ index, depth }) => { const node = model.nodes[index]; const folder = isFolder(node); const open = query.trim() ? true : expanded.has(index); const links = model.linksIn[index].length + model.linksOut[index].length;
        return <div key={index} role="treeitem" className={`tree-row ${selected === index ? 'selected' : ''}`} data-index={index} tabIndex={cursor === index || (cursor < 0 && index === rows[0].index) ? 0 : -1} aria-selected={selected === index} aria-expanded={folder ? open : undefined} aria-level={depth + 1} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => { setCursor(index); pick(index); }} onFocus={() => setCursor(index)} onMouseEnter={event => onHover(index, event.clientX, event.clientY)}>
          {folder ? <button type="button" className="tree-toggle" tabIndex={-1} aria-label={(open ? 'Collapse ' : 'Expand ') + node.name} onClick={event => { event.stopPropagation(); if (!query.trim()) toggle(index); }}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button> : <span className="tree-toggle"/>}
          <span className="tree-icon" style={{ color: colorOf(node) }}><KindIcon node={node} size={14}/></span>
          <span className="tree-name">{node.name}</span>
          {folder && node.kind !== 'dept' && <small className="tree-count">{model.count[index]}</small>}
          {node.kind === 'dept' && <small className="tree-count">{model.count[index]}</small>}
          {links > 0 && <small className="tree-links" title={`${links} links`}>{links}</small>}
        </div>; })}
      {query.trim() && !rows.length && <p className="tree-empty">Nothing named like that. Try a shorter word.</p>}
    </div>
  </aside>;
}
