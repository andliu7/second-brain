// Network: the whole workspace as a working map. Every file under the configured roots plus
// every installed skill (server/graph.mjs), as departments and the four ARMS layers, with edges
// only from real links read from the files. Three parts share one selection: the file tree
// (FileTree.tsx), the map (NetworkCanvas.tsx) and the viewer (FileViewer.tsx). The selection is
// also the hash, #network/<id>, so the Ctrl+K search (MapSearch.tsx) and a pasted link land on a
// file. Local only: /api/graph* returns 404 on a hosted deploy.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Focus, Layers3, Loader2, RefreshCw } from 'lucide-react';
import { api } from './lib/api';
import { buildModel, COLORS, LAYER_NAMES, layout, loadGraph, localScene, type GraphPayload, type Model } from './lib/network';
import { NetworkCanvas } from './NetworkCanvas';
import { FileTree } from './FileTree';
import { FileViewer, KindIcon, kindLabel, type NodeDetail } from './FileViewer';
import './network.css';

type Props = { notify: (text: string, error?: boolean) => void; path?: string };
const cache = new Map<string, NodeDetail>(); // node details by id, for the viewer and the hover card

export default function Network({ notify, path = '' }: Props) {
  const [payload, setPayload] = useState<GraphPayload | null>(null); const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(-1); const [hovered, setHovered] = useState(-1); const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [detail, setDetail] = useState<NodeDetail | null>(null); const [detailError, setDetailError] = useState(''); const [loading, setLoading] = useState(false);
  const [hoverDetail, setHoverDetail] = useState<NodeDetail | null>(null);
  const [local, setLocal] = useState(false); const [query, setQuery] = useState(''); const [focus, setFocus] = useState({ index: -1, seq: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const model: Model | null = useMemo(() => payload ? buildModel(payload) : null, [payload]);
  const full = useMemo(() => model ? layout(model) : null, [model]);
  const scene = useMemo(() => model && full ? (local && selected >= 0 ? localScene(model, selected) : full) : null, [model, full, local, selected]);
  // The scene changes only with a new build from disk or the local view, never with a selection,
  // so the camera keeps its place while you click around.
  const sceneKey = `${payload?.built || ''}:${local && selected >= 0 ? 'local:' + selected : 'all'}`;

  // loadGraph holds one request: StrictMode mounts twice in development, and a second build
  // would arrive later and reset the map under the first click. Rebuild asks for a fresh one.
  const load = useCallback(async (reload = false) => {
    setLoadError('');
    try { const reply = await loadGraph(reload); cache.clear(); setPayload(reply); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not build the map'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fetchDetail = useCallback(async (id: string) => { const hit = cache.get(id); if (hit) return hit; const reply = await api<NodeDetail>(`graph/node?id=${encodeURIComponent(id)}`); cache.set(id, reply); return reply; }, []);
  // The selected node's detail, read fresh for the viewer (the summary is at most the first 8 KB).
  // The old detail goes at once, so a new name never sits over the previous file's body while
  // the read is in flight: the viewer says Reading until this file's own detail arrives.
  useEffect(() => {
    setDetail(null);
    if (!model || selected < 0) return;
    const id = model.nodes[selected].id; let live = true; setLoading(true); setDetailError('');
    fetchDetail(id).then(reply => { if (live) setDetail(reply); }).catch(error => { if (live) { setDetail(null); setDetailError(error instanceof Error ? error.message : 'Could not read this node'); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [model, selected, fetchDetail]);
  // The hover card, a moment after the pointer settles on a node, never for every node on load.
  useEffect(() => {
    if (!model || hovered < 0) { setHoverDetail(null); return; }
    const id = model.nodes[hovered].id; let live = true;
    const timer = setTimeout(() => { fetchDetail(id).then(reply => { if (live) setHoverDetail(reply); }).catch(() => { if (live) setHoverDetail(null); }); }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [model, hovered, fetchDetail]);

  // One selection for the tree, the map and the viewer. The camera moves to the node, so a
  // tree row or a link in the viewer also finds it on the map; a pick outside the tree clears
  // its filter, so the row it reveals is never hidden by an old search.
  const select = useCallback((index: number, from: 'tree' | 'map' | 'viewer' = 'map') => { setSelected(index); if (index >= 0) setFocus(f => ({ index, seq: f.seq + 1 })); if (from !== 'tree') setQuery(''); }, []);
  const selectFromTree = useCallback((index: number) => select(index, 'tree'), [select]);
  const selectFromViewer = useCallback((index: number) => select(index, 'viewer'), [select]);
  const onHover = useCallback((index: number, x: number, y: number) => { setHovered(index); if (index >= 0) setPointer({ x, y }); }, []);
  // The selection and the hash agree both ways: a pick here writes #network/<id> (a link to this
  // file), and a hash from the Ctrl+K search or a pasted link selects its node once the map is up.
  // While a path from the hash is still waiting to be applied (the map just arrived), the hash
  // is left alone: writing #network first would push a bare entry between two of the file, and
  // Back would then need three presses to leave the page.
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const pathRef = useRef(path); pathRef.current = path; const applied = useRef('');
  useEffect(() => { if (!model || (pathRef.current && pathRef.current !== applied.current)) return; const id = selected >= 0 ? model.nodes[selected].id : ''; const want = id ? 'network/' + id : 'network'; if (location.hash.slice(1) !== want) location.hash = want; }, [model, selected]);
  useEffect(() => { if (!model || !path) return; applied.current = path; const index = model.byId.get(path); if (index !== undefined && index !== selectedRef.current) select(index, 'viewer'); }, [model, path, select]);

  if (loadError) return <><div className="page-heading"><div><h1>Network</h1></div></div><div className="error-banner" role="alert"><p>{loadError}</p><button className="button small" onClick={() => void load(true)}><RefreshCw size={14}/>Try again</button></div></>;
  if (!model || !scene) return <><div className="page-heading"><div><h1>Network</h1></div></div><div className="panel network-loading"><Loader2 className="spin" size={18}/><p>Reading every file under the configured roots…</p></div></>;
  const hoverNode = hovered >= 0 ? model.nodes[hovered] : null; const rect = stage.current?.getBoundingClientRect();
  // The card sits in the corner of the map diagonally opposite the pointer, so it never covers the
  // node or the neighbourhood lit around it (a hover from the tree, left of the map, counts as left).
  const cardStyle = rect ? (() => { const style: CSSProperties = {}; style[pointer.x - rect.left < rect.width / 2 ? 'right' : 'left'] = 12; style[pointer.y - rect.top < rect.height / 2 ? 'bottom' : 'top'] = 12; return style; })() : undefined;
  const hoverPath = hoverNode && model.paths[hovered] ? model.paths[hovered].slice((model.roots[hoverNode.root]?.path.length || -1) + 1) : '';
  return <div className="network-page">
    <div className="page-heading network-heading"><div><h1>Network</h1></div><div className="heading-actions">
      <div className="network-legend" aria-label="Layers">{Object.entries(LAYER_NAMES).map(([layer, name]) => <span key={layer}><i style={{ background: COLORS[layer] }}/>{name}</span>)}<span><i style={{ background: COLORS.folder }}/>Files by kind</span></div>
      <button type="button" className={`button small ${local ? 'primary' : ''}`} aria-pressed={local} disabled={selected < 0} title={selected < 0 ? 'Pick a node first' : ''} onClick={() => setLocal(v => !v)}><Focus size={14}/>{local ? 'Whole map' : 'Local graph'}</button>
      <button type="button" className="button small" onClick={() => void load(true)} aria-label="Rebuild the map from disk"><RefreshCw size={14}/></button>
    </div></div>
    <div className="network-body">
      <FileTree model={model} selected={selected} onSelect={selectFromTree} onHover={onHover} query={query} setQuery={setQuery}/>
      <div className="network-stage" ref={stage}>
        <NetworkCanvas model={model} scene={scene} selected={selected} hovered={hovered} onSelect={select} onHover={onHover} focus={focus} sceneKey={sceneKey}/>
        {selected < 0 && <p className="network-hint muted">Drag to pan, scroll to zoom, click a node to open it.</p>}
        {hoverNode && <div className="hover-card" style={cardStyle} role="tooltip">
          <div className="hover-head"><span style={{ color: COLORS[hoverNode.layer] || COLORS[hoverNode.kind] || COLORS.file }}><KindIcon node={hoverNode} size={14}/></span><strong>{hoverNode.name}</strong></div>
          <p className="hover-path">{hoverNode.kind === 'app' ? hoverNode.where : hoverNode.kind === 'dept' ? LAYER_NAMES[hoverNode.layer] || 'Department' : hoverPath && hoverPath !== hoverNode.name ? hoverPath : `${kindLabel(hoverNode)} in ${(model.roots[hoverNode.root]?.path || '').split('/').slice(-2).join('/')}`}</p>
          {hoverNode.kind === 'image' && <img className="hover-image" src={`/api/graph/file?id=${encodeURIComponent(hoverNode.id)}`} alt=""/>}
          {(hoverNode.kind === 'pdf' || hoverNode.kind === 'html') && <img className="hover-image" src={`/api/graph/preview?id=${encodeURIComponent(hoverNode.id)}`} alt=""/>}
          {hoverDetail && hoverDetail.id === hoverNode.id && <>
            {hoverNode.kind === 'skill' && <div className="hover-skill">{hoverDetail.summary.title && hoverDetail.summary.title !== hoverNode.name && <strong>{hoverDetail.summary.title}</strong>}<p>{hoverDetail.summary.description}</p></div>}
            {(hoverNode.kind === 'note' || hoverNode.kind === 'code' || hoverNode.kind === 'text') && hoverDetail.excerpt && <pre className="hover-lines">{hoverDetail.excerpt.split('\n').slice(0, 8).join('\n')}</pre>}
            {(hoverNode.kind === 'folder' || hoverNode.kind === 'dept') && <p className="muted">{model.count[hovered]} files · {hoverDetail.children.length} entries</p>}
            <p className="muted">{hoverDetail.linksIn.length} linked from · {hoverDetail.linksOut.length} links to</p>
          </>}
        </div>}
      </div>
      <FileViewer model={model} index={selected} detail={detail} loading={loading} error={detailError} onSelect={selectFromViewer} notify={notify}/>
    </div>
    <p className="network-foot muted"><Layers3 size={13}/>{model.roots.map(root => `${root.count.toLocaleString()} files in ${root.path.split('/').slice(-2).join('/')}`).join(' · ')} · {model.edges.length.toLocaleString()} links from the files · built {payload?.built ? new Date(payload.built).toLocaleTimeString() : 'now'}. Roots come from second-brain/graph-roots.json, on this computer only.</p>
  </div>;
}
