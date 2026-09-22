// The map's files inside the Ctrl+K search, so a file on this computer is two actions from the
// front door: Ctrl+K, type, Enter. Same ranking as the Network tree's filter (searchNodes) on the
// same one build (loadGraph), so Enter here opens what Enter there would. Picking one navigates
// to #network/<id>, which the Network page selects in its tree, map and viewer.
// Each row carries its own two actions beside the jump arrow, so opening a file on this computer
// is the same two actions as finding it, not one hop past it: Open on device (Ctrl+Enter, or the
// arrow-out button) and Reveal in Explorer (Shift+Enter, or the folder button). Both also select
// the file in Network, so the map and the viewer are where the file was opened from.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ExternalLink, FolderOpen } from 'lucide-react';
import { buildModel, colorOf, loadGraph, searchNodes, type Model } from './lib/network';
import { KindIcon, kindLabel } from './FileViewer';
import './network.css'; // .search-kind and .search-note; Vite loads a stylesheet once however many files import it

export type PickAction = '' | 'open' | 'reveal';
type Props = { query: string; onPick: (id: string, name: string, action: PickAction) => void; onCount: (count: number) => void };
export function MapSearch({ query, onPick, onCount }: Props) {
  const [model, setModel] = useState<Model | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; loadGraph().then(payload => { if (live) setModel(buildModel(payload)); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'The map is not available'); }); return () => { live = false; }; }, []);
  const hits = useMemo(() => model && query.trim() ? searchNodes(model, query, 8) : [], [model, query]);
  useEffect(() => { onCount(hits.length); }, [hits, onCount]);
  if (!query.trim()) return null;
  if (!model) return <p className="search-note">{error || 'Reading the map of this computer…'}</p>;
  return <>{hits.map(index => {
    const node = model.nodes[index]; const root = model.roots[node.root]?.path || '';
    const relative = model.paths[index] && root ? model.paths[index].slice(root.length + 1) : ''; const folder = relative.split('/').slice(0, -1).join('/');
    return <div className="search-row" key={node.id}>
      <button className="search-result" title="Enter opens it in Network" onClick={event => onPick(node.id, node.name, event.ctrlKey || event.metaKey ? 'open' : event.shiftKey ? 'reveal' : '')}><span className="search-kind" style={{ color: colorOf(node) }}><KindIcon node={node} size={18}/></span><span><strong>{node.name}</strong><small>{kindLabel(node)}{folder ? ` · ${folder}` : root ? ` · ${root.split('/').slice(-2).join('/')}` : ''}</small></span><ArrowUpRight size={15}/></button>
      <span className="search-row-actions">
        <button type="button" className="icon-button" aria-label={`Open ${node.name} on device`} title="Open on device · Ctrl+Enter" onClick={() => onPick(node.id, node.name, 'open')}><ExternalLink size={15}/></button>
        <button type="button" className="icon-button" aria-label={`Reveal ${node.name} in Explorer`} title="Reveal in Explorer · Shift+Enter" onClick={() => onPick(node.id, node.name, 'reveal')}><FolderOpen size={15}/></button>
      </span>
    </div>;
  })}</>;
}
