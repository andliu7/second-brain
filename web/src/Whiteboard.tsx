// The whiteboard page (#draw): Drawnix (MIT, github.com/plait-board/drawnix) for sketches, mind maps and
// flowcharts, saved in the workspace as workspace.drawing.
//   workspace: the current workspace; only workspace.drawing is read, once, when the page opens
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mounted in App.tsx as {page === 'draw' && <Whiteboard workspace={workspace} commit={commit}/>}.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Drawing, Workspace } from './types';
import './whiteboard.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;

// The heavy part loads on first visit to this page, not with the app (React.lazy splits it into its own chunk).
const WhiteboardCanvas = lazy(() => import('./WhiteboardCanvas'));

// A stroke or a drag reports a change on every pointer move, so saves wait until the board has been
// still this long. Leaving the page saves whatever is still waiting.
export const SAVE_DELAY_MS = 800;

export function Whiteboard({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  // Read once. Drawnix keeps its own state after mount, and handing each save back in as a new value
  // would reset the board under the pen.
  const [initial] = useState(() => workspace.drawing);
  const pending = useRef<Drawing | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest commit, for the save that runs on unmount after this render's commit may be stale.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = () => {
    clearTimeout(timer.current);
    const drawing = pending.current;
    if (!drawing) return;
    pending.current = null;
    void commitRef.current(w => ({ ...w, drawing }));
  };
  const change = (drawing: Drawing) => {
    pending.current = drawing;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  useEffect(() => flush, []);

  return <section className="whiteboard" aria-label="Whiteboard">
    <Suspense fallback={<div className="whiteboard-loading"><Loader2 className="spin" size={18}/>Opening the whiteboard…</div>}>
      <WhiteboardCanvas initial={initial} onChange={change}/>
    </Suspense>
  </section>;
}
