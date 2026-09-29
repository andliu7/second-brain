// The whiteboard page (#draw): Drawnix (MIT, github.com/plait-board/drawnix) for sketches, mind maps and
// flowcharts, on a canvas that fills the page, with any number of named boards saved in
// workspace.whiteboards and the open one named by workspace.currentWhiteboard.
//   workspace: the current workspace; the open board's drawing is read when its canvas mounts
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mounted in App.tsx as {page === 'draw' && <Whiteboard workspace={workspace} commit={commit}/>}; App gives
// the shell the app-draw class on this page, which whiteboard.css uses to hand the page all its height.
//
// The page is Drawnix's canvas plus one slim bar of our own at the top left: the board menu, Undo, Redo and
// the board's title. The bar replaces Drawnix's own top-left toolbar (hidden in whiteboard.css), which had
// the same undo and redo behind a hamburger menu of file and language items this app does not use.
import { lazy, Suspense, useEffect, useRef, useState, type Ref } from 'react';
import { Check, Copy, Download, LayoutGrid, Loader2, Maximize2, Minimize2, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { Drawing, Whiteboard as Board, Workspace } from './types';
import type { CanvasApi, History } from './WhiteboardCanvas';
import { uid } from './lib/storage';
import './whiteboard.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;

// The heavy part loads on first visit to this page, not with the app (React.lazy splits it into its own chunk).
const WhiteboardCanvas = lazy(() => import('./WhiteboardCanvas'));

// A stroke or a drag reports a change on every pointer move, so saves wait until the board has been
// still this long. Leaving the page, or switching boards, saves whatever is still waiting.
export const SAVE_DELAY_MS = 800;
export const DEFAULT_NAME = 'Whiteboard';

// The boards a workspace holds. A workspace saved before there were several has none, and reads as one
// board called Whiteboard holding its old drawing (empty if it never drew). The fixed id keeps that board
// the same board from render to render until the first write saves it.
export function boardsOf(workspace: Workspace, now: string): Board[] {
  if (workspace.whiteboards?.length) return workspace.whiteboards;
  return [{ id: 'whiteboard', name: DEFAULT_NAME, elements: workspace.drawing?.elements ?? [], ...(workspace.drawing?.viewport ? { viewport: workspace.drawing.viewport } : {}), updated: now }];
}

// Every write of the boards goes through here: it starts from boardsOf, so the first write is also the
// migration, and it drops the old single drawing, which is never written again.
function writeBoards(workspace: Workspace, change: (boards: Board[], now: string) => Board[]): Workspace {
  const now = new Date().toISOString();
  const { drawing: _old, ...rest } = workspace;
  return { ...rest, whiteboards: change(boardsOf(workspace, now), now) };
}

export function Whiteboard({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const boards = boardsOf(workspace, '');
  const current = boards.find(board => board.id === workspace.currentWhiteboard) ?? boards[0];
  const pending = useRef<{ id: string; drawing: Drawing } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest commit, for the save that runs on unmount after this render's commit may be stale.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [history, setHistory] = useState<History>({ undo: false, redo: false });
  const [full, setFull] = useState(false);
  const page = useRef<HTMLElement>(null);
  const title = useRef<HTMLInputElement>(null);

  const flush = () => {
    clearTimeout(timer.current);
    const saved = pending.current;
    if (!saved) return Promise.resolve(true);
    pending.current = null;
    return commitRef.current(w => writeBoards(w, (list, now) => list.map(board => board.id === saved.id ? { ...board, ...saved.drawing, updated: now } : board)));
  };
  const change = (id: string, drawing: Drawing, next: History) => {
    pending.current = { id, drawing };
    // Same values, same object, so a pan (a change every frame) does not re-render the page.
    setHistory(last => last.undo === next.undo && last.redo === next.redo ? last : next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  useEffect(() => {
    // An old save's single drawing becomes the first board as soon as the page opens.
    if (!workspace.whiteboards && workspace.drawing) void commitRef.current(w => w.whiteboards ? w : writeBoards(w, list => list));
    return () => { void flush(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- once per visit; flush reads only refs

  // Board actions save the open board's waiting edits first, so a switch or a copy never loses them.
  const act = async (update: (w: Workspace) => Workspace) => { await flush(); await commitRef.current(update); };
  const open = (id: string) => act(w => ({ ...w, currentWhiteboard: id }));
  const create = () => { const id = uid(); return act(w => ({ ...writeBoards(w, (list, now) => [...list, { id, name: `${DEFAULT_NAME} ${list.length + 1}`, elements: [], viewport: { zoom: 1 }, updated: now }]), currentWhiteboard: id })); };
  const duplicate = () => {
    const id = uid(), from = current.id;
    return act(w => ({ ...writeBoards(w, (list, now) => list.flatMap(board => board.id === from ? [board, { ...structuredClone(board), id, name: `${board.name} copy`, updated: now }] : [board])), currentWhiteboard: id }));
  };
  const remove = () => {
    const id = current.id;
    return act(w => {
      const list = boardsOf(w, ''), at = list.findIndex(board => board.id === id), rest = list.filter(board => board.id !== id);
      return { ...writeBoards(w, () => rest), currentWhiteboard: (rest[at] ?? rest[at - 1]).id };
    });
  };
  const rename = (name: string) => {
    const id = current.id, clean = name.trim();
    if (!clean || clean === current.name) return;
    void commitRef.current(w => writeBoards(w, (list, now) => list.map(board => board.id === id ? { ...board, name: clean, updated: now } : board)));
  };

  // Full screen: the page covers the whole window (the whiteboard-full class) and, where the browser
  // allows it, the screen too (requestFullscreen). Esc leaves either way; in the browser's own full screen
  // Esc is the browser's, and the fullscreenchange it fires brings the page back with it.
  const leaveFull = () => { setFull(false); if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {}); };
  const enterFull = () => { setFull(true); if (typeof page.current?.requestFullscreen === 'function') void page.current.requestFullscreen().catch(() => {}); };
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== 'Escape' || event.defaultPrevented || target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      leaveFull();
    };
    const onNative = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onNative);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onNative); };
  }, [full]);

  // A new canvas (the page opening, or another board) starts with nothing to undo.
  const ready = (next: CanvasApi) => { setApi(next); setHistory({ undo: false, redo: false }); };
  const renameFromMenu = () => { title.current?.focus(); title.current?.select(); };

  return <section ref={page} className={`whiteboard${full ? ' whiteboard-full' : ''}`} aria-label="Whiteboard">
    <div className="whiteboard-bar" role="toolbar" aria-label="Whiteboard tools">
      <BoardMenu boards={boards} current={current} full={full} open={id => void open(id)} create={() => void create()} rename={renameFromMenu}
        duplicate={() => void duplicate()} remove={() => void remove()} exportImage={api ? api.exportImage : undefined} toggleFull={() => full ? leaveFull() : enterFull()}/>
      <button type="button" className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!api || !history.undo} onClick={() => api?.undo()}><Undo2 size={17}/></button>
      <button type="button" className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" disabled={!api || !history.redo} onClick={() => api?.redo()}><Redo2 size={17}/></button>
      {/* key: a fresh field per board, so a half-typed name never carries over to the next board */}
      <Title key={current.id} ref={title} name={current.name} rename={rename}/>
    </div>
    <Suspense fallback={<div className="whiteboard-loading"><Loader2 className="spin" size={18}/>Opening the whiteboard…</div>}>
      {/* key: switching boards mounts a fresh canvas with that board's drawing, since Drawnix reads its data once */}
      <WhiteboardCanvas key={current.id} initial={current} onReady={ready} onChange={(drawing, next) => change(current.id, drawing, next)}/>
    </Suspense>
  </section>;
}

// The board's name, edited in place. Typing stays local (a draft) and is saved on Enter or on leaving the
// field; Esc puts the saved name back. The field grows with the name, up to the bar's width. ref is an
// ordinary prop here (React 19), so the menu's Rename can focus this field.
function Title({ ref, name, rename }: { ref: Ref<HTMLInputElement>; name: string; rename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  // Esc blurs the field too, and the blur must not save what Esc threw away.
  const cancelled = useRef(false);
  useEffect(() => setDraft(name), [name]);
  return <input ref={ref} className="whiteboard-title" aria-label="Whiteboard title" value={draft} maxLength={256} size={Math.max(6, draft.length + 1)} spellCheck={false}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { if (cancelled.current || !draft.trim()) { cancelled.current = false; setDraft(name); return; } rename(draft); }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; event.currentTarget.blur(); }
    }}/>;
}

// The board menu: every board (the open one ticked), then what can be done to the open one. The button is
// a grid of boards, not a hamburger, since it lists boards rather than app settings. role=menu with
// menuitems; Escape or a click outside closes it, and Delete asks first, inside the menu.
function BoardMenu({ boards, current, full, open, create, rename, duplicate, remove, exportImage, toggleFull }: {
  boards: Board[]; current: Board; full: boolean; open: (id: string) => void; create: () => void; rename: () => void; duplicate: () => void; remove: () => void; exportImage?: () => void; toggleFull: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = () => { setShown(false); setConfirming(false); };
  const act = (fn: () => void) => { close(); fn(); };
  return <div className="whiteboard-menu-wrap" onKeyDown={event => { if (event.key === 'Escape' && shown) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button type="button" className={`icon-button${shown ? ' active' : ''}`} aria-label="Whiteboards" title="Whiteboards" aria-haspopup="menu" aria-expanded={shown} onClick={() => shown ? close() : setShown(true)}><LayoutGrid size={17}/></button>
    {shown && <>
      <div className="whiteboard-menu-layer" onClick={close}/>
      <div className="whiteboard-menu" role="menu" aria-label="Whiteboards">
        {confirming ? <div className="whiteboard-menu-confirm" role="alert">
          <p>Delete {current.name}? Its drawing goes with it.</p>
          <div><button type="button" className="text-button" onClick={() => setConfirming(false)}>Keep it</button><button type="button" className="button small danger" onClick={() => act(remove)}>Delete whiteboard</button></div>
        </div> : <>
          <div className="whiteboard-menu-boards" role="group" aria-label="Saved whiteboards">
            {boards.map(board => <button key={board.id} type="button" role="menuitemradio" aria-checked={board.id === current.id} onClick={() => act(() => { if (board.id !== current.id) open(board.id); })}>
              <Check size={14} className="whiteboard-menu-tick"/><span>{board.name}</span>
            </button>)}
          </div>
          <hr/>
          <button type="button" role="menuitem" onClick={() => act(create)}><Plus size={14}/>New whiteboard</button>
          <button type="button" role="menuitem" onClick={() => act(rename)}><Pencil size={14}/>Rename</button>
          <button type="button" role="menuitem" onClick={() => act(duplicate)}><Copy size={14}/>Duplicate</button>
          <button type="button" role="menuitem" disabled={!exportImage} onClick={() => exportImage && act(exportImage)}><Download size={14}/>Export as PNG</button>
          <button type="button" role="menuitem" onClick={() => act(toggleFull)}>{full ? <><Minimize2 size={14}/>Exit full screen</> : <><Maximize2 size={14}/>Full screen</>}</button>
          <button type="button" role="menuitem" className="danger" disabled={boards.length < 2} title={boards.length < 2 ? 'The only whiteboard cannot be deleted' : undefined} onClick={() => setConfirming(true)}><Trash2 size={14}/>Delete</button>
        </>}
      </div>
    </>}
  </div>;
}
