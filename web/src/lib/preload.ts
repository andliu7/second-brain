// Preloading: fetch what a page needs before Andrew opens it, so the page sweep lands on a finished page
// (Andrew, 2026-09-29: "when I open up a new page, for example, some of the icons don't show up until a
// couple seconds after the sweep happens"). Three entry points:
//   preloadWhenIdle(): once the first page has settled, the main pages' lazy chunks, one per idle moment
//   preloadPage(page): on a nav button's hover or focus, or a command bar row's highlight; that page's
//     chunks and, where it is one cheap request, its first data
//   preloadOn(page): the hover and focus handlers for a nav button, to spread onto it
// and one for App: lazyPage(), which renders a preloaded page with no Suspense round trip.
//
// Why one import() per chunk, defined here: App's lazy pages call these same functions, so a chunk fetched
// early is the very module React asks for on navigation, and Vite's preload helper (which also fetches the
// chunk's CSS) wraps each call site the same way. A second import() of a loaded module is instant.
import { createElement, lazy, useState, type ComponentType } from 'react';
import { api } from './api';

// A loader that remembers its module once it has arrived, so lazyPage can render it synchronously.
type Loader<M> = (() => Promise<M>) & { loaded?: M };
function chunk<M>(load: () => Promise<M>): Loader<M> {
  const get: Loader<M> = () => load().then(module => (get.loaded = module));
  return get;
}

export const chunks = {
  home: chunk(() => import('../Home')),
  network: chunk(() => import('../Network')),
  docs: chunk(() => import('../Docs')),
  pdfTools: chunk(() => import('../PdfTools')),
  write: chunk(() => import('../Write')),
  // Lazy inside a page: Docs opens its editor (tiptap, 500 kB) and the Whiteboard its Drawnix canvas
  // (900 kB) behind their own Suspense, after the page itself has shown. Warming them here means the
  // page's inner spinner is gone before the sweep copies the page.
  docEditor: chunk(() => import('@/components/ui/doc-editor')),
  whiteboardCanvas: chunk(() => import('../WhiteboardCanvas')),
};
type ChunkName = keyof typeof chunks;

// The page ids are App's Page type; strings here, so this file does not import App's types.
const pageChunks: Record<string, ChunkName[]> = {
  today: ['home'], network: ['network'], docs: ['docs', 'docEditor'], draw: ['whiteboardCanvas'], pdf: ['pdfTools'], write: ['write'],
};
// The first request a page waits on, where App fetches it on arrival and it is one GET. Today and
// Projects read /api/projects; Skills reads /api/skills.
const pageData: Record<string, string> = { agenda: 'projects', projects: 'projects', skills: 'skills' };
// The main pages, in the order he tends to open them. PDF tools and Write are reached from Docs, so
// they load on a hover of their own rather than on every visit.
const idleOrder: ChunkName[] = ['docs', 'docEditor', 'whiteboardCanvas', 'home', 'network'];

// A failed preload is not an error: the navigation's own import() tries again and reports it there.
const quietly = (promise: Promise<unknown>) => promise.catch(() => {});

// One chunk per idle moment rather than all at once: importing a module also runs it, and five at once
// is one long task on the main thread. Returns a cancel, for a useEffect cleanup.
export function preloadWhenIdle(): () => void {
  const queue = [...idleOrder];
  let cancel = () => {};
  const next = () => {
    const name = queue.shift();
    if (!name) return;
    const run = () => { void chunks[name]().then(next, next); };
    // Safari has no requestIdleCallback; there a short timer stands in for it.
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(run, { timeout: 3000 }); cancel = () => cancelIdleCallback(id); }
    else { const id = window.setTimeout(run, 200); cancel = () => window.clearTimeout(id); }
  };
  next();
  warmFonts();
  return () => { queue.length = 0; cancel(); };
}

// The page headings are Libre Baskerville and code is JetBrains Mono; the home globe uses neither, so
// the first page opened from it would otherwise swap its heading font in after the sweep.
function warmFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const font of ['700 16px "Libre Baskerville"', '400 16px "Libre Baskerville"', '400 16px "JetBrains Mono Variable"']) void quietly(document.fonts.load(font));
}

// Data fetched on hover, kept for a few seconds so a click soon after uses it instead of asking again.
const FRESH_MS = 10_000;
const prefetched = new Map<string, { at: number; reply: Promise<unknown> }>();

function prefetchData(path: string) {
  const hit = prefetched.get(path);
  if (hit && Date.now() - hit.at < FRESH_MS) return;
  const reply = api(path);
  reply.catch(() => prefetched.delete(path));
  prefetched.set(path, { at: Date.now(), reply });
}

// App's loaders call this first: a fresh hovered reply if there is one (taken, so it is used once),
// else undefined and they fetch as before.
export function takePrefetched<T>(path: string): Promise<T> | undefined {
  const hit = prefetched.get(path);
  prefetched.delete(path);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.reply as Promise<T> : undefined;
}

export function preloadPage(page: string) {
  for (const name of pageChunks[page] || []) void quietly(chunks[name]());
  if (pageData[page]) prefetchData(pageData[page]);
}

export const preloadOn = (page: string) => ({ onPointerEnter: () => preloadPage(page), onFocus: () => preloadPage(page) });

// React.lazy, except that a page whose chunk has already arrived renders at once. Plain lazy() throws on
// its first render even when the module is cached, and React then keeps the Suspense fallback on screen
// for up to 300 ms (react-dom's fallback throttle) before swapping the page in: the spinner the sweep
// would otherwise wait on. The choice is made once per mount (useState's initialiser), because switching
// from the lazy wrapper to the component mid-life would be a different element type and remount the page.
export function lazyPage<M extends object, K extends keyof M>(load: Loader<M>, name: K): M[K] {
  const Lazy = lazy(() => load().then(module => ({ default: module[name] as ComponentType<object> })));
  function Page(props: object) {
    const [Shown] = useState(() => (load.loaded?.[name] as ComponentType<object> | undefined) ?? Lazy);
    return createElement(Shown, props);
  }
  return Page as M[K];
}
