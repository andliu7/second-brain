// The Drawnix board itself, kept in its own file so Whiteboard.tsx can load it with React.lazy: Drawnix,
// Plait and Slate come to several hundred kB, and only this page needs them. Nothing else imports this file.
// Whiteboard.tsx mounts one per board, keyed by the board's id, so switching boards is a fresh mount.
import { useEffect, useRef, useState } from 'react';
import { Drawnix, saveAsImage } from '@drawnix/drawnix';
import type { BoardChangeData } from '@plait-board/react-board';
import { PlaitBoard, ThemeColorMode, hasInputOrTextareaTarget, type PlaitElement, type Viewport } from '@plait/core';
import type { Drawing } from './types';
import { useTheme } from './lib/theme';
import { infiniteCanvas } from './whiteboard-viewport';
// The published packages (0.4.0-2) list no stylesheet in their "exports" map, so a bare
// '@drawnix/drawnix/index.css' does not resolve; the files are there, so they are imported by path.
import '../node_modules/@plait-board/react-text/index.css';
import '../node_modules/@plait-board/react-board/index.css';
import '../node_modules/@drawnix/drawnix/index.css';

// Drawnix 0.4.0-2 picks its interface language from localStorage 'language' and falls back to Chinese.
// Set English once, and leave any language chosen in Drawnix's own menu alone.
try { if (!localStorage.getItem('language')) localStorage.setItem('language', 'en'); } catch { /* storage blocked: Drawnix falls back on its own */ }

// The canvas follows the app theme: Plait's default (light) mode by day, its dark mode at night.
const MODES = { light: { themeColorMode: ThemeColorMode.default }, dark: { themeColorMode: ThemeColorMode.dark } };

// What the page's own bar can ask of the board, handed over once the board exists. Whiteboard.tsx imports
// this type only, which is erased, so it pulls none of Drawnix into the main bundle.
export type CanvasApi = { undo: () => void; redo: () => void; exportImage: () => void };
// Whether there is anything to undo or redo, reported with every change.
export type History = { undo: boolean; redo: boolean };

// initial is read once: after mount Drawnix owns the board, and onChange reports every edit and pan.
// Drawnix's published props type onChange as its own handler AND a div's change handler, which no
// typed function satisfies, so the argument comes in as unknown and is read as the BoardChangeData it is.
export default function WhiteboardCanvas({ initial, onChange, onReady }: { initial?: Drawing; onChange: (drawing: Drawing, history: History) => void; onReady: (api: CanvasApi) => void }) {
  const { theme } = useTheme();
  // Held in state so the same array goes to Drawnix on every render: it resets the board whenever value
  // is a different array from the last one.
  const [value] = useState(() => (initial?.elements ?? []) as PlaitElement[]);
  const [board, setBoard] = useState<PlaitBoard | null>(null);
  const viewport = useRef<ReturnType<typeof infiniteCanvas> | null>(null);

  // Starts once Drawnix hands the board over (afterInit), and runs after Plait's own set-up, so its
  // listeners sit on top of Plait's.
  useEffect(() => {
    if (!board) return;
    viewport.current = infiniteCanvas(board);
    // Drawnix undoes on Ctrl+Z and redoes on Ctrl+Shift+Z; Ctrl+Y is the other common redo, added here with
    // the same guards (the board has focus, and no text is being edited).
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'y' && PlaitBoard.isFocus(board) && !PlaitBoard.hasBeenTextEditing(board) && !hasInputOrTextareaTarget(event.target)) { event.preventDefault(); board.redo(); }
    };
    window.addEventListener('keydown', onKey);
    onReady({ undo: () => board.undo(), redo: () => board.redo(), exportImage: () => saveAsImage(board, true) });
    return () => { viewport.current?.dispose(); viewport.current = null; window.removeEventListener('keydown', onKey); };
  }, [board]);  // eslint-disable-line react-hooks/exhaustive-deps -- onReady is read once per board

  return <Drawnix
    value={value}
    viewport={initial?.viewport as Viewport | undefined}
    theme={MODES[theme]}
    afterInit={setBoard}
    onChange={(data: unknown) => {
      const { children, viewport: view } = data as BoardChangeData;
      // Any change can move the view or re-fit Plait's SVG to a grown drawing, so the room past the view
      // is checked again after each one (usually nothing to do).
      viewport.current?.changed();
      onChange({ elements: children as Drawing['elements'], viewport: view as Drawing['viewport'] }, { undo: (board?.history.undos.length ?? 0) > 0, redo: (board?.history.redos.length ?? 0) > 0 });
    }}/>;
}
