// The page list behind PdfTools.tsx, as plain data and pure functions: no DOM, no pdf-lib. Every button
// on the page (move, swap, rotate, delete, duplicate, insert, add a mark) is one function here that takes
// the list and returns a new one, which is what makes undo a matter of keeping the old lists.
//
// A page never holds its bytes. It names a source (an imported file, by its index in the sources array
// PdfTools keeps) and a page index inside it, so reordering a 200-page document moves 200 small objects
// and nothing is re-parsed until Download. A blank page has source -1.

export type Rotation = 0 | 90 | 180 | 270;
// Marks are drawn on a page and flattened into it on save. Their coordinates are in the page's own
// unrotated space, in PDF points from its top-left corner, so they turn with the page when it is rotated.
// A text mark also keeps the rotation the page had when it was placed, so it is drawn reading upright
// the way it was typed. size is the font size in points.
export type TextMark = { id: string; kind: 'text'; x: number; y: number; text: string; size: number; color: string; turn: Rotation };
export type InkMark = { id: string; kind: 'ink'; points: [number, number][]; width: number; color: string };
export type Mark = TextMark | InkMark;
// width and height are the unrotated page size in points; rotation is the whole rotation (the source's own
// /Rotate plus any turns made here), clockwise, as PDF and pdf.js both count it.
export type PageItem = { id: string; source: number; index: number; width: number; height: number; rotation: Rotation; marks: Mark[] };

export const BLANK = -1;
export const LETTER_PORTRAIT = { width: 612, height: 792 };

/** Move the pages named by ids, keeping their order, to just before `before` (null for the end). */
export function moveTo(pages: PageItem[], ids: string[], before: string | null): PageItem[] {
  const moving = pages.filter(page => ids.includes(page.id));
  if (!moving.length || (before !== null && ids.includes(before))) return pages;
  const rest = pages.filter(page => !ids.includes(page.id));
  const at = before === null ? rest.length : rest.findIndex(page => page.id === before);
  if (at < 0) return pages;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Move one page a step left (-1) or right (1). The ends stay put. Alt+Left and Alt+Right. */
export function moveBy(pages: PageItem[], id: string, by: -1 | 1): PageItem[] {
  const i = pages.findIndex(page => page.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= pages.length) return pages;
  const next = [...pages];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Swap two pages where they stand: "flip the middle two". */
export function swap(pages: PageItem[], a: string, b: string): PageItem[] {
  const i = pages.findIndex(page => page.id === a);
  const j = pages.findIndex(page => page.id === b);
  if (i < 0 || j < 0 || i === j) return pages;
  const next = [...pages];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Turn the named pages by 90 degrees clockwise (1) or anticlockwise (-1). */
export function rotate(pages: PageItem[], ids: string[], by: -1 | 1): PageItem[] {
  return pages.map(page => ids.includes(page.id) ? { ...page, rotation: (((page.rotation + by * 90) % 360) + 360) % 360 as Rotation } : page);
}

export const remove = (pages: PageItem[], ids: string[]) => pages.filter(page => !ids.includes(page.id));

/** A copy of each named page right after it. newId makes ids, so the function stays pure under test. */
export function duplicate(pages: PageItem[], ids: string[], newId: () => string): PageItem[] {
  return pages.flatMap(page => ids.includes(page.id) ? [page, { ...page, id: newId(), marks: page.marks.map(mark => ({ ...mark, id: newId() })) }] : [page]);
}

/** A blank page after the page `after` (or at the end), the size of that page, else Letter portrait. */
export function insertBlank(pages: PageItem[], after: string | null, id: string): PageItem[] {
  const at = after === null ? -1 : pages.findIndex(page => page.id === after);
  const like = at >= 0 ? pages[at] : pages[pages.length - 1];
  const size = like ? { width: like.width, height: like.height } : LETTER_PORTRAIT;
  const blank: PageItem = { id, source: BLANK, index: 0, ...size, rotation: 0, marks: [] };
  const i = at >= 0 ? at + 1 : pages.length;
  return [...pages.slice(0, i), blank, ...pages.slice(i)];
}

export function setMarks(pages: PageItem[], id: string, change: (marks: Mark[]) => Mark[]): PageItem[] {
  return pages.map(page => page.id === id ? { ...page, marks: change(page.marks) } : page);
}

// Selection, the way a file manager does it. A plain click selects one page and sets the anchor; Ctrl (or
// Cmd) toggles one page; Shift selects the run from the anchor to the clicked page.
export type Selection = { ids: string[]; anchor: string | null };
export function select(pages: PageItem[], current: Selection, id: string, mods: { shift?: boolean; ctrl?: boolean }): Selection {
  if (mods.shift && current.anchor) {
    const a = pages.findIndex(page => page.id === current.anchor);
    const b = pages.findIndex(page => page.id === id);
    if (a >= 0 && b >= 0) return { ids: pages.slice(Math.min(a, b), Math.max(a, b) + 1).map(page => page.id), anchor: current.anchor };
  }
  if (mods.ctrl) return { ids: current.ids.includes(id) ? current.ids.filter(x => x !== id) : [...current.ids, id], anchor: id };
  return { ids: [id], anchor: id };
}

// Undo and redo keep whole page lists: past, the present, and what undo stepped back over. A change with
// a key that matches the last change's key replaces the present instead of stacking, so typing into one
// text box is one undo step, not one per letter.
export type History = { past: PageItem[][]; present: PageItem[]; future: PageItem[][]; key?: string };
const LIMIT = 100;
export const history = (present: PageItem[] = []): History => ({ past: [], present, future: [] });
export function record(h: History, next: PageItem[], key?: string): History {
  if (next === h.present) return h;
  if (key && key === h.key) return { ...h, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], key };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// Page space and what is on screen. The editor shows a page turned by its rotation (pdf.js renders it
// that way), and a click there has to become a point in the unrotated page, where marks are kept.
// (x, y) are points from the top-left; width and height are the unrotated page size.
export function toShown(x: number, y: number, rotation: Rotation, width: number, height: number): [number, number] {
  switch (rotation) {
    case 90: return [height - y, x];
    case 180: return [width - x, height - y];
    case 270: return [y, width - x];
    default: return [x, y];
  }
}
export function fromShown(u: number, v: number, rotation: Rotation, width: number, height: number): [number, number] {
  switch (rotation) {
    case 90: return [v, height - u];
    case 180: return [width - u, height - v];
    case 270: return [width - v, u];
    default: return [u, v];
  }
}
