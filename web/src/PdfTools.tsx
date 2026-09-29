/// <reference types="vite/client" />
// PdfTools: organise, mark up and impose PDFs, all inside the browser. Props, like Kanban:
//   workspace: the Workspace, read only for PDF docs to open
//   commit: App's commit, used by Save to workspace to add the result as a file doc
// Mount lazily from App.tsx, so pdf-lib (and pdf.js, which this file loads on demand) stay out of the
// cold start:
//   const PdfTools = lazy(() => import('./PdfTools').then(m => ({ default: m.PdfTools })));
//   {page === 'pdf' && <Suspense fallback={...}><PdfTools workspace={workspace} commit={commit}/></Suspense>}
//
// Three views over one page list. Organize is Acrobat's Organize Pages: thumbnails to drag, select and
// act on. Edit places text boxes and ink (a signature) on one page. Pamphlet lays the pages out as a
// folded, saddle-stitched booklet. The page list is plain data (lib/pdf-pages.ts): each page names the
// imported file it came from, so nothing is rebuilt until a Download. Two libraries, split by job:
// pdf-lib (MIT) writes every PDF, and pdf.js (Apache-2.0) only draws the thumbnails. Nothing is uploaded.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ArrowLeftRight, BookOpen, ChevronLeft, ChevronRight, Copy, Download, FileOutput, FilePlus2, FolderInput, LayoutGrid, Loader2, PenLine, Redo2, RotateCcw, RotateCw, Save, Signature, Trash2, Type, Undo2, Upload, X } from 'lucide-react';
import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Workspace } from './types';
import type { Commit } from './Kanban';
import { activity, download, makeDoc, readData, uid } from './lib/storage';
import { BLANK, duplicate, fromShown, history, insertBlank, moveBy, moveTo, record, redo, remove, rotate, select, setMarks, swap, toShown, undo, type History, type InkMark, type Mark, type PageItem, type Rotation, type Selection, type TextMark } from './lib/pdf-pages';
import { PAPER, imposition, padPages, placeInHalf, rotatedOffset, shownSize, type PadAt, type Paper } from './lib/pamphlet';
import './pdftools.css';

// An imported file, always held as PDF bytes (an image becomes a one-page PDF on the way in).
export type Source = { name: string; bytes: Uint8Array };
export type PamphletOptions = { paper: Paper; gutter: number; creep: number; padAt: PadAt };

// shared/validate.mjs refuses a doc's data over 25 MiB, so Save to workspace checks first and says so.
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const PAGE_DRAG_TYPE = 'text/pdf-page';
// Ink and text colours: content colours printed on paper, not theme colours, so they are fixed hex values.
const COLORS = [{ name: 'Black', hex: '#1a1b22' }, { name: 'Blue', hex: '#1f4fd1' }, { name: 'Red', hex: '#c62828' }, { name: 'Green', hex: '#2e7d32' }];
const SIZES = [10, 12, 14, 18, 24, 36];

// ---------------------------------------------------------------- pdf-lib: reading and writing

const hexColor = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const turn = (angle: number) => ((Math.round(angle / 90) * 90 % 360) + 360) % 360 as Rotation;

/** Each page's unrotated size and rotation, which is all the page list needs to know about a file. */
export async function readPages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(page => ({ ...page.getSize(), rotation: turn(page.getRotation().angle) }));
}

/** A PNG or JPEG as a one-page PDF: Letter, turned to match the image, the image fitted inside half-inch margins. */
export async function imageToPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const [width, height] = image.width > image.height ? [792, 612] : [612, 792];
  const scale = Math.min((width - 72) / image.width, (height - 72) / image.height);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
  return doc.save();
}

// Helvetica is one of the 14 fonts every PDF reader has, so it costs nothing to embed, but it only covers
// Latin-1 (WinAnsi). A character it cannot draw would make pdf-lib throw, so it becomes a question mark.
function printable(text: string, font: PDFFont) {
  const known = new Set(font.getCharacterSet());
  return [...text].map(ch => known.has(ch.codePointAt(0)!) ? ch : '?').join('');
}

// Marks live in the page's top-left, unrotated space; PDF draws from the bottom-left of the media box.
function drawMarks(page: PDFPage, marks: Mark[], font: PDFFont | null) {
  const box = page.getMediaBox();
  for (const mark of marks) {
    if (mark.kind === 'text' && font && mark.text.trim()) {
      page.drawText(printable(mark.text, font), { x: box.x + mark.x, y: box.y + box.height - mark.y, size: mark.size, font, color: hexColor(mark.color), rotate: degrees(mark.turn) });
    } else if (mark.kind === 'ink' && mark.points.length) {
      // drawSvgPath reads the path with y pointing down from the (x, y) it is given, which is exactly the
      // marks' own space once that origin is the page's top-left corner. A lone dot is a zero-length line.
      const [first, ...rest] = mark.points;
      const path = `M ${first[0]} ${first[1]} ` + (rest.length ? rest.map(([x, y]) => `L ${x} ${y}`).join(' ') : `L ${first[0] + 0.01} ${first[1]}`);
      page.drawSvgPath(path, { x: box.x, y: box.y + box.height, borderColor: hexColor(mark.color), borderWidth: mark.width, borderLineCap: LineCapStyle.Round });
    }
  }
}

/**
 * The page list as a new PDF: pages copied from their sources in list order, rotated, marks flattened in.
 * Pages from one source are copied in one copyPages call where possible, because each call copies the
 * fonts and images a page uses again; a page used twice needs a second call for its second copy.
 */
export async function buildPdf(sources: Source[], pages: PageItem[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = pages.some(page => page.marks.some(mark => mark.kind === 'text')) ? await out.embedFont(StandardFonts.Helvetica) : null;
  const copies = new Map<string, PDFPage[]>();
  for (const source of new Set(pages.map(page => page.source).filter(s => s !== BLANK))) {
    const doc = await PDFDocument.load(sources[source].bytes);
    let wanted = pages.filter(page => page.source === source).map(page => page.index);
    while (wanted.length) {
      const round = [...new Set(wanted)];
      const copied = await out.copyPages(doc, round);
      round.forEach((index, i) => { const key = `${source}:${index}`; copies.set(key, [...(copies.get(key) ?? []), copied[i]]); });
      for (const index of round) wanted.splice(wanted.indexOf(index), 1);
    }
  }
  for (const item of pages) {
    const page = item.source === BLANK ? out.addPage([item.width, item.height]) : out.addPage(copies.get(`${item.source}:${item.index}`)!.shift()!);
    page.setRotation(degrees(item.rotation));
    drawMarks(page, item.marks, font);
  }
  return out.save();
}

/**
 * A finished PDF imposed as a saddle-stitch booklet (lib/pamphlet.ts has the order and the fit): one
 * landscape page per sheet side, two source pages on each. A page with no content stream (a blank
 * inserted here) cannot be embedded and needs no drawing, so it is left empty like a padding blank.
 */
export async function buildPamphlet(bytes: Uint8Array, options: PamphletOptions): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const paper = PAPER[options.paper];
  const pages = src.getPages();
  const embedded = await Promise.all(pages.map(page => page.node.Contents() ? out.embedPage(page) : null));
  const slots = padPages(pages.map((_, i) => i), options.padAt);
  for (const sheet of imposition(slots.length)) {
    for (const side of [sheet.front, sheet.back]) {
      const target = out.addPage([paper.width, paper.height]);
      side.forEach((number, i) => {
        const slot = slots[number - 1];
        const art = slot === null ? null : embedded[slot];
        if (slot === null || !art) return;
        const { width, height } = pages[slot].getSize();
        const rotation = turn(pages[slot].getRotation().angle);
        const shown = shownSize(width, height, rotation);
        const at = placeInHalf(shown.width, shown.height, i === 0 ? 'left' : 'right', paper, options.gutter, options.creep * (sheet.sheet - 1));
        const off = rotatedOffset(rotation, width, height, at.scale);
        target.drawPage(art, { x: at.x + off.dx, y: at.y + off.dy, xScale: at.scale, yScale: at.scale, rotate: degrees(-rotation) });
      });
    }
  }
  return out.save();
}

// ---------------------------------------------------------------- pdf.js: thumbnails only

// pdf.js is about as big as the rest of the page together, and only drawing needs it, so it is imported
// the first time a thumbnail draws. Its worker is a separate file Vite emits; ?url hands back its address.
type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfjs() {
  pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib; });
  return pdfjs;
}
// One parsed document per source, shared by every thumbnail of it. pdf.js takes ownership of the buffer
// it is given, so it gets a copy and the source bytes stay usable for pdf-lib.
const parsed = new WeakMap<Source, Promise<import('pdfjs-dist').PDFDocumentProxy>>();
function documentOf(source: Source) {
  let doc = parsed.get(source);
  if (!doc) { doc = loadPdfjs().then(lib => lib.getDocument({ data: source.bytes.slice() }).promise); parsed.set(source, doc); }
  return doc;
}

// One page drawn into a canvas at `width` CSS pixels, turned by the page's rotation, with its marks over it.
function PageView({ source, page, width, drawing }: { source: Source | undefined; page: PageItem; width: number; drawing?: InkMark | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = shownSize(page.width, page.height, page.rotation);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const element = canvas.current;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let live = true;
    documentOf(source).then(doc => doc.getPage(page.index + 1)).then(pdfPage => {
      if (!live) return;
      const scale = width * (window.devicePixelRatio || 1) / shown.width;
      const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });
      element.width = Math.round(viewport.width);
      element.height = Math.round(viewport.height);
      task = pdfPage.render({ canvas: element, viewport });
      return task.promise;
    }).catch(() => { /* a cancelled render, or a page pdf.js cannot draw: the white page stays */ });
    // Cleanup cancels a render still running when the page, its rotation or the size changes.
    return () => { live = false; task?.cancel(); };
  }, [source, page.index, page.rotation, width, shown.width]);
  return <div className="pdf-page" style={{ width, aspectRatio: `${shown.width} / ${shown.height}` }}>
    {source && <canvas ref={canvas} aria-hidden="true"/>}
    <MarksLayer page={page} drawing={drawing}/>
  </div>;
}

// Marks as SVG over the page. The viewBox is the page as shown, in points, so font sizes and ink widths
// scale with the thumbnail for free, and the same layer serves a 120 px tile and the full editor.
function MarksLayer({ page, drawing, active }: { page: PageItem; drawing?: InkMark | null; active?: string }) {
  const shown = shownSize(page.width, page.height, page.rotation);
  const marks = drawing ? [...page.marks, drawing] : page.marks;
  if (!marks.length) return null;
  const at = (x: number, y: number) => toShown(x, y, page.rotation, page.width, page.height);
  return <svg className="pdf-marks" viewBox={`0 0 ${shown.width} ${shown.height}`} aria-hidden="true">
    {marks.map(mark => mark.kind === 'ink'
      ? <polyline key={mark.id} points={mark.points.map(([x, y]) => at(x, y).join(',')).join(' ')} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round"/>
      : (() => { const [u, v] = at(mark.x, mark.y); return <text key={mark.id} x={u} y={v} fontSize={mark.size} fill={mark.color} data-active={mark.id === active || undefined} transform={`rotate(${page.rotation - mark.turn} ${u} ${v})`}>{mark.text}</text>; })())}
  </svg>;
}

// ---------------------------------------------------------------- the page

type View = 'organize' | 'edit' | 'pamphlet';
type Status = { kind: 'error' | 'info'; text: string } | null;
const base = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';
const toBytes = (dataUrl: string) => { const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; };
// Blob wants an ArrayBuffer-backed array; copying into a fresh Uint8Array gives it one whatever pdf-lib returned.
const pdfBlob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
// FileReader rather than file.arrayBuffer(): the same bytes, and it also works in the jsdom the tests run in.
const readBytes = (file: Blob) => new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file); });
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function PdfTools({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  // Sources only ever grow, and a page is added to the list only after its source is in, so a ref is
  // enough: the history update that adds the pages is the render that shows them.
  const sources = useRef<Source[]>([]);
  const [hist, setHist] = useState<History>(() => history());
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null });
  const [view, setView] = useState<View>('organize');
  const [name, setName] = useState('document');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [options, setOptions] = useState<PamphletOptions>({ paper: 'letter', gutter: 18, creep: 0, padAt: 'end' });
  const picker = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const refocus = useRef<string | null>(null);
  const pages = hist.present;
  const selected = pages.filter(page => selection.ids.includes(page.id));
  const change = (update: (pages: PageItem[]) => PageItem[], key?: string) => setHist(h => record(h, update(h.present), key));
  const pdfDocs = workspace.docs.filter(doc => doc.data && (doc.mime ?? '').startsWith('application/pdf'));

  // Undo and redo from anywhere on the page, except while typing, where Ctrl+Z belongs to the text field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); setHist(undo); }
      else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); setHist(redo); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Undo can take away a selected page; the selection follows the list.
  useEffect(() => { setSelection(s => s.ids.every(id => pages.some(page => page.id === id)) ? s : { ids: s.ids.filter(id => pages.some(page => page.id === id)), anchor: null }); }, [pages]);
  // Moving a tile moves its DOM node, which drops focus; put it back so Alt+Right can be pressed again.
  useEffect(() => { if (refocus.current) { grid.current?.querySelector<HTMLElement>(`[data-id="${refocus.current}"]`)?.focus(); refocus.current = null; } });

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setStatus(null);
    const added: PageItem[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      try {
        const raw = await readBytes(file);
        const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
        if (!['application/pdf', 'image/png', 'image/jpeg'].includes(type)) { skipped.push(`${file.name} (not a PDF, PNG or JPEG)`); continue; }
        const bytes = type === 'application/pdf' ? raw : await imageToPdf(raw, type);
        const sizes = await readPages(bytes);
        const source = sources.current.push({ name: file.name, bytes }) - 1;
        sizes.forEach((size, index) => added.push({ id: uid(), source, index, ...size, marks: [] }));
      } catch (error) {
        // pdf-lib refuses an encrypted PDF outright; saying so beats a generic failure.
        skipped.push(`${file.name} (${error instanceof Error && /encrypt/i.test(error.message) ? 'encrypted' : 'could not be read'})`);
      }
    }
    if (added.length) { change(list => [...list, ...added]); if (!pages.length) setName(base(files[0].name)); }
    setStatus(skipped.length ? { kind: 'error', text: `Skipped ${skipped.join(', ')}.` } : { kind: 'info', text: `Added ${added.length} page${added.length === 1 ? '' : 's'}.` });
    setBusy(false);
  }
  async function openDoc(id: string) {
    const doc = pdfDocs.find(d => d.id === id);
    if (doc?.data) await addFiles([new File([toBytes(doc.data)], doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`, { type: 'application/pdf' })]);
  }

  // Every save builds the PDF fresh from the list; the busy flag keeps a second click from starting another.
  async function run(task: () => Promise<void>) {
    setBusy(true); setStatus(null);
    try { await task(); } catch (error) { setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not build the PDF.' }); } finally { setBusy(false); }
  }
  const saveAs = (list: PageItem[], file: string) => run(async () => download(file, pdfBlob(await buildPdf(sources.current, list))));
  const savePamphlet = () => run(async () => download(`${name}-pamphlet.pdf`, pdfBlob(await buildPamphlet(await buildPdf(sources.current, pages), options))));
  const saveToWorkspace = () => run(async () => {
    const bytes = await buildPdf(sources.current, pages);
    if (bytes.length > MAX_DOC_BYTES) { setStatus({ kind: 'error', text: `This PDF is ${(bytes.length / 1048576).toFixed(1)} MiB; the workspace holds files up to 25 MiB. Download it instead.` }); return; }
    const doc = { ...makeDoc(`${name}.pdf`, '', 'file'), mime: 'application/pdf', data: await readData(pdfBlob(bytes)), size: bytes.length };
    // The activity entry names 'files': shared/validate.mjs accepts a fixed list of pages there, and 'docs' is not on it.
    if (await commit(w => ({ ...w, docs: [doc, ...w.docs], activity: [activity(`Saved ${doc.name}`, 'files'), ...w.activity].slice(0, 100) }), `Saved ${doc.name} to your workspace`)) setStatus({ kind: 'info', text: `Saved ${doc.name} to your workspace.` });
  });

  const ids = selection.ids;
  const act = {
    rotateLeft: () => change(list => rotate(list, ids, -1)),
    rotateRight: () => change(list => rotate(list, ids, 1)),
    remove: () => { change(list => remove(list, ids)); setSelection({ ids: [], anchor: null }); },
    duplicate: () => change(list => duplicate(list, ids, uid)),
    blank: () => { const id = uid(); const last = pages.filter(page => ids.includes(page.id)).pop(); change(list => insertBlank(list, last?.id ?? null, id)); setSelection({ ids: [id], anchor: id }); },
    swap: () => change(list => swap(list, ids[0], ids[1])),
  };

  function onTileKey(event: KeyboardEvent<HTMLLIElement>, page: PageItem, i: number) {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault(); refocus.current = page.id; change(list => moveBy(list, page.id, event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); grid.current?.querySelector<HTMLElement>(`[data-id="${pages[i + (event.key === 'ArrowLeft' ? -1 : 1)]?.id}"]`)?.focus();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); setSelection(s => select(pages, s, page.id, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }));
    } else if (event.key === 'Delete' && ids.length) { event.preventDefault(); act.remove(); }
  }
  // Native HTML5 drag and drop: a dragged tile carries its id; dropping it (with the rest of the selection,
  // if it was selected) lands before or after the tile under the pointer, by which half the pointer is in.
  function onTileDragOver(event: DragEvent<HTMLLIElement>, page: PageItem) {
    if (!event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setOver({ id: page.id, after: event.clientX > box.left + box.width / 2 });
  }
  function onTileDrop(event: DragEvent<HTMLLIElement>, i: number) {
    const dragged = event.dataTransfer.getData(PAGE_DRAG_TYPE);
    if (!dragged || !over) return;
    event.preventDefault(); event.stopPropagation();
    const moving = ids.includes(dragged) ? pages.filter(page => ids.includes(page.id)).map(page => page.id) : [dragged];
    const before = over.after ? pages.slice(i + 1).find(page => !moving.includes(page.id))?.id ?? null : over.id;
    change(list => moveTo(list, moving, before));
    setOver(null);
  }
  // Files dropped anywhere on the page are imported.
  const onFileOver = (event: DragEvent) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setFileOver(true); } };
  const onFileDrop = (event: DragEvent) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setFileOver(false); void addFiles([...event.dataTransfer.files]); };

  const empty = !pages.length;
  return <div className="pdf-tools" data-file-over={fileOver || undefined} onDragOver={onFileOver} onDragLeave={event => { if (event.currentTarget === event.target) setFileOver(false); }} onDrop={onFileDrop}>
    <div className="page-heading"><div><h1>PDF tools</h1></div><div className="heading-actions">
      {!empty && <label className="pdf-name">File name<input value={name} onChange={event => setName(event.target.value.replace(/[<>:"/\\|?*]/g, '') || 'document')}/></label>}
      <button className="button" onClick={() => picker.current?.click()} disabled={busy}><Upload size={15}/>Add files</button>
      {!empty && <button className="button primary" onClick={() => void saveAs(pages, `${name}.pdf`)} disabled={busy}><Download size={15}/>Download PDF</button>}
    </div></div>
    <input ref={picker} className="sr-only" type="file" multiple accept="application/pdf,.pdf,image/png,image/jpeg" aria-label="Choose PDF or image files" onChange={event => { void addFiles([...(event.target.files ?? [])]); event.target.value = ''; }}/>
    {status && <p className={status.kind === 'error' ? 'error-banner pdf-status' : 'pdf-status'} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}

    {empty ? <section className="panel pdf-drop" data-over={fileOver || undefined}>
      <FilePlus2 size={30} strokeWidth={1.4}/>
      <h2>Drop PDFs or images here</h2>
      <p>Several at once are joined in the order they arrive. PNG and JPEG images become pages. Everything stays in this browser.</p>
      <button className="button primary" onClick={() => picker.current?.click()} disabled={busy}>{busy ? <Loader2 size={15} className="spin"/> : <Upload size={15}/>}Choose files</button>
      {pdfDocs.length > 0 && <label className="pdf-open">Or open a PDF from your workspace<select value="" onChange={event => void openDoc(event.target.value)}><option value="">Choose a document</option>{pdfDocs.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label>}
    </section> : <>
      <div className="pdf-views" role="tablist" aria-label="PDF tools view">
        {([['organize', LayoutGrid, 'Organize'], ['edit', PenLine, 'Edit'], ['pamphlet', BookOpen, 'Pamphlet']] as const).map(([id, Icon, label]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}><Icon size={15}/>{label}</button>)}
        <span className="pdf-count">{pages.length} page{pages.length === 1 ? '' : 's'}{ids.length ? `, ${ids.length} selected` : ''}</span>
      </div>

      {view === 'organize' && <>
        <div className="pdf-toolbar" role="toolbar" aria-label="Page actions">
          <button className="button small" onClick={act.rotateLeft} disabled={!ids.length}><RotateCcw size={14}/>Rotate left</button>
          <button className="button small" onClick={act.rotateRight} disabled={!ids.length}><RotateCw size={14}/>Rotate right</button>
          <button className="button small" onClick={act.swap} disabled={ids.length !== 2} title="Select exactly two pages to swap them"><ArrowLeftRight size={14}/>Swap</button>
          <button className="button small" onClick={act.duplicate} disabled={!ids.length}><Copy size={14}/>Duplicate</button>
          <button className="button small" onClick={act.blank}><FilePlus2 size={14}/>Blank page</button>
          <button className="button small" onClick={() => void saveAs(selected, `${name}-extract.pdf`)} disabled={!ids.length || busy}><FileOutput size={14}/>Extract</button>
          <button className="button small pdf-danger" onClick={act.remove} disabled={!ids.length}><Trash2 size={14}/>Delete</button>
          <span className="pdf-toolbar-gap"/>
          <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => setHist(undo)} disabled={!hist.past.length}><Undo2 size={16}/></button>
          <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={() => setHist(redo)} disabled={!hist.future.length}><Redo2 size={16}/></button>
        </div>
        <p className="pdf-hint">Click to select, Shift+click for a run, Ctrl+click to add one. Drag to reorder, or focus a page and press Alt+Left or Alt+Right.</p>
        {/* A listbox with multiple selection is the ARIA pattern for this grid: options that can be selected together. */}
        <ul ref={grid} className="pdf-grid" role="listbox" aria-multiselectable="true" aria-label="Pages" onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }}>
          {pages.map((page, i) => {
            const source = sources.current[page.source];
            const label = `Page ${i + 1}: ${page.source === BLANK ? 'blank' : `${source?.name} page ${page.index + 1}`}${page.rotation ? `, rotated ${page.rotation} degrees` : ''}`;
            return <li key={page.id} data-id={page.id} className="pdf-tile" role="option" aria-selected={ids.includes(page.id)} aria-label={label} tabIndex={0} draggable
              data-drop={over?.id === page.id ? (over.after ? 'after' : 'before') : undefined}
              onClick={(event: MouseEvent) => setSelection(s => select(pages, s, page.id, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }))}
              onDoubleClick={() => { setSelection({ ids: [page.id], anchor: page.id }); setView('edit'); }}
              onKeyDown={event => onTileKey(event, page, i)}
              onDragStart={event => { event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id); event.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={event => onTileDragOver(event, page)} onDrop={event => onTileDrop(event, i)} onDragEnd={() => setOver(null)}>
              <PageView source={source} page={page} width={128}/>
              <span className="pdf-tile-number">{i + 1}</span>
            </li>;
          })}
        </ul>
      </>}

      {view === 'edit' && <Editor pages={pages} sources={sources.current} current={selected[0] ?? pages[0]} choose={id => setSelection({ ids: [id], anchor: id })} change={change}/>}

      {view === 'pamphlet' && <Pamphlet pages={pages} sources={sources.current} options={options} setOptions={setOptions} busy={busy} save={savePamphlet}/>}

      <div className="pdf-save">
        <button className="button" onClick={() => void saveToWorkspace()} disabled={busy}><Save size={15}/>Save to workspace</button>
        <button className="button" onClick={() => picker.current?.click()} disabled={busy}><FolderInput size={15}/>Add more files</button>
        {pdfDocs.length > 0 && <select aria-label="Add a PDF from your workspace" value="" onChange={event => void openDoc(event.target.value)}><option value="">Add from workspace…</option>{pdfDocs.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select>}
        {busy && <Loader2 size={16} className="spin" aria-label="Working"/>}
      </div>
    </>}
  </div>;
}

// ---------------------------------------------------------------- Edit: text boxes and ink

type Tool = 'text' | 'ink';
function Editor({ pages, sources, current, choose, change }: { pages: PageItem[]; sources: Source[]; current: PageItem; choose: (id: string) => void; change: (update: (pages: PageItem[]) => PageItem[], key?: string) => void }) {
  const [tool, setTool] = useState<Tool>('text');
  const [draft, setDraft] = useState('');
  const [size, setSize] = useState(14);
  const [color, setColor] = useState(COLORS[0].hex);
  const [active, setActive] = useState<string | null>(null);
  const [stroke, setStroke] = useState<InkMark | null>(null);
  const at = pages.findIndex(page => page.id === current.id);
  const shown = shownSize(current.width, current.height, current.rotation);
  const activeMark = current.marks.find((mark): mark is TextMark => mark.id === active && mark.kind === 'text');
  // A change to the active text box shares one undo key, so a word typed is one step to undo.
  const editText = (patch: Partial<TextMark>) => activeMark && change(list => setMarks(list, current.id, marks => marks.map(mark => mark.id === activeMark.id ? { ...mark, ...patch } as Mark : mark)), `text:${activeMark.id}`);

  // Pointer position as a point in the unrotated page. The overlay's box is the page as shown.
  function pagePoint(event: PointerEvent<SVGSVGElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    const u = box.width ? (event.clientX - box.left) / box.width * shown.width : 0;
    const v = box.height ? (event.clientY - box.top) / box.height * shown.height : 0;
    return fromShown(u, v, current.rotation, current.width, current.height);
  }
  function onDown(event: PointerEvent<SVGSVGElement>) {
    const [x, y] = pagePoint(event);
    if (tool === 'ink') { event.currentTarget.setPointerCapture?.(event.pointerId); setStroke({ id: uid(), kind: 'ink', points: [[x, y]], width: 2, color }); return; }
    const mark: TextMark = { id: uid(), kind: 'text', x, y, text: draft.trim() || 'Text', size, color, turn: current.rotation };
    change(list => setMarks(list, current.id, marks => [...marks, mark]));
    setActive(mark.id); setDraft(mark.text);
  }
  const onMove = (event: PointerEvent<SVGSVGElement>) => { if (stroke) { const point = pagePoint(event); setStroke(s => s && { ...s, points: [...s.points, point] }); } };
  // The stroke is drawn in local state and becomes one history entry when the pen lifts.
  const onUp = () => { if (stroke) { const done = stroke; change(list => setMarks(list, current.id, marks => [...marks, done])); setStroke(null); } };

  return <div className="pdf-editor">
    <aside className="panel pdf-editor-tools">
      <div className="pdf-seg" role="group" aria-label="Tool">
        <button aria-pressed={tool === 'text'} onClick={() => setTool('text')}><Type size={14}/>Text box</button>
        <button aria-pressed={tool === 'ink'} onClick={() => { setTool('ink'); setActive(null); }}><Signature size={14}/>Ink</button>
      </div>
      {tool === 'text' ? <>
        <label>Text<input value={activeMark ? activeMark.text : draft} placeholder="Type, then click the page" onChange={event => activeMark ? editText({ text: event.target.value }) : setDraft(event.target.value)}/></label>
        <label>Size<select value={activeMark?.size ?? size} onChange={event => { const value = Number(event.target.value); setSize(value); editText({ size: value }); }}>{SIZES.map(s => <option key={s} value={s}>{s} pt</option>)}</select></label>
        <p className="pdf-hint">{activeMark ? 'Editing the selected text box. Click the page again to add another.' : 'Click the page where the text should start.'}</p>
        {activeMark && <div className="pdf-row"><button className="button small" onClick={() => setActive(null)}><X size={14}/>Done</button><button className="button small pdf-danger" onClick={() => { change(list => setMarks(list, current.id, marks => marks.filter(mark => mark.id !== activeMark.id))); setActive(null); }}><Trash2 size={14}/>Remove</button></div>}
      </> : <>
        <p className="pdf-hint">Draw on the page with the mouse, a pen or a finger: a signature, a circle, a tick.</p>
        <button className="button small" disabled={!current.marks.some(mark => mark.kind === 'ink')} onClick={() => change(list => setMarks(list, current.id, marks => marks.filter(mark => mark.kind !== 'ink')))}><Trash2 size={14}/>Clear ink on this page</button>
      </>}
      <div className="pdf-colors" role="radiogroup" aria-label="Colour">
        {COLORS.map(c => <button key={c.hex} role="radio" aria-checked={(activeMark?.color ?? color) === c.hex} aria-label={c.name} style={{ background: c.hex }} onClick={() => { setColor(c.hex); editText({ color: c.hex }); }}/>)}
      </div>
      <p className="pdf-hint">Text and ink are flattened into the page when you download or save. Undo with Ctrl+Z.</p>
    </aside>
    <div className="pdf-stage">
      <div className="pdf-stage-nav">
        <button className="icon-button" aria-label="Previous page" disabled={at <= 0} onClick={() => { choose(pages[at - 1].id); setActive(null); }}><ChevronLeft size={16}/></button>
        <span>Page {at + 1} of {pages.length}</span>
        <button className="icon-button" aria-label="Next page" disabled={at >= pages.length - 1} onClick={() => { choose(pages[at + 1].id); setActive(null); }}><ChevronRight size={16}/></button>
      </div>
      <div className="pdf-stage-page">
        <PageView source={sources[current.source]} page={current} width={560} drawing={stroke}/>
        {/* The hit layer sits over the page; it holds the active box's highlight too, so the thumbnail layer stays plain. */}
        <svg className="pdf-hit" data-tool={tool} viewBox={`0 0 ${shown.width} ${shown.height}`} aria-label={`Page ${at + 1}: click to ${tool === 'text' ? 'place text' : 'draw'}`} role="img"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {current.marks.filter((mark): mark is TextMark => mark.kind === 'text').map(mark => { const [u, v] = toShown(mark.x, mark.y, current.rotation, current.width, current.height);
            return <rect key={mark.id} className="pdf-hit-box" data-active={mark.id === active || undefined} x={u - 2} y={v - mark.size} width={mark.text.length * mark.size * 0.55 + 4} height={mark.size * 1.25} transform={`rotate(${current.rotation - mark.turn} ${u} ${v})`}
              onPointerDown={event => { if (tool !== 'text') return; event.stopPropagation(); setActive(mark.id); }}/>; })}
        </svg>
      </div>
    </div>
  </div>;
}

// ---------------------------------------------------------------- Pamphlet: the imposed preview

function Pamphlet({ pages, sources, options, setOptions, busy, save }: { pages: PageItem[]; sources: Source[]; options: PamphletOptions; setOptions: (o: PamphletOptions) => void; busy: boolean; save: () => void }) {
  const paper = PAPER[options.paper];
  const slots = padPages(pages, options.padAt);
  const sheets = imposition(slots.length);
  const blanks = slots.length - pages.length;
  const set = (patch: Partial<PamphletOptions>) => setOptions({ ...options, ...patch });
  const PREVIEW = 340; // px, the width of one sheet in the preview
  const k = PREVIEW / paper.width;
  const half = (number: number, side: 'left' | 'right', creepShift: number) => {
    const page = slots[number - 1];
    if (!page) return <div key={side} className="pdf-sheet-blank" style={{ left: side === 'left' ? 0 : '50%' }}><span>blank</span></div>;
    const shown = shownSize(page.width, page.height, page.rotation);
    const place = placeInHalf(shown.width, shown.height, side, paper, options.gutter, creepShift);
    return <div key={side} className="pdf-sheet-slot" style={{ left: place.x * k, bottom: place.y * k }}>
      <PageView source={sources[page.source]} page={page} width={shown.width * place.scale * k}/>
      <span className="pdf-sheet-number">{number}</span>
    </div>;
  };
  return <div className="pdf-pamphlet">
    <aside className="panel pdf-pamphlet-options">
      <h2>Booklet</h2>
      <p className="pdf-hint">{pages.length} page{pages.length === 1 ? '' : 's'}{blanks ? `, plus ${blanks} blank${blanks === 1 ? '' : 's'} to make ${slots.length}` : ''}, on {sheets.length} sheet{sheets.length === 1 ? '' : 's'} of {paper.label} landscape, two pages a side.</p>
      <label>Paper<select value={options.paper} onChange={event => set({ paper: event.target.value as Paper })}><option value="letter">Letter (11 x 8.5 in)</option><option value="a4">A4 (297 x 210 mm)</option></select></label>
      <label>Gutter at the fold (pt)<input type="number" min={0} max={72} value={options.gutter} onChange={event => set({ gutter: Math.max(0, Math.min(72, Number(event.target.value) || 0)) })}/></label>
      <label>Blank pages go<select value={options.padAt} onChange={event => set({ padAt: event.target.value as PadAt })}><option value="end">At the end</option><option value="before-last">Before the back cover</option></select></label>
      <label>Creep per sheet (pt, 0 is off)<input type="number" min={0} max={6} step={0.25} value={options.creep} onChange={event => set({ creep: Math.max(0, Math.min(6, Number(event.target.value) || 0)) })}/></label>
      <div className="pdf-print-note">
        <strong>To print</strong>
        <p>Print double-sided, flip on short edge, then fold the stack in half. Print one copy and fold it before printing the rest; flip on long edge prints every back upside down.</p>
      </div>
      <button className="button primary" onClick={save} disabled={busy}><BookOpen size={15}/>Download pamphlet</button>
    </aside>
    <ol className="pdf-sheets" aria-label="Imposed sheets">
      {sheets.flatMap(sheet => (['front', 'back'] as const).map(face => {
        const [left, right] = sheet[face];
        const creepShift = options.creep * (sheet.sheet - 1);
        return <li key={`${sheet.sheet}-${face}`} className="pdf-sheet-item">
          <div className="pdf-sheet" style={{ width: PREVIEW, height: paper.height * k }} aria-label={`Sheet ${sheet.sheet} ${face}: pages ${left} and ${right}`}>
            {half(left, 'left', creepShift)}{half(right, 'right', creepShift)}
            <span className="pdf-sheet-fold" aria-hidden="true"/>
          </div>
          <span className="pdf-sheet-label">Sheet {sheet.sheet} {face}</span>
        </li>;
      }))}
    </ol>
  </div>;
}
