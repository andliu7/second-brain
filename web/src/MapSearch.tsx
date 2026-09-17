// The map's files inside the Ctrl+K search, so a file on this computer is two actions from the
// front door: Ctrl+K, type, Enter. Same ranking as the Network tree's filter (searchNodes) on the
// same one build (loadGraph), so Enter here opens what Enter there would. Picking one navigates
// to #network/<id>, which the Network page selects in its tree, map and viewer; a pick with Ctrl
// held (Ctrl+Enter, or a Ctrl-click) also opens the file on this computer, one explicit action.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { buildModel, colorOf, loadGraph, searchNodes, type Model } from './lib/network';
import { KindIcon, kindLabel } from './FileViewer';
import './network.css'; // .search-kind and .search-note; Vite loads a stylesheet once however many files import it

type Props = { query: string; onPick: (id: string, name: string, openOnDevice: boolean) => void; onCount: (count: number) => void };
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
    return <button className="search-result" key={node.id} title="Enter opens it in Network. Ctrl+Enter also opens it on this computer." onClick={event => onPick(node.id, node.name, event.ctrlKey || event.metaKey)}><span className="search-kind" style={{ color: colorOf(node) }}><KindIcon node={node} size={18}/></span><span><strong>{node.name}</strong><small>{kindLabel(node)}{folder ? ` · ${folder}` : root ? ` · ${root.split('/').slice(-2).join('/')}` : ''}</small></span><ArrowUpRight size={15}/></button>;
  })}</>;
}
