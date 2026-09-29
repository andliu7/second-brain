// Booklet imposition for PdfTools.tsx: which page goes on which half of which sheet, and where it sits.
// Pure numbers only, no pdf-lib and no DOM, so tests/pamphlet.test.mjs can check it without a browser.
//
// A saddle-stitch booklet is a stack of sheets folded once down the middle. Each sheet carries four pages,
// two on the front and two on the back, so the page count is padded to a multiple of 4. Printed double-sided
// with "flip on short edge" (the way the KCM pamphlet guide prints) the back side lands the right way up,
// so no side is rotated here; the order alone makes the folded stack read 1, 2, 3, ... n.

export type Paper = 'letter' | 'a4';
// Landscape sheet sizes in PDF points (1/72 inch). Letter is 11 x 8.5 in, A4 is 297 x 210 mm.
export const PAPER: Record<Paper, { width: number; height: number; label: string }> = {
  letter: { width: 792, height: 612, label: 'Letter' },
  a4: { width: 841.89, height: 595.28, label: 'A4' },
};

// Where padding blanks go. 'end' appends them, so the back cover may be blank. 'before-last' slips them in
// before the last page, so a page meant as the back cover stays on the back.
export type PadAt = 'end' | 'before-last';

/** The smallest multiple of 4 that holds n pages (at least 4, one sheet). */
export const paddedCount = (n: number) => Math.max(4, Math.ceil(n / 4) * 4);

/** The pages padded to a multiple of 4, with null for each blank. */
export function padPages<T>(pages: T[], at: PadAt = 'end'): (T | null)[] {
  const blanks: null[] = Array(paddedCount(pages.length) - pages.length).fill(null);
  if (at === 'end' || pages.length < 2) return [...pages, ...blanks];
  return [...pages.slice(0, -1), ...blanks, pages[pages.length - 1]];
}

// One sheet: the left and right page numbers on each side, 1-based positions in the padded list.
export type Sheet = { sheet: number; front: [number, number]; back: [number, number] };

/**
 * The saddle-stitch order for n pages (n already a multiple of 4). Sheet k (from 0, the outermost) has
 * front [n-2k, 2k+1] and back [2k+2, n-2k-1]. For 8 pages: sheet 1 front 8|1, back 2|7; sheet 2 front 6|3, back 4|5.
 */
export function imposition(n: number): Sheet[] {
  if (n % 4 !== 0 || n < 4) throw new Error(`imposition needs a multiple of 4 pages, got ${n}`);
  return Array.from({ length: n / 4 }, (_, k) => ({ sheet: k + 1, front: [n - 2 * k, 2 * k + 1], back: [2 * k + 2, n - 2 * k - 1] }));
}

export type Placement = { x: number; y: number; scale: number };

/**
 * Where a page of (width x height) points sits in one half of a landscape sheet: scaled to fit, keeping its
 * aspect, centred in the space left after the gutter. gutter is the total gap at the fold, split between
 * the two halves. creepShift moves the page toward the fold by that many points (creep compensation for
 * thick booklets; 0 turns it off). x, y are the lower-left corner of the placed page in sheet points.
 */
export function placeInHalf(width: number, height: number, side: 'left' | 'right', paper: { width: number; height: number }, gutter: number, creepShift = 0): Placement {
  const half = paper.width / 2;
  const boxWidth = half - gutter / 2;
  const scale = Math.min(boxWidth / width, paper.height / height);
  const left = side === 'left' ? 0 : half + gutter / 2;
  const x = left + (boxWidth - width * scale) / 2 + (side === 'left' ? creepShift : -creepShift);
  return { x, y: (paper.height - height * scale) / 2, scale };
}

/**
 * pdf-lib draws an embedded page from its unrotated content, so a page whose /Rotate is set has to be
 * turned while drawing. Turning by -rotation (clockwise) about the drawing origin swings the page out of
 * its box; this is the offset that brings it back so its lower-left corner is at the placement.
 */
export function rotatedOffset(rotation: number, width: number, height: number, scale: number): { dx: number; dy: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { dx: 0, dy: width * scale };
    case 180: return { dx: width * scale, dy: height * scale };
    case 270: return { dx: height * scale, dy: 0 };
    default: return { dx: 0, dy: 0 };
  }
}

/** A page's size as it is seen, after its rotation. */
export const shownSize = (width: number, height: number, rotation: number) => rotation % 180 === 0 ? { width, height } : { width: height, height: width };
