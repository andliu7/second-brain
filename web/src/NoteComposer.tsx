// NoteComposer: the small "New note" box behind Today's pencil button (Andrew, 2026-09-29: "make it the
// pencil icon, and maybe make it open into something a little bit more concise"). One text box and no title
// field: the first line becomes the title, the same rule as quick capture, and it saves through the same
// capture() so the note is tagged "Quick capture" and logged the same way. The full editor (title, tags,
// kind) is still what the rest of the app opens. Props:
//   save: App's captureNote, which resolves false (and shows its own toast) when the save failed
//   close: called on Save, Cancel, Escape or a click on the backdrop
// Mount from Today.tsx while it is open:
//   {composing && <NoteComposer save={capture} close={() => setComposing(false)}/>}
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import './note-composer.css';

export function NoteComposer({ save, close }: { save: (text: string) => Promise<boolean>; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // A native <dialog> opened with showModal, so focus stays inside it and the page behind is inert. The
  // browser focuses the first focusable element on showModal, so the caret is put in the box after it.
  // Cleanup closes the dialog before returning focus to the pencil, since the inert page cannot take focus
  // while the dialog is still open.
  useEffect(() => { const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null; dialog.showModal(); box.current?.focus(); return () => { dialog.close(); previous?.focus(); }; }, []);
  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    // A failed save keeps the text and the box open; App has already said why.
    if (await save(value)) close(); else setBusy(false);
  }
  return <dialog ref={ref} className="modal note-composer" aria-label="New note"
    onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}
    onClick={event => { if (event.target === ref.current) close(); }}>
    <textarea ref={box} aria-label="Note" value={text} onChange={event => setText(event.target.value)} placeholder="Write a note. The first line is its title."
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } }}/>
    <div className="note-composer-foot">
      <span className="muted"><kbd>Ctrl ↵</kbd> to save</span>
      <button type="button" className="button small" onClick={close}>Cancel</button>
      <button type="button" className="button small primary" disabled={!text.trim() || busy} onClick={() => void submit()}>{busy && <Loader2 className="spin" size={14}/>}Save</button>
    </div>
  </dialog>;
}
