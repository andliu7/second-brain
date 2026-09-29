// Write: one note as a page of its own, for writing with nothing else on screen. Props:
//   workspace, commit: as for Docs.tsx
//   id: the note's id, from the address #write/<id>
// App.tsx draws this instead of its shell (no sidebar, no top bar), so the address works as a bookmark
// and survives a reload. A slim strip at the top carries Back (to #docs with this note selected), the
// word count, the save status, Save as PDF (window.print(), printed by the rules at the end of docs.css)
// and a button for the browser's own full screen. The note itself is a
// centred column about 720px wide with a large serif title and the same editor and autosave as Docs.
// A PDF document opens here as PDF tools across the whole width instead, working on that document and
// saving with its own Save (Docs.tsx PdfPane); the strip then has no word count or print button.
//
// Escape leaves the browser's full screen first (the browser does that itself), then a second Escape
// goes Back. The labelled full screen entry and Escape as the way out follow Edgeever's focus mode;
// the centred column and the word count with save state follow Notesnook's editor. Ideas only: both
// are copyleft (AGPL-3.0, GPL-3.0) and none of their code is here.
import { Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Maximize, Minimize, Printer } from 'lucide-react';
import type { Workspace } from './types';
import { UNTITLED, isListed, isPdfDoc, wordCount } from './lib/docs-kinds';
import { DocEditor, PdfTools, rememberOpen, useDocSaver, type Commit } from './Docs';

// The browser's full screen exists only where the page may ask for it; jsdom and some embedded
// browsers have no requestFullscreen at all, and then the button is not shown.
const canGoFull = () => typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
async function leaveFull() { try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* already out */ } }

export function Write({ workspace, commit, id }: { workspace: Workspace; commit: Commit; id: string }) {
  const doc = workspace.docs.find(item => item.id === id && isListed(item));
  const pdf = !!doc && isPdfDoc(doc);
  const { status, edit, flush } = useDocSaver(commit);
  const [title, setTitle] = useState(doc && doc.name !== UNTITLED ? doc.name : '');
  const [words, setWords] = useState(() => wordCount(doc?.content ?? ''));
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  // When the browser last left full screen. An Escape that arrives just after is the one that left it
  // (some browsers still deliver that key to the page), so it must not also go Back.
  const leftFull = useRef(0);

  // Back waits for the save to land (see flush in Docs.tsx), and stays put if it failed, so the unsaved
  // text is still on screen beside App's error toast.
  async function back() { if (!await flush()) return; rememberOpen(id); void leaveFull(); location.hash = 'docs'; }
  async function toggleFull() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { /* the browser said no; the page is still a full page */ }
  }

  useEffect(() => {
    const onChange = () => { const on = !!document.fullscreenElement; if (!on) leftFull.current = Date.now(); setFull(on); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.fullscreenElement) { void leaveFull(); return; }
      if (Date.now() - leftFull.current < 500) return;
      void back();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    // Leaving the page by any route (Back, the browser's back button) also leaves the browser's full screen.
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey); void leaveFull(); };
  }, [id]);

  return <div className="write-page">
    <header className="write-strip">
      <button type="button" className="text-button write-back" onClick={() => void back()}><ArrowLeft size={15}/>Back</button>
      {doc && <>
        {!pdf && <span className="write-words">{words} {words === 1 ? 'word' : 'words'}</span>}
        <span role="status">{status === 'saving' ? 'Saving' : 'Saved'}</span>
        {!pdf && <button type="button" className="icon-button" aria-label="Save as PDF" title="Save as PDF (opens the print dialog; choose Save as PDF)" onClick={() => window.print()}><Printer size={15}/></button>}
        {canGoFull() && <button type="button" className="icon-button" aria-pressed={full} aria-label={full ? 'Leave browser full screen' : 'Browser full screen'} title={full ? 'Leave full screen (Esc)' : 'Browser full screen, for writing without distractions'} onClick={() => void toggleFull()}>{full ? <Minimize size={15}/> : <Maximize size={15}/>}</button>}
      </>}
    </header>
    <main className={pdf ? 'write-column write-pdf' : `write-column ${doc ? 'note-print' : ''}`}>
      {doc ? <>
        <input className="write-title" aria-label="Title" placeholder={UNTITLED} value={title} maxLength={1024} onChange={event => { setTitle(event.target.value); edit(doc.id, { name: event.target.value }); }}/>
        {!pdf && <h1 className="print-title">{title.trim() || UNTITLED}</h1>}
        {pdf ? <Suspense fallback={<div className="docs-loading"><Loader2 className="spin" size={16}/>Opening PDF tools</div>}>
          {/* Save as new PDF opens the copy here too, as its own full screen page. */}
          <PdfTools workspace={workspace} commit={commit} doc={doc} opened={next => { location.hash = 'write/' + next; }}/>
        </Suspense>
        : <Suspense fallback={<div className="docs-loading"><Loader2 className="spin" size={16}/>Opening the editor</div>}>
          <DocEditor markdown={doc.content} onChange={content => { setWords(wordCount(content)); edit(doc.id, { content }); }}/>
        </Suspense>}
      </> : <p className="write-missing">This note is not in your workspace. It may have been deleted.</p>}
    </main>
  </div>;
}
