import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// src/lib/pamphlet.ts is TypeScript with no imports, so it is transpiled and loaded as a data URL, the way
// storage.test.mjs loads storage.ts. The imposed PDF itself (pdf-lib) is checked in pdf-tools.test.tsx.
const source = await readFile(new URL('../src/lib/pamphlet.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { imposition, paddedCount, padPages, placeInHalf, rotatedOffset, PAPER } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

// Each sheet as [front, back], each side as [left, right] page numbers.
const sides = sheets => sheets.map(s => [s.front, s.back]);

test('4 pages: one sheet, front 4|1, back 2|3', () => {
  assert.deepEqual(imposition(4), [{ sheet: 1, front: [4, 1], back: [2, 3] }]);
});

test('8 pages: two sheets nested', () => {
  assert.deepEqual(sides(imposition(8)), [[[8, 1], [2, 7]], [[6, 3], [4, 5]]]);
});

test('12 pages: three sheets nested', () => {
  assert.deepEqual(sides(imposition(12)), [[[12, 1], [2, 11]], [[10, 3], [4, 9]], [[8, 5], [6, 7]]]);
});

test('every page of 16 appears exactly once, and facing pages on a side always sum to n+1', () => {
  const n = 16;
  const all = imposition(n).flatMap(s => [...s.front, ...s.back]).sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: n }, (_, i) => i + 1));
  for (const s of imposition(n)) { assert.equal(s.front[0] + s.front[1], n + 1); assert.equal(s.back[0] + s.back[1], n + 1); }
});

test('5 pages pad to 8, blanks at the end or before the back cover', () => {
  assert.equal(paddedCount(5), 8);
  assert.equal(paddedCount(1), 4);
  assert.equal(paddedCount(8), 8);
  assert.deepEqual(padPages(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd', 'e', null, null, null]);
  assert.deepEqual(padPages(['a', 'b', 'c', 'd', 'e'], 'before-last'), ['a', 'b', 'c', 'd', null, null, null, 'e']);
  // Imposed: the cover (1) and the last page (8) share the outside of sheet 1.
  const slots = padPages(['a', 'b', 'c', 'd', 'e']);
  const read = pair => pair.map(p => slots[p - 1]);
  assert.deepEqual(imposition(8).map(s => [read(s.front), read(s.back)]), [[[null, 'a'], ['b', null]], [[null, 'c'], ['d', 'e']]]);
});

test('imposition refuses a count that is not a multiple of 4', () => {
  assert.throws(() => imposition(6), /multiple of 4/);
});

test('a portrait Letter page fits its half of landscape Letter, centred, clear of the gutter', () => {
  const gutter = 18;
  const left = placeInHalf(612, 792, 'left', PAPER.letter, gutter);
  const right = placeInHalf(612, 792, 'right', PAPER.letter, gutter);
  const w = 612 * left.scale, h = 792 * left.scale;
  // A tall page in a narrow half is limited by width: it fills the half up to the gutter.
  assert.ok(Math.abs(w - (396 - gutter / 2)) < 1e-9);
  assert.ok(left.x >= 0 && left.x + w <= 396 - gutter / 2 + 1e-9);
  assert.ok(right.x >= 396 + gutter / 2 - 1e-9 && right.x + w <= 792 + 1e-9);
  assert.ok(left.y >= 0 && left.y + h <= 612 + 1e-9);
  // Aspect kept: one scale for both axes, and the two halves mirror each other about the fold.
  assert.ok(Math.abs(left.x + w + right.x - 792) < 1e-9);
  // Creep moves both pages toward the fold.
  assert.ok(placeInHalf(612, 792, 'left', PAPER.letter, gutter, 3).x > left.x);
  assert.ok(placeInHalf(612, 792, 'right', PAPER.letter, gutter, 3).x < right.x);
});

test('a rotated page is shifted back into its box', () => {
  assert.deepEqual(rotatedOffset(0, 100, 200, 1), { dx: 0, dy: 0 });
  assert.deepEqual(rotatedOffset(90, 100, 200, 1), { dx: 0, dy: 100 });
  assert.deepEqual(rotatedOffset(180, 100, 200, 0.5), { dx: 50, dy: 100 });
  assert.deepEqual(rotatedOffset(270, 100, 200, 1), { dx: 200, dy: 0 });
});
