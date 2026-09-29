// The home page: the grouped graph on a globe (SphereCanvas.tsx over lib/sphere.ts), the key,
// the burger, and the detail panel over the right edge. The canvas gets a recording 2D context
// here, so what the first frame drew is measured; every test runs under prefers-reduced-motion
// (tests/setup.ts stubs matchMedia to match), so nothing moves unless the pointer moves it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from '../src/Home';
import App from '../src/App';
import { PERSPECTIVE, RADIUS } from '../src/SphereCanvas';
import { TextReveal } from '../src/components/ui/text-reveal';
import { buildModel, colorOf } from '../src/lib/network';
import type { Workspace } from '../src/types';
import { today } from '../src/lib/storage';
import { ARC_LIFT, arcMid, curveAt, fibonacci, intro, Messages, nodeProgress, sphereLayout, toFront, apply, turn, identity } from '../src/lib/sphere';
import { createForce, settle, settled } from '../src/lib/force';

const node = (id: string, name: string, kind: string, parent: number, extra: Partial<{ layer: string; root: number; size: number; members: string[] }> = {}) => ({ id, name, kind, layer: extra.layer ?? '', parent, root: extra.root ?? 0, size: extra.size ?? 0, mtime: 0, ...(extra.members ? { members: extra.members } : {}) });
const roots = [{ path: 'C:/Users/andrew/Downloads/Projects', count: 4 }, { path: 'C:/Users/andrew/.claude/skills', count: 0 }];
// The full graph, as /api/graph returns it, and the same graph folded, as /api/graph/grouped does.
const full = { roots, signature: 'sig1', nodes: [
  node('dept1', 'Chemistry apps', 'dept', -1, { layer: 'dept' }), node('alpha', 'blueberry_game', 'folder', 0), node('readme', 'README.md', 'note', 1, { size: 300 }), node('docs', 'docs', 'folder', 1), node('ref', 'reference', 'folder', 3),
  node('a', 'a.png', 'image', 4, { size: 900 }), node('b', 'b.png', 'image', 4, { size: 800 }), node('vite', 'vite.config.js', 'code', 1, { size: 400 }), node('dept2', 'Skills', 'dept', -1, { layer: 'dept', root: 1 }), node('gen', 'generate', 'skill', 8, { layer: 'skill', root: 1 }),
], edges: [[2, 4, 'mention'], [2, 9, 'skill']] as [number, number, string][] };
const IMAGES = 'blueberry_game/docs/reference · 2 images';
const grouped = { roots, signature: 'sig1', nodes: [
  node('dept1', 'Chemistry apps', 'dept', -1, { layer: 'dept' }), node('alpha', 'blueberry_game', 'folder', 0), node('readme', 'README.md', 'note', 1, { size: 300 }), node('dept2', 'Skills', 'dept', -1, { layer: 'dept', root: 1 }), node('gen', 'generate', 'skill', 3, { layer: 'skill', root: 1 }),
  node('g-img', IMAGES, 'image', 1, { size: 1700, members: ['a', 'b'] }), node('g-code', 'blueberry_game · 1 code file', 'code', 1, { size: 400, members: ['vite'] }),
], edges: [[2, 5, 'mention'], [2, 4, 'skill']] as [number, number, string][] };
const details: Record<string, object> = {
  readme: { id: 'readme', name: 'README.md', kind: 'note', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/README.md', root: roots[0].path, size: 300, mtime: 0, summary: {}, excerpt: '# Blueberry game\n\nThe learning game.\n', next: null, linksIn: [], linksOut: [], children: [], group: null, where: null },
  a: { id: 'a', name: 'a.png', kind: 'image', layer: '', path: 'C:/Users/andrew/Downloads/Projects/blueberry_game/docs/reference/a.png', root: roots[0].path, size: 900, mtime: 0, summary: {}, excerpt: null, next: null, linksIn: [], linksOut: [], children: [], group: null, where: null },
};
let requests: { url: string; body: any }[] = []; let arcs: [number, number, number][] = []; let firstFrame: [number, number, number][] = [];
const notify = vi.fn();
// The workspace Home is handed, and App's commit and capture as stand-ins: commit applies the update
// to `stored`, the way App's saves it, so a test reads what was committed. The calendar is not
// connected unless a test says otherwise.
let stored: Workspace; let calendar: { connected: boolean; events: unknown[] };
const commit = vi.fn(async (update: (w: Workspace) => Workspace) => { stored = update(stored); return true; });
const capture = vi.fn(async (_text: string) => true);
// A 2D context that records every dot drawn, whether a stamped disc (drawImage) or an arc: the
// ones of the first frame are kept apart.
function context() {
  const dot = (x: number, y: number, r: number) => { arcs.push([x, y, r]); if (!window.__sphere || window.__sphere.renders() === 0) firstFrame.push([x, y, r]); };
  const ctx: any = { canvas: null, measureText: (text: string) => ({ width: text.length * 6 }), arc: dot, drawImage: (_: unknown, x: number, y: number, w: number, h: number) => dot(x + w / 2, y + h / 2, w / 2 - 1) };
  return new Proxy(ctx, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
}
beforeEach(() => {
  requests = []; arcs = []; firstFrame = []; notify.mockClear(); commit.mockClear(); capture.mockClear();
  stored = { version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [], todos: { day: today(), items: [{ id: 't1', text: 'Read chapter 4', done: false, category: 'other' }], history: {}, removedDefaults: ['read', 'write'] } };
  calendar = { connected: false, events: [] };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context());
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 600; } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) : undefined; requests.push({ url: path, body });
    const params = new URL(path, 'http://localhost').searchParams;
    const reply = path.endsWith('/calendar/status') ? { connected: calendar.connected } : path.includes('/calendar/events') ? { events: calendar.events } : path.includes('/graph/node') ? details[params.get('id')!] : path.includes('/graph/grouped') ? (params.get('signature') === 'sig1' ? grouped : { error: 'wrong signature' }) : path.includes('/graph/open') ? { ok: true, reveal: body?.reveal } : path.endsWith('/graph') ? full
      : path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} } : path.endsWith('/projects') ? { repos: [], courses: [], blueberry: null, routines: [] } : path.endsWith('/tasks') ? { tasks: [] } : path.endsWith('/skills') ? { skills: [] } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  location.hash = '';
});
afterEach(() => { delete (HTMLElement.prototype as any).clientWidth; delete (HTMLElement.prototype as any).clientHeight; });
const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
async function ready() {
  render(<Home notify={notify} openMenu={() => {}} openSearch={() => {}} newDoc={() => {}} workspace={stored} commit={commit} capture={capture}/>);
  await screen.findByRole('button', { name: 'Key' }); // the key is a button at the right edge now, its colours in a popover
  await waitFor(() => expect(window.__sphere?.renders()).toBeGreaterThan(0));
  return document.querySelector('canvas') as HTMLCanvasElement;
}
const pointer = (canvas: HTMLCanvasElement, type: string, x: number, y: number) => { const Ctor = (window as any).PointerEvent || MouseEvent; canvas.dispatchEvent(new Ctor(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1 })); };
const clickNode = async (canvas: HTMLCanvasElement, name: string) => { const at = window.__sphere!.screenOf(name)!; expect(at).not.toBeNull(); pointer(canvas, 'pointerdown', at.x, at.y); pointer(canvas, 'pointerup', at.x, at.y); await frame(); };

describe('the globe', () => {
  // 2026-09-29, "keep the nodes close to each other by color/reference": the lattice is shared out
  // by colour, not by department, so the two tests that asserted departments on Fibonacci centres
  // and department blobs were re-pointed to the new requirement. What they checked about the
  // sphere itself (every node on it, the load-in outside it, none coincident, the fill even) stays.
  it('lays every node on the unit sphere, starts the load-in well outside it, and turns any node to the front', () => {
    const model = buildModel(grouped); const { pos, scatter } = sphereLayout(model);
    for (let i = 0; i < model.nodes.length; i++) expect(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])).toBeCloseTo(1, 5);
    for (let i = 0; i < model.nodes.length; i++) expect(Math.hypot(scatter[i * 3], scatter[i * 3 + 1], scatter[i * 3 + 2])).toBeGreaterThan(1.5); // the load-in starts well outside
    const lattice = fibonacci(model.nodes.length); // every node on its own lattice point
    const taken = new Set<number>(); for (let i = 0; i < model.nodes.length; i++) { const k = lattice.findIndex(p => Math.hypot(p[0] - pos[i * 3], p[1] - pos[i * 3 + 1], p[2] - pos[i * 3 + 2]) < 1e-5); expect(k).toBeGreaterThanOrEqual(0); taken.add(k); }
    expect(taken.size).toBe(model.nodes.length);
    const front = toFront(turn(identity(), 0.7, -0.4), pos, 2); const rot = turn(identity(), 0.7, -0.4);
    const [, , z] = apply(rot, pos[6], pos[7], pos[8]); expect(front.angle).toBeCloseTo(Math.acos(z), 5);
  });

  it('fills the sphere evenly with each colour in its own patch and linked nodes side by side, the same way every time', () => {
    // Four departments of mixed files: notes, images, code and skills, in folders, so every colour
    // is spread across departments and only the layout can bring it together. Notes link in a
    // chain of five inside each folder, and the first note of each folder links to a skill.
    const nodes: ReturnType<typeof node>[] = []; const edges: [number, number, string][] = []; const skills: number[] = [];
    for (let d = 0; d < 4; d++) {
      const dept = nodes.push(node('d' + d, 'Dept ' + d, 'dept', -1, { layer: 'dept' })) - 1;
      for (let s = 0; s < 3; s++) skills.push(nodes.push(node(`d${d}s${s}`, `skill ${s}`, 'skill', dept, { layer: 'skill' })) - 1);
      for (let f = 0; f < 5; f++) {
        const folder = nodes.push(node(`d${d}f${f}`, `folder ${f}`, 'folder', dept)) - 1; let previous = -1;
        for (let k = 0; k < 5; k++) { const note = nodes.push(node(`d${d}f${f}n${k}`, `n${k}.md`, 'note', folder)) - 1; if (previous >= 0) edges.push([previous, note, 'mention']); previous = note; if (k === 0) edges.push([note, skills[(d * 5 + f) % skills.length], 'skill']); }
        for (let k = 0; k < 5; k++) nodes.push(node(`d${d}f${f}i${k}`, `i${k}.png`, 'image', folder));
        for (let k = 0; k < 5; k++) nodes.push(node(`d${d}f${f}c${k}`, `c${k}.ts`, 'code', folder));
      }
    }
    const model = buildModel({ roots, nodes, edges }); const { pos } = sphereLayout(model); const n = model.nodes.length;
    const at = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const apart = (i: number, j: number) => Math.acos(Math.max(-1, Math.min(1, at(i).reduce((x, v, a) => x + v * at(j)[a], 0))));
    for (let i = 0; i < n; i++) expect(Math.hypot(...at(i))).toBeCloseTo(1, 5);
    let closest = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) closest = Math.min(closest, Math.hypot(at(i)[0] - at(j)[0], at(i)[1] - at(j)[1], at(i)[2] - at(j)[2]));
    expect(closest).toBeGreaterThan(0.02); // no two share a point: the lattice spacing here is about 0.2
    // Even: the centroid of every node sits near the sphere's centre, where a lopsided layout would pull it off.
    const mean = [0, 1, 2].map(a => Array.from({ length: n }, (_, i) => pos[i * 3 + a]).reduce((x, y) => x + y, 0) / n);
    expect(Math.hypot(...mean)).toBeLessThan(0.05);
    // By colour: same-colour pairs sit much closer on average than pairs of two colours (a layout
    // blind to colour scores about 1 here). Three colours hold 30% of the sphere each, which is what
    // bounds the ratio, so each colour is also held to the ideal: no more spread than the same number
    // of lattice points in one round cap.
    const colour = model.nodes.map(colorOf); let same = 0, sameCount = 0, other = 0, otherCount = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (colour[i] === colour[j]) { same += apart(i, j); sameCount++; } else { other += apart(i, j); otherCount++; } }
    expect(same / sameCount).toBeLessThan(0.62 * other / otherCount);
    const lattice = fibonacci(n); const byHeight = lattice.map((_, k) => k).sort((a, b) => lattice[b][1] - lattice[a][1]);
    const spread = (points: number[][]) => { let sum = 0, count = 0; for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) { sum += Math.acos(Math.max(-1, Math.min(1, points[a][0] * points[b][0] + points[a][1] * points[b][1] + points[a][2] * points[b][2]))); count++; } return count ? sum / count : 0; };
    for (const c of new Set(colour)) { const mine = colour.flatMap((x, i) => x === c ? [i] : []); expect(spread(mine.map(at)), c).toBeLessThan(1.1 * spread(byHeight.slice(0, mine.length).map(k => lattice[k]))); }
    // By reference: linked pairs sit closer on average than unlinked ones, and closer than same-colour pairs in general.
    const linked = new Set(edges.map(([a, b]) => a * n + b)); let link = 0, unlinked = 0, unlinkedCount = 0;
    for (const [a, b] of edges) link += apart(a, b);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!linked.has(i * n + j) && !linked.has(j * n + i)) { unlinked += apart(i, j); unlinkedCount++; }
    expect(link / edges.length).toBeLessThan(0.5 * unlinked / unlinkedCount);
    expect(link / edges.length).toBeLessThan(same / sameCount);
    // Deterministic: a second run lands every node on the same point.
    expect(Array.from(sphereLayout(buildModel({ roots, nodes, edges })).pos)).toEqual(Array.from(pos));
  });

  it('draws each link as a great-circle arc: the ends kept, the middle on or above the surface, never through the centre', () => {
    const unit = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as [number, number, number]; };
    const pairs: [[number, number, number], [number, number, number]][] = [[unit(1, 0, 0), unit(0, 1, 0)], [unit(1, 2, 3), unit(-2, 0.5, 1)], [unit(0, 0, 1), unit(0.01, 0, 1)], [unit(1, 0, 0), unit(-1, 0, 0)], [unit(0, 0, 1), unit(0, 0, -1)]];
    for (const [a, b] of pairs) {
      const mid = arcMid(...a, ...b); const r = Math.hypot(...mid);
      expect(r).toBeGreaterThanOrEqual(1 - 1e-9); expect(r).toBeLessThanOrEqual(1 + ARC_LIFT + 1e-9);
      // The curve through it: t = 0 and 1 are the ends, t = 0.5 is the lifted midpoint, and no sample dips inside the sphere far enough to cross its middle.
      for (let axis = 0; axis < 3; axis++) { expect(curveAt(a[axis], mid[axis], b[axis], 0)).toBeCloseTo(a[axis], 9); expect(curveAt(a[axis], mid[axis], b[axis], 1)).toBeCloseTo(b[axis], 9); expect(curveAt(a[axis], mid[axis], b[axis], 0.5)).toBeCloseTo(mid[axis], 9); }
      for (let t = 0; t <= 1; t += 0.05) expect(Math.hypot(...[0, 1, 2].map(axis => curveAt(a[axis], mid[axis], b[axis], t)))).toBeGreaterThan(0.5);
    }
    // Precomputed once per layout: one midpoint per edge.
    const layout = sphereLayout(buildModel(grouped)); expect(layout.mid.length).toBe(grouped.edges.length * 3);
    const [a, b] = grouped.edges[0]; const expected = arcMid(layout.pos[a * 3], layout.pos[a * 3 + 1], layout.pos[a * 3 + 2], layout.pos[b * 3], layout.pos[b * 3 + 1], layout.pos[b * 3 + 2]);
    expected.forEach((v, axis) => expect(layout.mid[axis]).toBeCloseTo(v, 5));
  });

  it('skips the load-in under reduced motion and staggers it otherwise, and the messages never exceed their cap', () => {
    expect(intro(0, true)).toEqual({ node: 1, edge: 1 }); expect(nodeProgress(0, 5, true)).toBe(1);
    expect(intro(0, false)).toEqual({ node: 0, edge: 0 }); expect(nodeProgress(0, 5, false)).toBe(0);
    expect(intro(600, false).node).toBeCloseTo(0.5, 5); expect(intro(600, false).edge).toBe(0); expect(intro(1200, false).edge).toBeLessThan(1); expect(intro(1620, false).edge).toBe(1);
    expect(nodeProgress(1200, 36, false)).toBe(1);
    const messages = new Messages(40, 1000); const edges = grouped.edges;
    for (let step = 0; step < 200; step++) { messages.tick(step % 3 === 0 ? 5000 : 40, edges); expect(messages.live.length).toBeLessThanOrEqual(40); for (const p of messages.live) { expect(p.t).toBeLessThan(1); expect(edges[p.edge]).toBeDefined(); } }
    expect(messages.live.length).toBe(40); // the cap is reached at this rate, so it was the cap that held
    messages.tick(20000, edges); expect(messages.live.length).toBeLessThanOrEqual(40);
    expect(new Messages(40, 5).tick(1000, []) ?? new Messages(40, 5).live.length).toBe(0);
  });

  it('draws the final picture on the first frame under reduced motion: every node at its projected place, edges included', async () => {
    await ready();
    expect(window.__sphere!.renders()).toBe(1);
    expect(window.__sphere!.intro()).toEqual({ node: 1, edge: 1 });
    const model = buildModel(grouped); const { pos } = sphereLayout(model); const R = Math.min(800, 600) * RADIUS;
    for (let i = 0; i < model.nodes.length; i++) {
      const persp = PERSPECTIVE / (PERSPECTIVE - pos[i * 3 + 2]); const x = 400 + pos[i * 3] * R * persp, y = 300 - pos[i * 3 + 1] * R * persp;
      expect(firstFrame.some(([ax, ay]) => Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01), `${model.nodes[i].name} drawn at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBe(true);
    }
    expect(window.__sphere!.particles()).toBe(0);
  });

  it('a drag orbits the sphere and leaves every node where it sits on it; a click selects, the background clears', async () => {
    const canvas = await ready();
    const before = Array.from(window.__sphere!.positions()); const rotBefore = window.__sphere!.camera().rot; const readmeBefore = window.__sphere!.screenOf('README.md')!;
    pointer(canvas, 'pointerdown', 300, 300); pointer(canvas, 'pointermove', 340, 320); pointer(canvas, 'pointermove', 420, 360); pointer(canvas, 'pointerup', 420, 360);
    await frame();
    expect(Array.from(window.__sphere!.positions())).toEqual(before);
    expect(window.__sphere!.camera().rot).not.toEqual(rotBefore);
    expect(window.__sphere!.screenOf('README.md')).not.toEqual(readmeBefore); // it turned on screen
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(); // a drag is not a click
    await clickNode(canvas, 'README.md');
    expect(window.__sphere!.selected()).toMatch(/README\.md$/);
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    expect(await within(panel).findByRole('heading', { level: 2, name: 'README.md' })).toBeInTheDocument();
    expect(Array.from(window.__sphere!.positions())).toEqual(before);
    pointer(canvas, 'pointerdown', 5, 5); pointer(canvas, 'pointerup', 5, 5); await frame();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull());
  });

  // 2026-09-29: the File and Tree tabs are gone. The tree is open on the right by default and a file
  // takes its place with a Back to the tree button, so the tab checks became checks of that swap.
  it('opens a file in the tree\'s place over the right edge, Back returns to the tree, and Escape closes the file and returns focus to the globe', async () => {
    const user = userEvent.setup(); const canvas = await ready();
    expect(within(screen.getByRole('complementary', { name: 'Tree' })).getByRole('tree')).toBeInTheDocument(); // open by default
    await clickNode(canvas, 'README.md');
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    await within(panel).findByRole('heading', { level: 2, name: 'README.md' });
    expect(screen.queryByRole('complementary', { name: 'Tree' })).toBeNull(); // in its place, never beside it
    await user.click(within(panel).getByRole('button', { name: 'Back to the tree' }));
    expect(within(screen.getByRole('complementary', { name: 'Tree' })).getByRole('tree')).toBeInTheDocument();
    await clickNode(canvas, 'README.md'); await screen.findByRole('complementary', { name: 'Details' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull());
    expect(document.activeElement).toBe(canvas);
    expect(window.__sphere!.selected()).toBe('');
    expect(screen.getByRole('complementary', { name: 'Tree' })).toBeInTheDocument(); // the tree is back
  });

  it('a grouped node lists the files inside it, each with Open and Reveal, and one of them opens in the viewer', async () => {
    const user = userEvent.setup(); const canvas = await ready();
    await clickNode(canvas, IMAGES);
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    expect(within(panel).getByRole('heading', { level: 2, name: IMAGES })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Open a.png on device' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Reveal b.png in Explorer' })).toBeInTheDocument();
    expect(requests.some(r => r.url.includes('/graph/open'))).toBe(false);
    await user.click(within(panel).getByRole('button', { name: 'Reveal a.png in Explorer' }));
    await waitFor(() => expect(requests.filter(r => r.url.includes('/graph/open')).map(r => r.body)).toEqual([{ id: 'a', reveal: true }]));
    expect(notify).toHaveBeenCalledWith('Revealed a.png in Explorer');
    await user.click(within(panel).getByRole('button', { name: /^a\.png/ }));
    expect(await within(panel).findByRole('img', { name: 'a.png' })).toHaveAttribute('src', '/api/graph/file?id=a');
    expect(window.__sphere!.selected()).toBe(IMAGES); // the file's group is what is selected on the globe
    // The tree reaches a folded file too: its group lights on the globe. 2026-09-29: the Tree tab is
    // Back to the tree now, and Enter opens the file in the tree's place, so the selection is read
    // from typing alone, which selects the top match as it goes.
    await user.click(within(panel).getByRole('button', { name: 'Back to the tree' }));
    const tree = screen.getByRole('complementary', { name: 'Tree' });
    await user.keyboard('b.png');
    await waitFor(() => expect(within(tree).getByRole('treeitem', { name: /b\.png/ })).toHaveAttribute('aria-selected', 'true'));
    expect(window.__sphere!.selected()).toBe(IMAGES);
  });

  it('asks for the grouped graph with the signature of the build it holds, and lists every source with its count', async () => {
    await ready();
    expect(requests.filter(r => r.url.includes('/graph/grouped')).map(r => new URL(r.url, 'http://x').searchParams.get('signature'))).toEqual(['sig1']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Key' })); // 2026-09-28: the key opens from its button
    const key = screen.getByRole('dialog', { name: 'Key' });
    expect(key.textContent).toContain('Notes1'); expect(key.textContent).toContain('Images2'); expect(key.textContent).toContain('Code and files1'); expect(key.textContent).toContain('Skills1'); expect(key.textContent).toContain('Folders3');
    expect(window.__sphere!.count).toBe(grouped.nodes.length);
  });
});

// 2026-09-28: around the globe, a title revealed by a block wipe and hidden with its eye, the key in
// a popover off a button at the right edge, the categories down the left, and a search that also runs
// the two upkeep skills.
describe('around the globe', () => {
  beforeEach(() => { localStorage.clear(); });

  it('reveals a line with a block wipe, and under reduced motion shows the text at once with no block', () => {
    const { unmount } = render(<TextReveal text="Second Brain"/>); // tests/setup.ts: reduced motion
    expect(screen.getByRole('heading', { level: 1, name: 'Second Brain' })).toBeInTheDocument();
    expect(screen.queryByTestId('text-reveal-block')).toBeNull();
    unmount();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<TextReveal text="Second Brain" as="h2" delay={0.2}/>);
    const heading = screen.getByRole('heading', { level: 2, name: 'Second Brain' });
    expect(heading).toHaveClass('text-reveal-animated');
    expect(heading.style.getPropertyValue('--reveal-delay')).toBe('0.2s'); expect(heading.style.getPropertyValue('--reveal-duration')).toBe('1.2s');
    expect(heading.style.getPropertyValue('--reveal-color')).toBe('var(--acc)');
    expect(screen.getByTestId('text-reveal-block')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides the title with its eye, keeps it as the one h1 for screen readers, and remembers the choice', async () => {
    const user = userEvent.setup(); await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Second Brain' })).not.toHaveClass('sr-only');
    await user.click(screen.getByRole('button', { name: 'Hide title' }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Second Brain' })).toHaveClass('sr-only');
    expect(localStorage.getItem('home.title')).toBe('hidden');
    cleanup(); await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Second Brain' })).toHaveClass('sr-only');
    await user.click(screen.getByRole('button', { name: 'Show title' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Second Brain' })).not.toHaveClass('sr-only');
    expect(localStorage.getItem('home.title')).toBe('shown');
  });

  it('opens the key from its button, and closes it with Escape, a second click, or a click outside', async () => {
    const user = userEvent.setup(); const canvas = await ready();
    const button = screen.getByRole('button', { name: 'Key' });
    expect(screen.queryByRole('dialog', { name: 'Key' })).toBeNull(); expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'Key' }).textContent).toContain('Notes1'); expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Key' })).toBeNull(); expect(document.activeElement).toBe(button);
    await user.click(button); await user.click(button);
    expect(screen.queryByRole('dialog', { name: 'Key' })).toBeNull();
    await user.click(button); await user.click(canvas);
    expect(screen.queryByRole('dialog', { name: 'Key' })).toBeNull();
    // With the detail panel open, the key stands left of it, and Escape with the key open closes the key alone.
    await clickNode(canvas, 'README.md'); await screen.findByRole('complementary', { name: 'Details' });
    expect(button.parentElement).toHaveClass('home-right-shifted');
    await user.click(button); await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Key' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
  });

  it('lists the categories with how much each holds, lights one on the globe on a click, and remembers being closed', async () => {
    const user = userEvent.setup(); await ready();
    const panel = screen.getByRole('complementary', { name: 'Categories' });
    const rows = within(panel).getAllByRole('button', { pressed: false });
    expect(rows.map(row => row.textContent)).toEqual(['Chemistry apps7', 'Skills1']); // every file and folder inside, biggest first
    await user.click(rows[0]);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(window.__sphere!.selected()).toBe('Chemistry apps'));
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(); // a bearing, not a file
    await user.click(rows[0]);
    await waitFor(() => expect(window.__sphere!.selected()).toBe(''));
    await user.click(within(panel).getByRole('button', { name: 'Categories' }));
    expect(within(panel).queryByRole('list')).toBeNull(); expect(localStorage.getItem('home.categories')).toBe('closed');
    cleanup(); await ready();
    expect(within(screen.getByRole('complementary', { name: 'Categories' })).getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('searches the workspace from the page and offers the two runs; / focuses it, a file opens, Run Clean up starts the run', async () => {
    const user = userEvent.setup(); await ready();
    const field = screen.getByRole('combobox', { name: 'Search the workspace or run a command' });
    await user.keyboard('/'); expect(document.activeElement).toBe(field);
    await user.keyboard('read');
    const options = () => screen.getAllByRole('option').map(option => option.textContent);
    expect(options()[0]).toMatch(/^README\.md/);
    expect(options().filter(text => /^Run (Clean up|Doctor plus)/.test(text || ''))).toHaveLength(2);
    await user.keyboard('{Escape}'); expect(field).toHaveValue('');
    await user.type(field, 'read{Enter}');
    const details = await screen.findByRole('complementary', { name: 'Details' });
    expect(await within(details).findByRole('heading', { level: 2, name: 'README.md' })).toBeInTheDocument();
    await user.click(field); await user.keyboard('clean');
    await user.click(screen.getByRole('option', { name: /Run Clean up/ }));
    await waitFor(() => expect(requests.filter(r => r.url === '/api/run').map(r => r.body)).toEqual([{ id: 'clean-up' }]));
    const card = screen.getByRole('region', { name: 'Clean up run' });
    await waitFor(() => expect(requests.some(r => r.url === '/api/tasks')).toBe(true)); // it polls the run, as the Skills page does
    expect(within(card).getByRole('link', { name: /full run on Skills/ })).toHaveAttribute('href', '#skills');
    await user.click(within(card).getByRole('button', { name: 'Dismiss run' }));
    expect(screen.queryByRole('region', { name: 'Clean up run' })).toBeNull();
  });
});

// Today at a glance (HomeToday.tsx): the tab at the bottom left and the card it opens in the
// categories' place, with today's todos, the next calendar item and a quick capture.
describe('today at a glance', () => {
  beforeEach(() => { localStorage.clear(); });
  const tab = () => screen.getByRole('button', { name: 'Today at a glance' });
  const card = () => screen.queryByRole('complementary', { name: 'Today at a glance' });

  it('opens from its tab in the categories place, and Escape or the tab again closes it with focus back on the tab', async () => {
    const user = userEvent.setup(); await ready();
    expect(card()).toBeNull(); expect(tab()).toHaveAttribute('aria-expanded', 'false');
    await user.click(tab());
    expect(card()).toBeInTheDocument(); expect(tab()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('complementary', { name: 'Categories' })).toBeNull();
    await user.click(within(card()!).getByRole('textbox', { name: 'Quick capture' }));
    await user.keyboard('{Escape}');
    expect(card()).toBeNull(); expect(document.activeElement).toBe(tab());
    expect(screen.getByRole('complementary', { name: 'Categories' })).toBeInTheDocument();
    await user.click(tab()); await user.click(tab());
    expect(card()).toBeNull(); expect(document.activeElement).toBe(tab());
  });

  it('ticks a todo through commit, and the tick is still there on the next visit', async () => {
    const user = userEvent.setup(); await ready();
    await user.click(tab());
    const box = within(card()!).getByRole('checkbox', { name: 'Read chapter 4' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(stored.todos!.items).toEqual([{ id: 't1', text: 'Read chapter 4', done: true, category: 'other' }]);
    cleanup(); await ready();
    expect(within(card()!).getByRole('checkbox', { name: 'Read chapter 4' })).toBeChecked();
  });

  it('saves a quick capture with Save or Ctrl+Enter, and clears the box once it is saved', async () => {
    const user = userEvent.setup(); await ready();
    await user.click(tab());
    const box = within(card()!).getByRole('textbox', { name: 'Quick capture' });
    const save = within(card()!).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(box, '  Ask about the lab  '); await user.click(save);
    expect(capture).toHaveBeenLastCalledWith('Ask about the lab'); await waitFor(() => expect(box).toHaveValue(''));
    await user.type(box, 'Second thought'); await user.keyboard('{Control>}{Enter}{/Control}');
    expect(capture).toHaveBeenLastCalledWith('Second thought'); await waitFor(() => expect(box).toHaveValue(''));
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('remembers being open in this browser', async () => {
    const user = userEvent.setup(); await ready();
    await user.click(tab());
    expect(localStorage.getItem('home.today')).toBe('open');
    cleanup(); await ready();
    expect(card()).toBeInTheDocument();
    await user.click(tab());
    expect(localStorage.getItem('home.today')).toBe('closed');
  });

  it('shows the next calendar item only when a calendar is connected', async () => {
    const user = userEvent.setup(); await ready();
    await user.click(tab());
    await waitFor(() => expect(requests.some(r => r.url === '/api/calendar/status')).toBe(true)); await frame();
    expect(card()!.querySelector('.home-today-next')).toBeNull();
    expect(requests.some(r => r.url.includes('/api/calendar/events'))).toBe(false);
    cleanup();
    const at = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
    calendar = { connected: true, events: [
      { id: 'later', title: 'Office hours', start: at(30), end: at(31), allDay: false },
      { id: 'past', title: 'Breakfast', start: at(-3), end: at(-2), allDay: false },
      { id: 'soon', title: 'CMSC423 lecture', start: at(2), end: at(3), allDay: false },
    ] };
    await ready();
    expect(await within(card()!).findByText('CMSC423 lecture')).toBeInTheDocument();
    expect(card()!.textContent).not.toContain('Office hours'); expect(card()!.textContent).not.toContain('Breakfast');
  });
});

// 2026-09-29: the tree stays open on the right, resizable from a handle on its left edge and closed
// with its X, and the Tree button at the top right brings it back. All of it is remembered.
describe('the side panel', () => {
  beforeEach(() => { localStorage.clear(); });
  const handle = () => screen.getByRole('separator', { name: 'Resize the side panel' });

  it('resizes from the keyboard in 24 px steps between 260 px and 60% of the window, and remembers the width', async () => {
    const user = userEvent.setup(); await ready(); // jsdom's window is 1024 wide, so 60% is 614
    expect(handle()).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle()).toHaveAttribute('aria-valuenow', '380');
    handle().focus(); await user.keyboard('{ArrowLeft}');
    expect(handle()).toHaveAttribute('aria-valuenow', '404'); expect(localStorage.getItem('home.panelWidth')).toBe('404');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle()).toHaveAttribute('aria-valuenow', '356');
    await user.keyboard('{Home}'); expect(handle()).toHaveAttribute('aria-valuenow', '260');
    await user.keyboard('{ArrowRight}'); expect(handle()).toHaveAttribute('aria-valuenow', '260'); // never narrower
    await user.keyboard('{End}'); expect(handle()).toHaveAttribute('aria-valuenow', '614');
    await user.keyboard('{ArrowLeft}'); expect(handle()).toHaveAttribute('aria-valuenow', '614'); // never wider
    await user.keyboard('{ArrowRight}');
    expect((document.querySelector('.home') as HTMLElement).style.getPropertyValue('--panel-w')).toBe('590px');
    cleanup(); await ready();
    expect(handle()).toHaveAttribute('aria-valuenow', '590');
  });

  it('resizes by dragging the handle, wider to the left, and saves the width once the drag ends', async () => {
    await ready();
    const move = (type: string, x: number) => act(() => { (type === 'pointerdown' ? handle() : window).dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 300, bubbles: true, button: 0 })); });
    await move('pointerdown', 640); await move('pointermove', 540);
    expect(handle()).toHaveAttribute('aria-valuenow', '480');
    expect(localStorage.getItem('home.panelWidth')).toBeNull(); // not on every move
    await move('pointermove', 900); expect(handle()).toHaveAttribute('aria-valuenow', '260'); // clamped
    await move('pointermove', 600); await move('pointerup', 600);
    expect(handle()).toHaveAttribute('aria-valuenow', '420'); expect(localStorage.getItem('home.panelWidth')).toBe('420');
    await move('pointermove', 100); expect(handle()).toHaveAttribute('aria-valuenow', '420'); // the drag is over
  });

  it('closes the tree with its X, reopens it from the Tree button at the top right, and remembers which', async () => {
    const user = userEvent.setup(); await ready();
    const button = screen.getByRole('button', { name: 'Tree' });
    expect(button).toHaveAttribute('aria-pressed', 'true'); expect(button.parentElement).toHaveClass('home-right', 'home-right-shifted');
    await user.click(within(screen.getByRole('complementary', { name: 'Tree' })).getByRole('button', { name: 'Close the tree' }));
    expect(screen.queryByRole('complementary', { name: 'Tree' })).toBeNull(); expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.parentElement).not.toHaveClass('home-right-shifted'); expect(localStorage.getItem('home.tree')).toBe('closed');
    cleanup(); await ready();
    expect(screen.queryByRole('complementary', { name: 'Tree' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tree' }));
    expect(within(screen.getByRole('complementary', { name: 'Tree' })).getByRole('tree')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search files' })); // opened on purpose, so the filter takes the keys
    expect(localStorage.getItem('home.tree')).toBe('open');
    // With a file showing, the Tree button brings the tree back in its place.
    await clickNode(document.querySelector('canvas')!, 'README.md'); await screen.findByRole('complementary', { name: 'Details' });
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByRole('complementary', { name: 'Tree' })).toBeInTheDocument(); expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  });

  it('never takes focus from the page when the tree is simply open on load', async () => {
    await ready();
    expect(screen.getByRole('complementary', { name: 'Tree' })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Search files' }));
  });
});

// 2026-09-29: the flat view, after the graph view in RoboNuggets' second brain (GraphCanvas2D.tsx over lib/force.ts).
describe('the flat graph', () => {
  beforeEach(() => { localStorage.clear(); });
  // Three colours of 60 nodes, each linked in chains of six, and a few links across colours.
  const fixture = () => {
    const group: number[] = []; const edges: [number, number][] = [];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 60; k++) { const i = group.push(c) - 1; if (k % 6) edges.push([i - 1, i]); if (k % 15 === 0 && c) edges.push([i, i - 60]); }
    return { group, edges, n: group.length };
  };

  it('settles within its step budget and comes to rest', () => {
    const { group, edges, n } = fixture(); const f = settle(createForce(n, edges, group, 3));
    expect(settled(f)).toBe(true); expect(f.steps).toBeLessThanOrEqual(400);
    for (let i = 0; i < n; i++) { expect(Number.isFinite(f.x[i]) && Number.isFinite(f.y[i])).toBe(true); expect(Math.hypot(f.vx[i], f.vy[i])).toBeLessThan(0.1); }
  });

  it('pulls each colour into its own clump, keeps links short, and leaves no two nodes on one spot', () => {
    const { group, edges, n } = fixture(); const f = settle(createForce(n, edges, group, 3));
    const d = (i: number, j: number) => Math.hypot(f.x[i] - f.x[j], f.y[i] - f.y[j]);
    let same = 0, sameCount = 0, other = 0, otherCount = 0, closest = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { closest = Math.min(closest, d(i, j)); if (group[i] === group[j]) { same += d(i, j); sameCount++; } else { other += d(i, j); otherCount++; } }
    expect(same / sameCount).toBeLessThan(0.6 * other / otherCount);
    const link = edges.reduce((sum, [a, b]) => sum + d(a, b), 0) / edges.length;
    expect(link).toBeLessThan(0.5 * same / sameCount);
    expect(closest).toBeGreaterThan(2);
  });

  it('lands the same way for the same seed, and another way for another', () => {
    const { group, edges, n } = fixture();
    const a = settle(createForce(n, edges, group, 3)), b = settle(createForce(n, edges, group, 3)), c = settle(createForce(n, edges, group, 4));
    expect(Array.from(a.x)).toEqual(Array.from(b.x)); expect(Array.from(a.y)).toEqual(Array.from(b.y));
    expect(Array.from(a.x)).not.toEqual(Array.from(c.x));
  });

  it('switches views from the 3D / 2D toggle, remembers the view, draws the settled graph once, and a click on a node opens the same detail panel', async () => {
    const user = userEvent.setup(); await ready();
    const views = screen.getByRole('group', { name: 'View' });
    expect(within(views).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(views).getByRole('button', { name: '2D' }));
    expect(within(views).getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true'); expect(localStorage.getItem('home.view')).toBe('2d');
    await waitFor(() => expect(window.__graph2d?.renders()).toBeGreaterThan(0));
    expect(window.__sphere).toBeUndefined();
    expect(window.__graph2d!.settled()).toBe(true); expect(window.__graph2d!.renders()).toBe(1); // reduced motion: settled first, drawn once, no loop
    await frame(); expect(window.__graph2d!.renders()).toBe(1); // and nothing runs while idle
    const canvas = document.querySelector('canvas')!; expect(canvas).toHaveAccessibleName(/flat graph/);
    const at = window.__graph2d!.screenOf('README.md')!; pointer(canvas, 'pointerdown', at.x, at.y); pointer(canvas, 'pointerup', at.x, at.y); await frame();
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    expect(await within(panel).findByRole('heading', { level: 2, name: 'README.md' })).toBeInTheDocument();
    // A wheel zooms about the pointer: the world point under it stays put.
    const before = window.__graph2d!.screenOf('README.md')!; const k = window.__graph2d!.camera().k;
    act(() => { canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: before.x, clientY: before.y, bubbles: true, cancelable: true })); });
    const after = window.__graph2d!.screenOf('README.md')!;
    expect(window.__graph2d!.camera().k).toBeCloseTo(k * Math.exp(200 * 0.0016), 5); expect(after.x).toBeCloseTo(before.x, 3); expect(after.y).toBeCloseTo(before.y, 3);
    cleanup();
    render(<Home notify={notify} openMenu={() => {}} openSearch={() => {}} newDoc={() => {}} workspace={stored} commit={commit} capture={capture}/>);
    await waitFor(() => expect(window.__graph2d?.renders()).toBeGreaterThan(0)); // remembered
    await user.click(screen.getByRole('button', { name: '3D' }));
    await waitFor(() => expect(window.__sphere?.renders()).toBeGreaterThan(0));
    expect(window.__graph2d).toBeUndefined(); expect(localStorage.getItem('home.view')).toBe('3d');
  });
});

describe('the front door is the globe', () => {
  it('opens on the globe with the navigation behind the burger, and Today lives in the navigation', async () => {
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('button', { name: 'Capture a thought' });
    expect(await screen.findByRole('button', { name: 'Key' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Today' })).toBeNull();
    expect(document.querySelector('.app-shell')).toHaveClass('app-home');
    expect(document.querySelector('.sidebar')).not.toHaveClass('sidebar-open');
    await user.click(screen.getAllByRole('button', { name: 'Open navigation' }).find(b => b.classList.contains('home-burger'))!);
    expect(document.querySelector('.sidebar')).toHaveClass('sidebar-open');
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(location.hash).toBe('#agenda');
    expect(document.querySelector('.app-shell')).not.toHaveClass('app-home');
    location.hash = '#today';
    expect(await screen.findByRole('button', { name: 'Key' })).toBeInTheDocument();
  });
});
