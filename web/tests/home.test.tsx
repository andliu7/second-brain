// The home page: the grouped graph on a globe (SphereCanvas.tsx over lib/sphere.ts), the key,
// the burger, and the detail panel over the right edge. The canvas gets a recording 2D context
// here, so what the first frame drew is measured; every test runs under prefers-reduced-motion
// (tests/setup.ts stubs matchMedia to match), so nothing moves unless the pointer moves it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from '../src/Home';
import App from '../src/App';
import { PERSPECTIVE, RADIUS } from '../src/SphereCanvas';
import { buildModel } from '../src/lib/network';
import { fibonacci, intro, Messages, nodeProgress, sphereLayout, toFront, apply, turn, identity } from '../src/lib/sphere';

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
// A 2D context that records every dot drawn, whether a stamped disc (drawImage) or an arc: the
// ones of the first frame are kept apart.
function context() {
  const dot = (x: number, y: number, r: number) => { arcs.push([x, y, r]); if (!window.__sphere || window.__sphere.renders() === 0) firstFrame.push([x, y, r]); };
  const ctx: any = { canvas: null, measureText: (text: string) => ({ width: text.length * 6 }), arc: dot, drawImage: (_: unknown, x: number, y: number, w: number, h: number) => dot(x + w / 2, y + h / 2, w / 2 - 1) };
  return new Proxy(ctx, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
}
beforeEach(() => {
  requests = []; arcs = []; firstFrame = []; notify.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context());
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 600; } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) : undefined; requests.push({ url: path, body });
    const params = new URL(path, 'http://localhost').searchParams;
    const reply = path.includes('/graph/node') ? details[params.get('id')!] : path.includes('/graph/grouped') ? (params.get('signature') === 'sig1' ? grouped : { error: 'wrong signature' }) : path.includes('/graph/open') ? { ok: true, reveal: body?.reveal } : path.endsWith('/graph') ? full
      : path.endsWith('/status') ? { local: true, authRequired: false, providers: {}, models: {} } : path.endsWith('/projects') ? { repos: [], courses: [], blueberry: null, routines: [] } : path.endsWith('/tasks') ? { tasks: [] } : path.endsWith('/skills') ? { skills: [] } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  location.hash = '';
});
afterEach(() => { delete (HTMLElement.prototype as any).clientWidth; delete (HTMLElement.prototype as any).clientHeight; });
const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
async function ready() {
  render(<Home notify={notify} openMenu={() => {}} openSearch={() => {}} newDoc={() => {}}/>);
  await screen.findByRole('complementary', { name: 'Sources' });
  await waitFor(() => expect(window.__sphere?.renders()).toBeGreaterThan(0));
  return document.querySelector('canvas') as HTMLCanvasElement;
}
const pointer = (canvas: HTMLCanvasElement, type: string, x: number, y: number) => { const Ctor = (window as any).PointerEvent || MouseEvent; canvas.dispatchEvent(new Ctor(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1 })); };
const clickNode = async (canvas: HTMLCanvasElement, name: string) => { const at = window.__sphere!.screenOf(name)!; expect(at).not.toBeNull(); pointer(canvas, 'pointerdown', at.x, at.y); pointer(canvas, 'pointerup', at.x, at.y); await frame(); };

describe('the globe', () => {
  it('lays every department on a Fibonacci sphere and its members on a cap around it, all on the unit sphere', () => {
    const model = buildModel(grouped); const { pos, scatter } = sphereLayout(model);
    for (let i = 0; i < model.nodes.length; i++) expect(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])).toBeCloseTo(1, 5);
    const centres = fibonacci(2); expect(Math.hypot(pos[0] - centres[0][0], pos[1] - centres[0][1], pos[2] - centres[0][2])).toBeLessThan(1e-5);
    const dot = (i: number, j: number) => pos[i * 3] * pos[j * 3] + pos[i * 3 + 1] * pos[j * 3 + 1] + pos[i * 3 + 2] * pos[j * 3 + 2];
    expect(dot(2, 0)).toBeGreaterThan(Math.cos(0.6)); // README sits within its department's cap
    expect(dot(4, 3)).toBeGreaterThan(Math.cos(0.6)); // generate within Skills
    expect(dot(2, 3)).toBeLessThan(dot(2, 0)); // and nearer its own department than the other
    for (let i = 0; i < model.nodes.length; i++) expect(Math.hypot(scatter[i * 3], scatter[i * 3 + 1], scatter[i * 3 + 2])).toBeGreaterThan(1.5); // the load-in starts well outside
    const front = toFront(turn(identity(), 0.7, -0.4), pos, 2); const rot = turn(identity(), 0.7, -0.4);
    const [, , z] = apply(rot, pos[6], pos[7], pos[8]); expect(front.angle).toBeCloseTo(Math.acos(z), 5);
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

  it('opens the detail panel over the right edge, and Escape closes it and returns focus to the globe', async () => {
    const user = userEvent.setup(); const canvas = await ready();
    await clickNode(canvas, 'README.md');
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    await within(panel).findByRole('heading', { level: 2, name: 'README.md' });
    expect(within(panel).getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(panel).getByRole('tab', { name: 'Tree' }));
    expect(within(panel).getByRole('tree')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull());
    expect(document.activeElement).toBe(canvas);
    expect(window.__sphere!.selected()).toBe('');
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
    // The tree reaches a folded file too: its group lights on the globe.
    await user.click(within(panel).getByRole('tab', { name: 'Tree' }));
    await user.keyboard('b.png{Enter}');
    expect(await within(panel).findByRole('treeitem', { name: /b\.png/ })).toHaveAttribute('aria-selected', 'true');
    expect(window.__sphere!.selected()).toBe(IMAGES);
  });

  it('asks for the grouped graph with the signature of the build it holds, and lists every source with its count', async () => {
    await ready();
    expect(requests.filter(r => r.url.includes('/graph/grouped')).map(r => new URL(r.url, 'http://x').searchParams.get('signature'))).toEqual(['sig1']);
    const key = screen.getByRole('complementary', { name: 'Sources' });
    expect(key.textContent).toContain('Notes1'); expect(key.textContent).toContain('Images2'); expect(key.textContent).toContain('Code and files1'); expect(key.textContent).toContain('Skills1'); expect(key.textContent).toContain('Folders3');
    expect(window.__sphere!.count).toBe(grouped.nodes.length);
  });
});

describe('the front door is the globe', () => {
  it('opens on the globe with the navigation behind the burger, and Today lives in the navigation', async () => {
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('button', { name: 'Capture a thought' });
    expect(await screen.findByRole('complementary', { name: 'Sources' })).toBeInTheDocument();
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
    expect(await screen.findByRole('complementary', { name: 'Sources' })).toBeInTheDocument();
  });
});
