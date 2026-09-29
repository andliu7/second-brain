// The whiteboard's infinite canvas, on top of Plait's own viewport (imported only by WhiteboardCanvas.tsx,
// so it rides in the lazy whiteboard chunk).
//
// Why this exists: Plait draws the board as one big SVG inside a native scrolling div, and sizes that SVG
// to the drawing plus three quarters of a screen on each side. Scrolling therefore stops at a wall a short
// way past the last shape, with scrollbars showing. Plait already zooms on Ctrl+wheel and pinch, and pans on
// space+drag and middle-drag, so only the wall needs removing. makeRoom widens the SVG's viewBox (Plait's own
// setSVGViewBox) so it always reaches one screen past what is visible, and scrolls back to the same spot, so
// there is always somewhere left to scroll to. whiteboard.css hides the scrollbars.
import { BoardTransforms, PlaitBoard, calcNewViewBox, clampZoomLevel, getViewBox, getViewportOrigination, setSVGViewBox, toHostPointFromViewBoxPoint, updateViewportContainerScroll, ZOOM_STEP, type Point } from '@plait/core';

// Grow (or shrink back to) the drawing's own area joined with a margin of one screen round the view, then
// put the view at origination: the board point that should sit at the top left corner.
export function makeRoom(board: PlaitBoard, origination: Point) {
  const zoom = board.viewport.zoom;
  const { width, height } = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
  if (!width || !height) return;  // not laid out (hidden, or a test's DOM): nothing to scroll yet
  const [x, y, w, h] = calcNewViewBox(board, zoom);
  const left = Math.min(x, origination[0] - width / zoom), top = Math.min(y, origination[1] - height / zoom);
  const right = Math.max(x + w, origination[0] + 2 * width / zoom), bottom = Math.max(y + h, origination[1] + 2 * height / zoom);
  const box = getViewBox(board);
  // Only touch the SVG when the box really moved; a sub-pixel difference would restyle it every frame.
  if (Math.abs(box.x - left) + Math.abs(box.y - top) + Math.abs(box.width - (right - left)) + Math.abs(box.height - (bottom - top)) > 1 / zoom) {
    setSVGViewBox(board, [left, top, right - left, bottom - top]);
  }
  const [scrollLeft, scrollTop] = toHostPointFromViewBoxPoint(board, origination);
  // false: the scroll event this causes is then read as a scroll, so Plait records the new origination.
  updateViewportContainerScroll(board, scrollLeft, scrollTop, false);
}

// Wires the wheel and resizing to makeRoom. It returns changed, which WhiteboardCanvas calls after every
// change the board reports (the view moved through Plait by space+drag, middle-drag, a touch pinch or
// Drawnix's zoom buttons, or a drawing that grew and made Plait re-fit its SVG) so the next frame has room
// past the view again, and dispose, the cleanup. The wheel is taken over completely
// (listened for on the board's container in the capture phase, before Plait's own handler below it):
//   plain wheel or a trackpad's two-finger scroll pans in both axes (Shift turns a mouse wheel sideways);
//   Ctrl+wheel, and a trackpad pinch, which browsers report as Ctrl+wheel, zooms around the cursor.
export function infiniteCanvas(board: PlaitBoard): { changed: () => void; dispose: () => void } {
  const container = PlaitBoard.getBoardContainer(board);
  // Where a zoom meant the view to go. Plait re-fits the SVG to the drawing after a zoom, which clamps the
  // view if it is far from the drawing; the frame after, makeRoom puts it back here. One shared frame, so
  // a change reported in between cannot make room at the clamped spot after the aimed one.
  let aimed: Point | null = null;
  let frame = 0;
  const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const at = aimed ?? getViewportOrigination(board); aimed = null; if (at) makeRoom(board, at); }); };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const origination = aimed ?? getViewportOrigination(board);
    if (!origination) return;
    const zoom = board.viewport.zoom;
    const rect = container.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      // Plait's own zoom step (react-board's wheel handler), so a pinch feels the same as before.
      const sign = Math.sign(event.deltaY), size = Math.abs(event.deltaY), cap = ZOOM_STEP * 100;
      let next = zoom - (size > cap ? cap * sign : event.deltaY) / 100;
      next = clampZoomLevel(next + Math.log10(Math.max(1, zoom)) * -sign * Math.min(1, size / 20));
      // Keep the board point under the cursor under the cursor.
      const focus: Point = [event.clientX - rect.left, event.clientY - rect.top];
      aimed = [origination[0] + focus[0] / zoom - focus[0] / next, origination[1] + focus[1] / zoom - focus[1] / next];
      BoardTransforms.updateViewport(board, aimed, next);
      later();
      return;
    }
    // deltaMode 1 counts lines and 2 pages (Firefox with some mice); pixels are what the view moves by.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    let dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (event.shiftKey && !dx) { dx = dy; dy = 0; }
    makeRoom(board, [origination[0] + dx / zoom, origination[1] + dy / zoom]);
  };
  container.addEventListener('wheel', onWheel, { capture: true, passive: false });

  // A resize (full screen, the sidebar) makes Plait re-fit the SVG to the drawing; this observer is created
  // after Plait's, so it runs straight after it and makes the room again before the frame is drawn.
  const resize = new ResizeObserver(() => { const at = getViewportOrigination(board); if (at) makeRoom(board, at); });
  resize.observe(container);
  later();  // and once at the start, after Plait has placed the saved view

  return { changed: later, dispose: () => { container.removeEventListener('wheel', onWheel, { capture: true }); resize.disconnect(); cancelAnimationFrame(frame); } };
}
