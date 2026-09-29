// WCAG contrast of the theme's text and control pairs, read from the real token blocks in src/styles.css so a
// changed token is checked, not a copy of it. 4.5:1 for body text, 3:1 for large text and UI edges (WCAG 1.4.3,
// 1.4.11). --mut is the one ink held to 3:1 only: it is the reference's muted grey, used for placeholders,
// icons and large captions, and body copy uses --sub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = start => { const i = css.indexOf(start); assert.ok(i >= 0, `missing ${start}`); return css.slice(i, css.indexOf('}', i)); };
const tokens = text => Object.fromEntries([...text.matchAll(/--([a-z-]+):(#[0-9A-Fa-f]{6})\b/g)].map(m => [m[1], m[2]]));
const light = tokens(block(':root{\n  color-scheme:light;'));
const dark = { ...light, ...tokens(block(':root[data-theme="dark"]')) };

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

const BODY = 4.5, UI = 3;
const pairs = [
  ['ink', 'sheet', BODY], ['ink', 'ground', BODY], ['ink', 'soft', BODY], ['ink', 'band', BODY],
  ['deep', 'sheet', BODY], ['sub', 'sheet', BODY], ['sub', 'ground', BODY], ['sub', 'band', BODY], ['sub', 'btn-hover', BODY],
  ['acc', 'sheet', BODY], ['acc', 'acc-soft', BODY], ['acc', 'btn-hover', BODY],
  ['on-acc', 'acc-fill', BODY], ['on-acc', 'acc-fill-hover', BODY],
  ['link', 'sheet', BODY], ['green-dk', 'sheet', BODY], ['green-dk', 'tip-bg', BODY],
  ['red', 'sheet', BODY], ['red', 'red-bg', BODY], ['amber', 'amber-bg', BODY],
  ['mut', 'sheet', UI], ['mut', 'soft', UI], ['field-line', 'sheet', UI], ['field-line', 'btn-bg', UI], ['acc-fill', 'sheet', UI],
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme text and control pairs meet WCAG AA`, () => {
    const failures = pairs.filter(([fg, bg, min]) => {
      assert.ok(theme[fg] && theme[bg], `${name}: --${fg} or --${bg} is not a literal hex token`);
      return ratio(theme[fg], theme[bg]) < min;
    }).map(([fg, bg, min]) => `--${fg} on --${bg}: ${ratio(theme[fg], theme[bg]).toFixed(2)} < ${min}`);
    assert.deepEqual(failures, []);
  });
}

test('the light tokens are the reference palette, value for value', () => {
  const reference = { ink: '#1A1B22', deep: '#2E2B45', acc: '#6B4EA8', 'acc-soft': '#F3F0FA', green: '#4FA588', 'green-dk': '#2E7A61', amber: '#9C6420', 'amber-bg': '#FDF5E9', red: '#B3261E', 'red-bg': '#FDF0EF', 'lav-bg': '#F4F0FB', hl: '#FFF0A6', line: '#DAD7E4', link: '#1155CC', sheet: '#FFFFFF', ground: '#EDEBF2', grid: '#DEDBE8', frame: '#D5D1E2', soft: '#F7F7F9', sub: '#4A4756', mut: '#8B8798', 'btn-bg': '#FFFFFF', 'btn-hover': '#F4F2F8', band: '#F3F2F7' };
  for (const [k, v] of Object.entries(reference)) assert.equal(light[k], v, `--${k}`);
  const night = { ink: '#FFFFFF', 'acc-soft': '#3B2566', green: '#6FCFAE', amber: '#E8B76B', 'amber-bg': '#332A16', red: '#FB7185', 'red-bg': '#3A1F22', line: '#43316E', sheet: '#1E1238', ground: '#140B28', grid: '#22163F', frame: '#43316E', soft: '#291A4A', sub: '#E4E4E7', mut: '#A1A1AA', 'btn-bg': '#291A4A', 'btn-hover': '#35225E', band: '#2A1A4D', 'acc-fill': '#7B5FC7' };
  for (const [k, v] of Object.entries(night)) assert.equal(dark[k], v, `dark --${k}`);
});
