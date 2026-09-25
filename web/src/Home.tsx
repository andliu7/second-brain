// Home: the front door, the whole workspace as a globe. The grouped graph (/api/graph/grouped,
// server/graph.mjs groupGraph) is what turns on the canvas: images, code and files folded into
// one node per folder and kind, everything else individual. The full graph (loadGraph, shared
// with the Ctrl+K search) feeds the tree and the viewer in the side panel, so a grouped node
// still opens to the files inside it. The top bar and the sidebar collapse into the burger at
// the top left; the detail panel slides in over the right edge, 420 px wide, never the whole
// page, and Escape closes it and hands focus back to the globe.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FolderOpen, FolderTree, Loader2, Menu, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { api } from './lib/api';
import { buildModel, COLORS, colorOf, loadGraph, loadGrouped, SOURCES, sourceOf, type GraphNode, type GraphPayload } from './lib/network';
import { sphereLayout } from './lib/sphere';
import { SphereCanvas } from './SphereCanvas';
import { FileTree } from './FileTree';
import { FileViewer, KindIcon, kindLabel, type NodeDetail } from './FileViewer';
import './network.css';
import './home.css';

type Props = { notify: (text: string, error?: boolean) => void; openMenu: () => void; openSearch: () => void; newDoc: () => void };
type Panel = '' | 'file' | 'tree';
const cache = new Map<string, NodeDetail>();
const asGraph = (reply: GraphPayload) => { if (!Array.isArray(reply?.nodes) || !Array.isArray(reply?.edges)) throw new Error('The map did not arrive. Is the local server running?'); return reply; };

export default function Home({ notify, openMenu, openSearch, newDoc }: Props) {
  const [full, setFull] = useState<GraphPayload | null>(null); const [grouped, setGrouped] = useState<GraphPayload | null>(null); const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(''); const [hovered, setHovered] = useState(-1); const [panel, setPanel] = useState<Panel>(''); const [query, setQuery] = useState(''); const [focus, setFocus] = useState({ index: -1, seq: 0 });
  const [detail, setDetail] = useState<NodeDetail | null>(null); const [detailError, setDetailError] = useState(''); const [loading, setLoading] = useState(false); const [opening, setOpening] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const fullModel = useMemo(() => full ? buildModel(full) : null, [full]);
  const model = useMemo(() => grouped ? buildModel(grouped) : null, [grouped]);
  const layout = useMemo(() => model ? sphereLayout(model) : null, [model]);
  // A file folded into a group is found on the globe through its group.
  const memberOf = useMemo(() => { const map = new Map<string, number>(); model?.nodes.forEach((node, i) => node.members?.forEach(id => map.set(id, i))); return map; }, [model]);
  const counts = useMemo(() => { const out: Record<string, number> = {}; for (const node of full?.nodes || []) { if (node.kind === 'dept') continue; const key = sourceOf(node); out[key] = (out[key] || 0) + 1; } return out; }, [full]);

  const load = useCallback(async (reload = false) => {
    setLoadError('');
    try { const payload = asGraph(await loadGraph(reload)); cache.clear(); setFull(payload); setGrouped(asGraph(await loadGrouped(payload.signature))); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not build the map'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // One selection, by id, read three ways: where it sits on the globe (a folded file sits in its
  // group), which full-graph node the viewer shows, and whether it is a group with members.
  const sphereIndex = model ? (model.byId.get(selectedId) ?? memberOf.get(selectedId) ?? -1) : -1;
  const fullIndex = fullModel ? (fullModel.byId.get(selectedId) ?? -1) : -1;
  const groupNode = model && sphereIndex >= 0 && model.nodes[sphereIndex].id === selectedId && model.nodes[sphereIndex].members ? model.nodes[sphereIndex] : null;
  const select = useCallback((id: string, from: 'map' | 'tree' | 'viewer') => {
    setSelectedId(id);
    if (!id) { if (from === 'map') setPanel(''); return; }
    if (from !== 'tree') { setPanel('file'); setQuery(''); } // a pick in the tree keeps the tree open: typing there selects as it goes
    if (from !== 'map' && model) { const index = model.byId.get(id) ?? memberOf.get(id) ?? -1; if (index >= 0) setFocus(f => ({ index, seq: f.seq + 1 })); }
  }, [model, memberOf]);
  const selectFromMap = useCallback((index: number) => select(index >= 0 && model ? model.nodes[index].id : '', 'map'), [select, model]);
  const selectFromTree = useCallback((index: number) => { if (fullModel) select(fullModel.nodes[index].id, 'tree'); }, [select, fullModel]);
  const selectFromViewer = useCallback((index: number) => { if (fullModel) select(fullModel.nodes[index].id, 'viewer'); }, [select, fullModel]);
  const onHover = useCallback((index: number) => setHovered(index), []);
  const onTreeHover = useCallback((index: number) => { if (!fullModel || !model || index < 0) { setHovered(-1); return; } const id = fullModel.nodes[index].id; setHovered(model.byId.get(id) ?? memberOf.get(id) ?? -1); }, [fullModel, model, memberOf]);
  const close = useCallback(() => { setPanel(''); setSelectedId(''); stage.current?.querySelector<HTMLElement>('canvas')?.focus(); }, []);
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => { if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return; event.preventDefault(); close(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [panel, close]);

  // The selected file's detail for the viewer, as on the Network page: at most the first 8 KB.
  const fetchDetail = useCallback(async (id: string) => { const hit = cache.get(id); if (hit) return hit; const reply = await api<NodeDetail>(`graph/node?id=${encodeURIComponent(id)}`); cache.set(id, reply); return reply; }, []);
  useEffect(() => {
    setDetail(null);
    if (!fullModel || fullIndex < 0) return;
    const id = fullModel.nodes[fullIndex].id; let live = true; setLoading(true); setDetailError('');
    fetchDetail(id).then(reply => { if (live) setDetail(reply); }).catch(error => { if (live) { setDetail(null); setDetailError(error instanceof Error ? error.message : 'Could not read this node'); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [fullModel, fullIndex, fetchDetail]);

  async function open(node: GraphNode, reveal: boolean) {
    setOpening(node.id + (reveal ? ':reveal' : ':open'));
    try { const reply = await api<{ runnable?: boolean }>('graph/open', { id: node.id, reveal }); notify(reply.runnable ? `${node.name} is a script, so it was revealed in Explorer rather than run` : reveal ? `Revealed ${node.name} in Explorer` : `Opened ${node.name} on this computer`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not open the file', true); }
    finally { setOpening(''); }
  }
  const members = groupNode && fullModel ? groupNode.members!.map(id => fullModel.byId.get(id)).filter((i): i is number => i !== undefined) : [];
  const folderOf = (index: number) => { if (!fullModel) return ''; const root = fullModel.roots[fullModel.nodes[index].root]?.path || ''; return fullModel.paths[index] && root ? fullModel.paths[index].slice(root.length + 1).split('/').slice(0, -1).join('/') : ''; };

  return <div className="home" ref={stage}>
    {model && layout && <SphereCanvas model={model} layout={layout} selected={sphereIndex} hovered={hovered} onSelect={selectFromMap} onHover={onHover} focus={focus} paused={panel !== ''}/>}
    <div className="home-top">
      <button type="button" className="icon-button home-burger" aria-label="Open navigation" onClick={openMenu}><Menu size={20}/></button>
      <span className="home-brand">Second Brain</span>
      <button type="button" className="button small" onClick={newDoc}><Pencil size={14}/>Capture a thought</button>
      <button type="button" className="button small" onClick={openSearch} aria-label="Search workspace"><Search size={14}/><kbd>Ctrl K</kbd></button>
      <button type="button" className={`button small ${panel === 'tree' ? 'primary' : ''}`} aria-pressed={panel === 'tree'} onClick={() => setPanel(p => p === 'tree' ? '' : 'tree')} disabled={!fullModel}><FolderTree size={14}/>Tree</button>
    </div>
    {full && <aside className="home-key" aria-label="Sources">{SOURCES.map(source => <span key={source.key}><i style={{ background: COLORS[source.key] }}/>{source.name}<small>{(counts[source.key] || 0).toLocaleString()}</small></span>)}</aside>}
    {loadError ? <div className="home-error"><div className="error-banner" role="alert"><p>{loadError}</p><button className="button small" onClick={() => void load(true)}><RefreshCw size={14}/>Try again</button></div></div>
      : !model ? <div className="home-loading"><Loader2 className="spin" size={18}/><p>Reading every file under the configured roots…</p></div>
      : <p className="home-foot muted">{sphereIndex < 0 ? 'Drag to turn, scroll to zoom, click a node to open it. ' : ''}{full!.nodes.length.toLocaleString()} files and folders · {model.nodes.length.toLocaleString()} nodes on the globe · {model.edges.length.toLocaleString()} links from the files</p>}
    {panel && fullModel && <aside className="home-panel" aria-label="Details">
      <header className="home-panel-head">
        <div className="home-tabs" role="tablist" aria-label="Panel"><button type="button" role="tab" aria-selected={panel === 'file'} onClick={() => setPanel('file')}>File</button><button type="button" role="tab" aria-selected={panel === 'tree'} onClick={() => setPanel('tree')}>Tree</button></div>
        <button type="button" className="icon-button" aria-label="Close panel" onClick={close}><X size={18}/></button>
      </header>
      {panel === 'tree' && <FileTree model={fullModel} selected={fullIndex} onSelect={selectFromTree} onHover={onTreeHover} query={query} setQuery={setQuery}/>}
      {panel === 'file' && (groupNode ? <div className="file-viewer home-members" aria-label="Viewer">
        <header className="viewer-head"><span className="viewer-icon" style={{ color: colorOf(groupNode) }}><KindIcon node={groupNode} size={20}/></span><div className="viewer-title"><h2>{groupNode.name}</h2><p className="muted">{members.length.toLocaleString()} {kindLabel(groupNode).toLowerCase()} files in one node. Open one here, or on this computer.</p></div></header>
        <ul>{members.slice(0, 400).map(index => { const node = fullModel.nodes[index]; return <li key={node.id}>
          <button type="button" onClick={() => select(node.id, 'viewer')} title={fullModel.paths[index]}><span className="tree-icon" style={{ color: colorOf(node) }}><KindIcon node={node} size={13}/></span><span>{node.name}</span><small>{folderOf(index).split('/').slice(-1)[0]}</small></button>
          <button type="button" className="icon-button" aria-label={`Open ${node.name} on device`} title="Open on device" disabled={opening !== ''} onClick={() => void open(node, false)}>{opening === node.id + ':open' ? <Loader2 className="spin" size={14}/> : <ExternalLink size={14}/>}</button>
          <button type="button" className="icon-button" aria-label={`Reveal ${node.name} in Explorer`} title="Reveal in Explorer" disabled={opening !== ''} onClick={() => void open(node, true)}><FolderOpen size={14}/></button>
        </li>; })}</ul>
        {members.length > 400 && <p className="muted viewer-note">And {(members.length - 400).toLocaleString()} more: open the Tree tab to reach them.</p>}
      </div> : <FileViewer model={fullModel} index={fullIndex} detail={detail} loading={loading} error={detailError} onSelect={selectFromViewer} notify={notify}/>)}
    </aside>}
  </div>;
}
