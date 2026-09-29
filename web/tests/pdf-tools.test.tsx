import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { PdfTools, buildPamphlet, buildPdf, type Source } from '../src/PdfTools';
import { BLANK, fromShown, history, record, toShown, undo, type PageItem, type Rotation } from '../src/lib/pdf-pages';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { Workspace } from '../src/types';

// pdf.js only draws thumbnails, and jsdom has no canvas to draw on, so it is replaced by a stand-in whose
// render resolves at once. Everything that writes a PDF is the real pdf-lib.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 10 * scale, height: 10 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }) }) }),
}));
beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });

// A PDF of n pages, told apart by width: page i (from 1) is 300 + i points wide.
async function makePdf(n: number) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= n; i++) doc.addPage([300 + i, 400]).drawText(`Page ${i}`, { x: 20, y: 360, size: 18 });
  return new Uint8Array(await doc.save());  // an ArrayBuffer-backed copy, which is what File and Blob accept
}
const widths = (doc: PDFDocument) => doc.getPages().map(page => Math.round(page.getWidth()));
// A page's content streams, decoded and joined, to see what was drawn on it.
function contentOf(page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => page.doc.context.lookup(ref)) : [contents];
  return streams.map(stream => stream instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()) : '').join('\n');
}
const readBlob = (blob: Blob) => new Promise<Uint8Array>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.readAsArrayBuffer(blob); });
const lastDownload = async () => readBlob((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Blob);
const hex = (text: string) => [...text].map(ch => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

function Host({ initial, onCommit }: { initial: Workspace; onCommit?: (w: Workspace) => void }) {
  const current = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { const next = update(current.current); current.current = next; setWorkspace(next); onCommit?.(next); return true; };
  return <PdfTools workspace={workspace} commit={commit}/>;
}
const tiles = () => within(screen.getByRole('listbox', { name: 'Pages' })).getAllByRole('option');
const order = () => tiles().map(tile => tile.getAttribute('aria-label')!.replace(/^Page \d+: /, ''));

async function importPdf(user: ReturnType<typeof userEvent.setup>, n = 4, name = 'deck.pdf') {
  await user.upload(screen.getByLabelText('Choose PDF or image files'), new File([await makePdf(n)], name, { type: 'application/pdf' }));
  await waitFor(() => expect(tiles()).toHaveLength(n));
}

describe('PDF tools: organise pages', () => {
  it('imports a PDF, reorders with Alt+Right, swaps two, rotates, deletes, and undoes and redoes', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    expect(screen.getByText('Drop PDFs or images here')).toBeInTheDocument();
    await importPdf(user);
    expect(order()).toEqual(['deck.pdf page 1', 'deck.pdf page 2', 'deck.pdf page 3', 'deck.pdf page 4']);

    // Keyboard reorder: focus page 1, Alt+Right moves it after page 2, and focus stays on it.
    tiles()[0].focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(order()).toEqual(['deck.pdf page 2', 'deck.pdf page 1', 'deck.pdf page 3', 'deck.pdf page 4']);
    expect(document.activeElement).toBe(tiles()[1]);

    // "Flip the middle two": select positions 2 and 3, Swap.
    const swap = screen.getByRole('button', { name: 'Swap' });
    await user.click(tiles()[1]);
    expect(swap).toBeDisabled();
    await user.keyboard('{Control>}'); await user.click(tiles()[2]); await user.keyboard('{/Control}');
    expect(swap).toBeEnabled();
    await user.click(swap);
    expect(order()).toEqual(['deck.pdf page 2', 'deck.pdf page 3', 'deck.pdf page 1', 'deck.pdf page 4']);

    // Rotate one page right, then delete the last.
    await user.click(tiles()[0]);
    await user.click(screen.getByRole('button', { name: 'Rotate right' }));
    expect(order()[0]).toBe('deck.pdf page 2, rotated 90 degrees');
    await user.click(tiles()[3]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(tiles()).toHaveLength(3);

    // Undo brings the page back, undo again unrotates, redo rotates again.
    await user.keyboard('{Control>}z{/Control}');
    expect(tiles()).toHaveLength(4);
    await user.keyboard('{Control>}z{/Control}');
    expect(order()[0]).toBe('deck.pdf page 2');
    await user.keyboard('{Control>}y{/Control}');
    expect(order()[0]).toBe('deck.pdf page 2, rotated 90 degrees');

    // The download is the list as shown: widths 302, 303, 301, 304 and the first page turned.
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const saved = await PDFDocument.load(await lastDownload());
    expect(widths(saved)).toEqual([302, 303, 301, 304]);
    expect(saved.getPage(0).getRotation().angle).toBe(90);
  });

  it('Shift+click selects a run; a blank page is inserted after it; several files join in order; an image becomes a page', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    await importPdf(user, 2, 'a.pdf');
    await user.upload(screen.getByLabelText('Choose PDF or image files'), new File([await makePdf(1)], 'b.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(tiles()).toHaveLength(3));
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    await user.upload(screen.getByLabelText('Choose PDF or image files'), new File([png], 'dot.png', { type: 'image/png' }));
    await waitFor(() => expect(tiles()).toHaveLength(4));
    expect(order()).toEqual(['a.pdf page 1', 'a.pdf page 2', 'b.pdf page 1', 'dot.png page 1']);
    await user.click(tiles()[0]);
    await user.keyboard('{Shift>}'); await user.click(tiles()[2]); await user.keyboard('{/Shift}');
    expect(tiles().filter(tile => tile.getAttribute('aria-selected') === 'true')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Blank page' }));
    expect(order()).toEqual(['a.pdf page 1', 'a.pdf page 2', 'b.pdf page 1', 'blank', 'dot.png page 1']);
  });

  it('drag and drop moves a page before the tile it is dropped on', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    await importPdf(user, 3);
    const data = new Map<string, string>();
    const dataTransfer = { get types() { return [...data.keys()]; }, setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: 'move', files: [] };
    fireEvent.dragStart(tiles()[2], { dataTransfer });
    // jsdom lays nothing out, so every rect is zero-wide and the pointer (clientX 0) counts as the left half: before.
    fireEvent.dragOver(tiles()[0], { dataTransfer, clientX: 0 });
    fireEvent.drop(tiles()[0], { dataTransfer });
    expect(order()).toEqual(['deck.pdf page 3', 'deck.pdf page 1', 'deck.pdf page 2']);
  });
});

describe('PDF tools: page-list rules', () => {
  it('a click on a rotated page maps back to the same point in the unrotated page, for every rotation', () => {
    for (const r of [0, 90, 180, 270] as Rotation[]) {
      const [u, v] = toShown(20, 30, r, 300, 400);
      expect(fromShown(u, v, r, 300, 400)).toEqual([20, 30]);
    }
    // Turned a quarter clockwise, the page's top-left corner is the top-right of what is shown (400 wide).
    expect(toShown(0, 0, 90, 300, 400)).toEqual([400, 0]);
  });

  it('changes that share a key are one undo step', () => {
    const page = (id: string): PageItem => ({ id, source: 0, index: 0, width: 1, height: 1, rotation: 0, marks: [] });
    let h = record(history([page('a')]), [page('a'), page('b')]);
    h = record(h, [page('a'), page('c')], 'text:1');
    h = record(h, [page('a'), page('d')], 'text:1');
    expect(h.past).toHaveLength(2);
    expect(undo(h).present.map(p => p.id)).toEqual(['a', 'b']);
  });
});

describe('PDF tools: edit, pamphlet and save', () => {
  it('a text box placed in Edit is flattened into the saved page', async () => {
    const user = userEvent.setup();
    render(<Host initial={initialWorkspace()}/>);
    await importPdf(user, 2);
    const before = await PDFDocument.load(await buildPdf([{ name: 'x', bytes: await makePdf(2) }], [{ id: 'p', source: 0, index: 0, width: 301, height: 400, rotation: 0, marks: [] }]));
    await user.click(screen.getByRole('tab', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Text'), 'Hello there');
    fireEvent.pointerDown(screen.getByRole('img', { name: /Page 1: click to place text/ }), { clientX: 0, clientY: 0, pointerId: 1 });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const saved = await PDFDocument.load(await lastDownload());
    expect(saved.getPageCount()).toBe(2);
    const text = contentOf(saved.getPage(0));
    expect(text).toContain(hex('Hello there'));
    expect(text.length).toBeGreaterThan(contentOf(before.getPage(0)).length);
    expect(contentOf(saved.getPage(1))).not.toContain(hex('Hello there'));
  });

  it('ink and text marks on a rotated page are drawn, and a character Helvetica lacks becomes ?', async () => {
    const sources: Source[] = [{ name: 'x', bytes: await makePdf(1) }];
    const page: PageItem = { id: 'p', source: 0, index: 0, width: 301, height: 400, rotation: 90, marks: [
      { id: 't', kind: 'text', x: 20, y: 30, text: 'Sign ✓', size: 12, color: '#1a1b22', turn: 90 },
      { id: 'i', kind: 'ink', points: [[10, 10], [40, 40], [60, 20]], width: 2, color: '#1f4fd1' },
    ] };
    const saved = await PDFDocument.load(await buildPdf(sources, [page]));
    const text = contentOf(saved.getPage(0));
    expect(text).toContain(hex('Sign ?'));
    expect(text).toMatch(/\bS\b/); // the ink path is stroked
    expect(saved.getPage(0).getRotation().angle).toBe(90);
  });

  it('the pamphlet of 5 pages is 4 landscape Letter sides (8 padded pages, 2 sheets), A4 on request', async () => {
    const sources: Source[] = [{ name: 'x', bytes: await makePdf(5) }];
    const pages: PageItem[] = [0, 1, 2, 3, 4].map(i => ({ id: `p${i}`, source: 0, index: i, width: 301 + i, height: 400, rotation: 0, marks: [] }));
    const letter = await PDFDocument.load(await buildPamphlet(await buildPdf(sources, pages), { paper: 'letter', gutter: 18, creep: 0, padAt: 'end' }));
    expect(letter.getPageCount()).toBe(4);
    for (const page of letter.getPages()) expect(page.getSize()).toEqual({ width: 792, height: 612 });
    // Sheet 1 front is [8, 1]: blank on the left, page 1 on the right, so exactly one page is drawn.
    expect(contentOf(letter.getPage(0)).match(/\bDo\b/g)).toHaveLength(1);
    // Sheet 2 back is [4, 5]: both drawn.
    expect(contentOf(letter.getPage(3)).match(/\bDo\b/g)).toHaveLength(2);
    const a4 = await PDFDocument.load(await buildPamphlet(await buildPdf(sources, [...pages, { id: 'b', source: BLANK, index: 0, width: 612, height: 792, rotation: 0, marks: [] }]), { paper: 'a4', gutter: 0, creep: 1, padAt: 'before-last' }));
    expect(a4.getPageCount()).toBe(4);
    expect(a4.getPage(0).getWidth()).toBeCloseTo(841.89, 1);
    expect(a4.getPage(0).getHeight()).toBeCloseTo(595.28, 1);
  });

  it('the Pamphlet view previews each sheet side, and Save to workspace adds a valid PDF doc', async () => {
    const user = userEvent.setup();
    let latest: Workspace | null = null;
    render(<Host initial={initialWorkspace()} onCommit={w => { latest = w; }}/>);
    await importPdf(user, 5);
    await user.click(screen.getByRole('tab', { name: 'Pamphlet' }));
    for (const label of ['Sheet 1 front', 'Sheet 1 back', 'Sheet 2 front', 'Sheet 2 back']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByLabelText('Sheet 1 front: pages 8 and 1')).toBeInTheDocument();
    expect(screen.getByText(/flip on short edge, then fold/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download pamphlet' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect((await PDFDocument.load(await lastDownload())).getPageCount()).toBe(4);

    await user.click(screen.getByRole('button', { name: 'Save to workspace' }));
    await waitFor(() => expect(latest).not.toBeNull());
    const doc = latest!.docs[0];
    expect(doc).toMatchObject({ name: 'deck.pdf', kind: 'file', mime: 'application/pdf' });
    expect(doc.data).toMatch(/^data:application\/pdf;base64,/);
    expect(validateWorkspace(latest!)).toBe(latest);
    expect((await PDFDocument.load(Uint8Array.from(atob(doc.data!.split(',')[1]), c => c.charCodeAt(0)))).getPageCount()).toBe(5);
  });
});
