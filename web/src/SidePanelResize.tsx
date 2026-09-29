// The drag handle on the left edge of the home page's side panel (Home.tsx), which holds the file
// tree and a file's detail. A separator in ARIA terms, so a screen reader announces it with the
// width in pixels, and the keyboard moves it too: Left widens by 24 px, Right narrows, Home and End
// jump to the narrowest and widest. The width is Home's state; this only reports changes, with
// save set once a drag ends or a key lands, so storage is written once per move rather than on
// every pointer event. The drag listens on the window, not the handle, so a quick pull that
// outruns the 8 px strip still tracks.
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export const PANEL_WIDTH = 380; // the width before anyone has dragged it
export const MIN_WIDTH = 260; // narrower and the tree's names are all ellipsis
const STEP = 24;
export const maxWidth = () => Math.max(MIN_WIDTH, Math.round((typeof window === 'undefined' ? 1280 : window.innerWidth) * 0.6)); // 60vw, so the globe always keeps most of the page
export const clampWidth = (width: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, width)));

type Props = { width: number; onResize: (width: number, save: boolean) => void };

export function SidePanelResize({ width, onResize }: Props) {
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection while dragging
    const startX = event.clientX, startWidth = width; let last = width;
    // The panel grows leftward, so a pointer moving left (a smaller clientX) widens it.
    const move = (e: PointerEvent) => { last = clampWidth(startWidth + startX - e.clientX); onResize(last, false); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('home-resizing'); onResize(last, true); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); document.body.classList.add('home-resizing');
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? width + STEP : event.key === 'ArrowRight' ? width - STEP : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth() : null;
    if (next === null) return;
    event.preventDefault(); onResize(clampWidth(next), true);
  }
  return <div className="home-resize" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth()} tabIndex={0} onPointerDown={down} onKeyDown={key}/>;
}
