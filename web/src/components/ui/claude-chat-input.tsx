// ClaudeChatInput: andliu.ai's one composer, in the side panel and full screen alike, from the component
// Andrew pasted (2026-09-27), rebuilt on the app's tokens with plain buttons (no radix or cva). Files can be
// dropped, picked or pasted; a paste longer than PASTE_THRESHOLD becomes a card instead of flooding the
// box; textual files are read so their text can go to the model. Props:
//   onSendMessage(message, files, pasted): Send, or Enter (Shift+Enter for a new line)
//   disabled, submitDisabled: the caller's busy state and provider readiness
//   placeholder, maxFiles (10), maxFileSize (50 MB), acceptedFileTypes
//   models, selectedModel, onModelChange: the model menu; the caller owns the choice. A model with a group
//     (the provider's name) is listed under that heading, so one menu picks provider and model together
//   value, onValueChange: optional control of the text, so a prompt starter can fill the box
//   tools: the caller's own buttons, placed in the bottom row after the pickers (Add context, a skill)
//   efforts, effort, onEffortChange: the reasoning effort button, which steps through efforts on each click
//     like the /prompt-demo one; an empty list hides it, for a provider or model that has no effort setting
// Its look is PromptInput's (ai-chat-input.tsx, the /prompt-demo page, 2026-09-28): a rounded gradient box
// with the model and effort pickers inside it, whose two icons it borrows. Left out of the paste on purpose:
// the simulated upload progress (nothing is uploaded here; a file is complete once read) and window.alert,
// which became inline notes.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUp, Archive, Check, ChevronDown, Copy, FileText, ImageIcon, Music, Plus, Video, X } from 'lucide-react';
import { uid } from '../../lib/storage';
import { DynamicBarsIcon, ModelIcon } from './ai-chat-input';
import './claude-chat-input.css';

export type FileWithPreview = { id: string; file: File; preview?: string; type: string; textContent?: string; error?: string };
export type PastedContent = { id: string; content: string; timestamp: Date; wordCount: number };
export type ModelOption = { id: string; name: string; description: string; badge?: string; group?: string };
type Props = {
  onSendMessage?: (message: string, files: FileWithPreview[], pasted: PastedContent[]) => void;
  disabled?: boolean; submitDisabled?: boolean; placeholder?: string; maxFiles?: number; maxFileSize?: number; acceptedFileTypes?: string[];
  models?: ModelOption[]; selectedModel?: string; onModelChange?: (modelId: string) => void; 'aria-label'?: string;
  value?: string; onValueChange?: (value: string) => void; tools?: ReactNode;
  efforts?: EffortOption[]; effort?: string; onEffortChange?: (effortId: string) => void;
};
export type EffortOption = { id: string; name: string };
const MAX_FILES = 10; const MAX_FILE_SIZE = 50 * 1024 * 1024; const PASTE_THRESHOLD = 200;
const TEXT_TYPES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];
const TEXT_EXT = new Set(['txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'json', 'xml', 'yaml', 'yml', 'csv', 'sql', 'sh', 'bash', 'php', 'rb', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rs', 'swift', 'kt', 'scala', 'r', 'vue', 'svelte', 'astro', 'config', 'conf', 'ini', 'toml', 'log', 'gitignore', 'dockerfile', 'makefile', 'readme', 'mjs', 'cjs']);
export const isTextualFile = (file: File) => TEXT_TYPES.some(t => file.type.toLowerCase().startsWith(t)) || TEXT_EXT.has(file.name.split('.').pop()?.toLowerCase() || '') || /readme|dockerfile|makefile/i.test(file.name);
export const formatFileSize = (bytes: number) => { if (!bytes) return '0 B'; const k = 1024; const i = Math.min(3, Math.floor(Math.log(bytes) / Math.log(k))); return `${parseFloat((bytes / k ** i).toFixed(i ? 1 : 0))} ${['B', 'KB', 'MB', 'GB'][i]}`; };
const typeLabel = (type: string) => { let label = (type.split('/').pop() || 'file').toUpperCase(); if (label.length > 7 && label.includes('-')) label = label.slice(0, label.indexOf('-')); return label.length > 10 ? label.slice(0, 10) + '...' : label; };
const extLabel = (name: string) => { const ext = (name.split('.').pop() || 'FILE').toUpperCase(); return ext.length > 8 ? ext.slice(0, 8) + '...' : ext; };
const readText = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(r.error); r.readAsText(file); });
const FileGlyph = ({ type }: { type: string }) => type.startsWith('image/') ? <ImageIcon size={18}/> : type.startsWith('video/') ? <Video size={18}/> : type.startsWith('audio/') ? <Music size={18}/> : /zip|rar|tar/.test(type) ? <Archive size={18}/> : <FileText size={18}/>;

function Card({ badge, text, image, name, size, onCopy, onRemove, error }: { badge: string; text?: string; image?: string; name?: string; size?: string; onCopy?: () => void; onRemove: () => void; error?: string }) {
  return <div className="cci-card" title={name}>
    {image ? <img src={image} alt="" className="cci-card-image"/> : text !== undefined ? <div className="cci-card-text">{text.slice(0, 150)}{text.length > 150 && '...'}</div> : <div className="cci-card-file"><FileGlyph type={badge}/><span>{name}</span><small>{size}</small></div>}
    <div className="cci-card-overlay"><span className="cci-card-badge">{image || text !== undefined ? badge : typeLabel(badge)}</span>{error && <span className="cci-card-error" title={error}><AlertCircle size={13}/></span>}</div>
    <div className="cci-card-actions">
      {onCopy && <button type="button" className="icon-button" aria-label={`Copy ${name || 'pasted text'}`} onClick={onCopy}><Copy size={12}/></button>}
      <button type="button" className="icon-button" aria-label={`Remove ${name || 'pasted text'}`} onClick={onRemove}><X size={12}/></button>
    </div>
  </div>;
}

function ModelMenu({ models, selected, onChange, disabled }: { models: ModelOption[]; selected: string; onChange: (id: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const current = models.find(m => m.id === selected) || models[0];
  // Headings in first-seen order; models without a group share one unnamed list, which is the old flat menu.
  const groups = [...new Set(models.map(m => m.group || ''))];
  const option = (m: ModelOption) => <li key={m.id} role="option" aria-selected={m.id === selected}><button type="button" onClick={() => { onChange(m.id); setOpen(false); }}><span className="cci-model-name">{m.name}{m.badge && <small className="cci-model-badge">{m.badge}</small>}</span><span className="cci-model-desc">{m.description}</span>{m.id === selected && <Check size={14} className="cci-model-check"/>}</button></li>;
  useEffect(() => { const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away); }, []);
  return <div className="cci-model" ref={ref} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
    <button type="button" className="cci-model-button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Chat model: ${current?.name || selected}`} disabled={disabled} onClick={() => setOpen(v => !v)}><ModelIcon model={current?.name || selected}/><span>{current?.name || selected}</span><ChevronDown size={11} className={open ? 'cci-flip' : ''}/></button>
    {open && <ul className="cci-model-menu panel" role="listbox" aria-label="Models">
      {groups.length === 1 && !groups[0] ? models.map(option) : groups.map(group => <li key={group} role="group" aria-label={group || 'Other'}><span className="cci-model-group" aria-hidden="true">{group || 'Other'}</span><ul role="none">{models.filter(m => (m.group || '') === group).map(option)}</ul></li>)}
    </ul>}
  </div>;
}

export function ClaudeChatInput({ onSendMessage, disabled = false, submitDisabled = false, placeholder = 'How can I help you today?', maxFiles = MAX_FILES, maxFileSize = MAX_FILE_SIZE, acceptedFileTypes, models = [], selectedModel = '', onModelChange, 'aria-label': ariaLabel = 'Message', value, onValueChange, tools, efforts = [], effort = '', onEffortChange }: Props) {
  // Controlled when the caller passes value and onValueChange, uncontrolled otherwise, like a plain <textarea>.
  const [local, setLocal] = useState(''); const message = value ?? local;
  const setMessage = (next: string) => { if (onValueChange) onValueChange(next); else setLocal(next); }; const [files, setFiles] = useState<FileWithPreview[]>([]); const [pasted, setPasted] = useState<PastedContent[]>([]);
  const [dragging, setDragging] = useState(false); const [note, setNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null); const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const ta = textareaRef.current; if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; }, [message]);
  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return; const incoming = Array.from(list); const room = maxFiles - files.length;
    if (room <= 0) { setNote(`Up to ${maxFiles} files; remove one to add another.`); return; }
    const notes: string[] = []; if (incoming.length > room) notes.push(`Only ${room} more ${room === 1 ? 'file' : 'files'} fit; the rest were not added.`);
    const accepted = incoming.slice(0, room).filter(file => {
      if (file.size > maxFileSize) { notes.push(`${file.name} (${formatFileSize(file.size)}) is over the ${formatFileSize(maxFileSize)} limit.`); return false; }
      if (acceptedFileTypes && !acceptedFileTypes.some(t => file.type.includes(t) || t === file.name.split('.').pop())) { notes.push(`${file.name} is not an accepted type.`); return false; }
      return true;
    });
    setNote(notes.join(' '));
    const next: FileWithPreview[] = accepted.map(file => ({ id: uid(), file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined, type: file.type || 'application/octet-stream' }));
    setFiles(prev => [...prev, ...next]);
    for (const item of next) if (isTextualFile(item.file)) readText(item.file).then(textContent => setFiles(prev => prev.map(f => f.id === item.id ? { ...f, textContent } : f)), () => setFiles(prev => prev.map(f => f.id === item.id ? { ...f, error: 'Could not read this file' } : f)));
  }, [files.length, maxFiles, maxFileSize, acceptedFileTypes]);
  const removeFile = (id: string) => setFiles(prev => { const gone = prev.find(f => f.id === id); if (gone?.preview) URL.revokeObjectURL(gone.preview); return prev.filter(f => f.id !== id); });
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter(i => i.kind === 'file');
    if (items.length && files.length < maxFiles) { e.preventDefault(); addFiles(items.map(i => i.getAsFile()).filter((f): f is File => Boolean(f))); return; }
    const text = e.clipboardData.getData('text');
    if (text && text.length > PASTE_THRESHOLD && pasted.length < 5) { e.preventDefault(); setPasted(prev => [...prev, { id: uid(), content: text, timestamp: new Date(), wordCount: text.split(/\s+/).filter(Boolean).length }]); }
  };
  const hasContent = Boolean(message.trim()) || files.length > 0 || pasted.length > 0;
  const canSend = hasContent && !disabled && !submitDisabled;
  const effortIndex = Math.max(0, efforts.findIndex(e => e.id === effort)); const effortName = efforts[effortIndex]?.name || '';
  const send = () => {
    if (!canSend) return;
    onSendMessage?.(message, files, pasted);
    setMessage(''); files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); }); setFiles([]); setPasted([]); setNote('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } };
  const drag = (on: boolean) => (e: DragEvent) => { e.preventDefault(); setDragging(on); };
  return <div className={`cci-root ${dragging ? 'cci-dragging' : ''}`} onDragOver={drag(true)} onDragLeave={drag(false)} onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
    {dragging && <div className="cci-drop" aria-hidden="true"><ImageIcon size={16}/>Drop files to add them to the message</div>}
    <div className="cci-card-shell">
      <textarea ref={textareaRef} value={message} onChange={e => setMessage(e.target.value)} onPaste={onPaste} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} rows={1} className="cci-textarea"/>
      <div className="cci-bar">
        <div className="cci-bar-left">
          {models.length > 0 && <ModelMenu models={models} selected={selectedModel} onChange={id => onModelChange?.(id)} disabled={disabled}/>}
          {efforts.length > 0 && <button type="button" className="cci-pill" disabled={disabled} aria-label={`Reasoning effort: ${effortName}. Click to change.`} title="Reasoning effort" onClick={() => onEffortChange?.(efforts[(effortIndex + 1) % efforts.length].id)}><DynamicBarsIcon level={effortIndex} count={efforts.length}/><span>{effortName}</span></button>}
          {tools}
          {note && <span className="cci-note" role="status">{note}</span>}
        </div>
        <div className="cci-bar-right">
          <button type="button" className="icon-button cci-tool" aria-label={files.length >= maxFiles ? `Up to ${maxFiles} files` : 'Attach files'} title="Attach files" disabled={disabled || files.length >= maxFiles} onClick={() => fileInputRef.current?.click()}><Plus size={16}/></button>
          <button type="button" className="cci-send" aria-label="Send message" title="Send message" onClick={send} disabled={!canSend}><ArrowUp size={16}/></button>
        </div>
      </div>
      {(files.length > 0 || pasted.length > 0) && <div className="cci-tray"><div className="cci-tray-row">
        {pasted.map(p => <Card key={p.id} badge="PASTED" text={p.content} onCopy={() => void navigator.clipboard?.writeText(p.content)} onRemove={() => setPasted(prev => prev.filter(x => x.id !== p.id))}/>)}
        {files.map(f => isTextualFile(f.file)
          ? <Card key={f.id} badge={extLabel(f.file.name)} text={f.textContent ?? ''} name={f.file.name} error={f.error} onCopy={f.textContent ? () => void navigator.clipboard?.writeText(f.textContent || '') : undefined} onRemove={() => removeFile(f.id)}/>
          : <Card key={f.id} badge={f.type} image={f.preview} name={f.file.name} size={formatFileSize(f.file.size)} error={f.error} onRemove={() => removeFile(f.id)}/>)}
      </div></div>}
    </div>
    <input ref={fileInputRef} type="file" multiple className="sr-only" aria-label="Choose files to attach" accept={acceptedFileTypes?.join(',')} onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }}/>
  </div>;
}
export default ClaudeChatInput;
