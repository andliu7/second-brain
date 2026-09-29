// The light theme's moving background, read from its stylesheet (jsdom applies no CSS, so the rules are checked
// as text), plus the contrast of body text on its darkest frame, computed from the oklch stops it declares.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/components/ui/gradient-background.css', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the hues are registered angles and the keyframes turn each a full circle', () => {
  assert.match(css, /@property --hue1\{syntax:'<angle>';inherits:false;initial-value:30deg\}/);
  assert.match(css, /@property --hue2\{syntax:'<angle>';inherits:false;initial-value:180deg\}/);
  assert.match(css, /@keyframes ground-hue\{from\{--hue1:30deg;--hue2:180deg\}to\{--hue1:390deg;--hue2:540deg\}\}/);
});

test('everything that paints sits inside the oklch @supports fallback', () => {
  const at = css.indexOf('@supports (background:linear-gradient(in oklch longer hue,red,blue))');
  assert.ok(at >= 0, 'missing @supports');
  assert.ok(css.indexOf('body::before') > at, 'the layer is declared outside @supports');
});

test('light only: the layer, both speeds, pause and reduced motion; nothing for dark', () => {
  assert.match(css, /:root\[data-theme="light"\] body::before\{[^}]*position:fixed;inset:0;z-index:-1;pointer-events:none;--hue1:30deg;--hue2:180deg;/);
  assert.equal((css.match(/in oklch longer hue to (right|bottom),oklch\(0\.95 0\.07 var\(--hue1\) \/ 60%\),oklch\(0\.92 0\.08 var\(--hue2\) \/ 60%\)/g) || []).length, 2);
  assert.match(css, /:root\[data-theme="light"\]\[data-bg="animated"\] body::before\{animation:ground-hue 24s linear infinite\}/);
  assert.match(css, /\[data-bg-speed="lively"\] body::before\{animation-duration:5s\}/);
  assert.match(css, /:root\[data-bg-paused\] body::before\{animation-play-state:paused\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{body::before\{animation:none!important\}\}/);
  assert.match(css, /body:has\(\.app-home\)::before\{display:none\}/);
  assert.doesNotMatch(css, /data-theme="dark"/);
});

// oklch to sRGB (Bjorn Ottosson's matrices), clamped into gamut the way a browser maps an out-of-gamut colour.
const oklch = (L, C, h) => {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
    .map(v => Math.min(1, Math.max(0, v))).map(v => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = c => { const [r, g, b] = c.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const token = name => styles.match(new RegExp(`:root\\{\\n  color-scheme:light;[\\s\\S]*?--${name}:(#[0-9A-Fa-f]{6})`))[1];

test('light body text keeps 4.5:1 on the darkest frame of the wash', () => {
  // Worst case: both layers at the darker stop (L 0.92, C 0.08), 60% over 60% over the ground, every 5 degrees.
  const ground = hex(token('ground'));
  let worst = Infinity;
  for (let h = 0; h < 360; h += 5) {
    const c = oklch(.92, .08, h);
    const over = (top, under) => top.map((v, i) => .6 * v + .4 * under[i]);
    const page = over(c, over(c, ground));
    worst = Math.min(worst, ratio(hex(token('sub')), page), ratio(hex(token('ink')), page));
  }
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}`);
});
