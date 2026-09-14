"use client";

import * as React from 'react';
import { ArrowUp, AudioLines, Bot, Check, ChevronDown, Code2, Loader2, Mic, Plus, Sparkles, Square, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const SPRING = 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
const DEFAULT_MODELS = ['GPT 5.5', 'Opus 4.8', 'Gemini 3.5 Flash', 'Composer 2.5', 'GLM 5.2'];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'Max Effort'];

interface Attachment {
  id: string;
  file: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
}

export interface PromptInputMeta {
  model: string;
  effort: string;
  attachments: File[];
}

export interface PromptInputProps {
  /** Return false (or reject) to preserve the draft after an unsuccessful submission. */
  onSubmit?: (value: string, meta: PromptInputMeta) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  className?: string;
  models?: string[];
  efforts?: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxAttachments?: number;
  disabled?: boolean;
  submitDisabled?: boolean;
  ariaLabel?: string;
  sendLabel?: string;
  /** Hide unsupported transport features when embedding in a text-only chat. */
  showModelSelector?: boolean;
  showEffortSelector?: boolean;
}

// The Web Speech API is still vendor-prefixed in some browsers and absent from lib.dom.
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
}
interface SpeechRecognitionHandle {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type VoiceWindow = Window & {
  AudioContext?: typeof AudioContext;
  SpeechRecognition?: new () => SpeechRecognitionHandle;
  webkitSpeechRecognition?: new () => SpeechRecognitionHandle;
  webkitAudioContext?: typeof AudioContext;
};

function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = React.useState<number | 'auto'>('auto');
  const spanRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const span = spanRef.current;
    if (!span) return;
    const measure = () => setWidth(span.offsetWidth || 'auto');
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(span);
    return () => observer?.disconnect();
  }, [text]);
  return <span className="relative inline-flex max-w-full items-center justify-center overflow-hidden transition-[width] duration-300" style={{ width }}>
    <span ref={spanRef} className="invisible whitespace-nowrap px-1">{text}</span>
    <span key={text} className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300">{text}</span>
  </span>;
}

function ModelIcon({ model }: { model: string }) {
  // Local Lucide symbols represent model families without external logo requests.
  const Icon = /gemini/i.test(model) ? Sparkles : /composer/i.test(model) ? Code2 : /opus|claude/i.test(model) ? Zap : Bot;
  return <Icon size={14} aria-hidden="true" className="shrink-0 opacity-80" />;
}

function DynamicBarsIcon({ level, count }: { level: number; count: number }) {
  const filled = count <= 1 ? 3 : 1 + Math.round(level / (count - 1) * 2);
  return <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-end gap-0.5">{[5, 9, 13].map((height, index) =>
    <span key={height} className="w-[3px] rounded-sm bg-current transition-opacity duration-300" style={{ height, opacity: index < filled ? 1 : 0.3 }} />
  )}</span>;
}

function AttachmentThumb({ attachment, index, onRemove, onOpen, disabled }: {
  attachment: Attachment;
  index: number;
  onRemove: (id: string) => void;
  onOpen: (attachment: Attachment, button: HTMLButtonElement) => void;
  disabled: boolean;
}) {
  return <div className="group relative size-12 shrink-0 animate-in fade-in slide-in-from-top-3 zoom-in-90 duration-400" style={{ animationDelay: `${index * 35}ms`, animationFillMode: 'backwards' }}>
    <button type="button" onClick={event => onOpen(attachment, event.currentTarget)} aria-label={`Open preview of ${attachment.name}`}
      className="size-full overflow-hidden rounded-xl border border-border bg-muted transition-transform duration-200 hover:scale-[1.04] active:scale-[0.96]">
      <img src={attachment.url} alt={attachment.name} className="block size-full object-cover" draggable={false} />
    </button>
    <button type="button" disabled={disabled} onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}
      className="prompt-remove absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-card text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
      <X size={12} aria-hidden="true" />
    </button>
  </div>;
}

function AttachmentGalleryModal({ attachment, origin, onClose, dark }: {
  attachment: Attachment;
  origin: HTMLButtonElement;
  onClose: () => void;
  dark: boolean;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const originRect = React.useRef(origin.getBoundingClientRect());
  const [phase, setPhase] = React.useState<'opening' | 'open' | 'closing'>('opening');
  const [viewport, setViewport] = React.useState({ width: window.innerWidth, height: window.innerHeight });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  React.useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    closeRef.current?.focus();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setPhase('open')); });
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.removeEventListener('resize', resize);
      document.body.style.overflow = previousOverflow;
      dialog.close();
      if (origin.isConnected) origin.focus();
    };
  }, [origin]);
  React.useEffect(() => {
    if (phase !== 'closing') return;
    // Closing must also work with reduced motion or when no transition event fires.
    const timer = window.setTimeout(onClose, reducedMotion ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, onClose]);
  const naturalW = attachment.width || 800;
  const naturalH = attachment.height || 600;
  const scale = Math.min(Math.min(viewport.width * 0.86, 560) / naturalW, Math.min(viewport.height * 0.78, 720) / naturalH, 1.6);
  const open = phase === 'open';
  const geometry = open ? { top: (viewport.height - naturalH * scale) / 2, left: (viewport.width - naturalW * scale) / 2, width: naturalW * scale, height: naturalH * scale } : originRect.current;
  const close = () => setPhase('closing');
  return <dialog ref={dialogRef} className={cn('prompt-gallery', dark && 'dark')} aria-label={`Preview of ${attachment.name}`} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="fixed inset-0 bg-background/70 backdrop-blur-md transition-opacity duration-300" style={{ opacity: open ? 1 : 0 }} onClick={close} />
    <div className="fixed overflow-hidden bg-muted" style={{ top: geometry.top, left: geometry.left, width: geometry.width, height: geometry.height, borderRadius: open ? 20 : 12, boxShadow: open ? '0 24px 60px -12px rgb(0 0 0 / 0.35)' : 'none', transition: `all ${phase === 'closing' ? '0.3s ease-out' : `0.45s ${SPRING}`}` }}>
      <img src={attachment.url} alt={attachment.name} className="block size-full object-contain" draggable={false} />
    </div>
    <button ref={closeRef} type="button" aria-label="Close image preview" onClick={close} className="fixed right-4 top-4 flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-md"><X size={18} aria-hidden="true" /></button>
  </dialog>;
}

export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(function PromptInput({
  onSubmit, placeholder = 'Ask anything', className, models = DEFAULT_MODELS, efforts = DEFAULT_EFFORTS,
  defaultValue = '', value: controlledValue, onChange, maxAttachments = 6, disabled = false,
  submitDisabled = false, ariaLabel = 'Prompt', sendLabel = 'Send prompt', showModelSelector = true, showEffortSelector = true,
}, ref) {
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : localValue;
  const [expanded, setExpanded] = React.useState(Boolean(value));
  const [smoothResize, setSmoothResize] = React.useState(false);
  const [selectedModel, setSelectedModel] = React.useState(models[0] || DEFAULT_MODELS[0]);
  const model = models.includes(selectedModel) ? selectedModel : models[0] || DEFAULT_MODELS[0];
  const [effortIndex, setEffortIndex] = React.useState(Math.min(1, Math.max(0, efforts.length - 1)));
  const safeEffortIndex = Math.min(effortIndex, Math.max(0, efforts.length - 1));
  const [modelOpen, setModelOpen] = React.useState(false);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [activeAttachment, setActiveAttachment] = React.useState<{ attachment: Attachment; origin: HTMLButtonElement } | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [startingVoice, setStartingVoice] = React.useState(false);
  const [audioData, setAudioData] = React.useState<number[]>([0, 0, 0, 0, 0]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [textareaHeight, setTextareaHeight] = React.useState(68);
  const [fades, setFades] = React.useState({ top: 0, bottom: 0 });
  const [scrolling, setScrolling] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const modelButtonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const valueRef = React.useRef(value);
  const onChangeRef = React.useRef(onChange);
  const controlledRef = React.useRef(controlledValue !== undefined);
  const attachmentsRef = React.useRef<Attachment[]>([]);
  const mountedRef = React.useRef(true);
  const submitRef = React.useRef(false);
  const voiceSessionRef = React.useRef(0);
  const streamRef = React.useRef<MediaStream | null>(null);
  const contextRef = React.useRef<AudioContext | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const recognitionRef = React.useRef<SpeechRecognitionHandle | null>(null);
  const modelMenuId = React.useId();
  const statusId = React.useId();
  const locked = disabled || submitting;
  const hasValue = Boolean(value.trim()) || attachments.length > 0;
  const attachmentLimit = Number.isFinite(maxAttachments) ? Math.max(0, Math.floor(maxAttachments)) : 6;

  React.useLayoutEffect(() => { valueRef.current = value; onChangeRef.current = onChange; controlledRef.current = controlledValue !== undefined; }, [value, onChange, controlledValue]);
  const changeValue = React.useCallback((next: string) => {
    valueRef.current = next;
    setSmoothResize(true);
    if (!controlledRef.current) setLocalValue(next);
    onChangeRef.current?.(next);
  }, []);
  const replaceAttachments = React.useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);
  const releaseVoice = React.useCallback(() => {
    voiceSessionRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = recognition.onerror = recognition.onresult = null;
      try { recognition.stop(); } catch { /* The browser may already have stopped it. */ }
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);
  const stopRecording = React.useCallback(() => {
    releaseVoice();
    setRecording(false);
    setStartingVoice(false);
    setAudioData([0, 0, 0, 0, 0]);
  }, [releaseVoice]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseVoice();
      attachmentsRef.current.forEach(attachment => URL.revokeObjectURL(attachment.url));
    };
  }, [releaseVoice]);
  React.useEffect(() => { if (disabled) stopRecording(); }, [disabled, stopRecording]);
  React.useEffect(() => { if (hasValue) setExpanded(true); }, [hasValue]);
  React.useEffect(() => {
    if (!expanded || recording || locked) return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      // A quick click into the menu or preview must win over delayed autofocus.
      if (active === document.body || active === textareaRef.current || active?.getAttribute('aria-label') === 'Open prompt input') textareaRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [expanded, recording, locked]);

  const updateFades = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setFades({ top: Math.min(textarea.scrollTop / 20, 1), bottom: Math.min(Math.max(textarea.scrollHeight - textarea.clientHeight - textarea.scrollTop - 16, 0) / 10, 1) });
  }, []);
  const resizeTextarea = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const height = Math.max(68, Math.min(textarea.scrollHeight, 160));
    setScrolling(textarea.scrollHeight > 160);
    textarea.style.height = `${height}px`;
    setTextareaHeight(height);
    updateFades();
  }, [updateFades]);
  React.useLayoutEffect(resizeTextarea, [value, expanded, resizeTextarea]);
  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let lastWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== lastWidth) { lastWidth = element.clientWidth; resizeTextarea(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [resizeTextarea]);
  React.useEffect(() => { if (recording && textareaRef.current) { textareaRef.current.scrollTop = textareaRef.current.scrollHeight; updateFades(); } }, [value, recording, updateFades]);
  React.useEffect(() => {
    if (!modelOpen) return;
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[Math.max(0, models.indexOf(model))]?.focus();
    const outside = (event: PointerEvent) => { if (!containerRef.current?.contains(event.target as Node)) setModelOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [modelOpen, model, models]);

  async function startRecording() {
    if (locked || startingVoice || recording) return;
    setError('');
    setExpanded(true);
    setModelOpen(false);
    setSmoothResize(false);
    const voiceWindow = window as VoiceWindow;
    const Recognition = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if (!Recognition || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice input is unavailable in this browser. You can still type your prompt.');
      return;
    }
    const session = ++voiceSessionRef.current;
    setStartingVoice(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || session !== voiceSessionRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const AudioContextClass = voiceWindow.AudioContext || voiceWindow.webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        contextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 64;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const visualize = () => {
          if (session !== voiceSessionRef.current) return;
          analyser.getByteFrequencyData(data);
          const step = Math.floor(data.length / 5);
          setAudioData(Array.from({ length: 5 }, (_, band) => {
            let sum = 0;
            for (let i = 0; i < step; i++) sum += data[band * step + i];
            return sum / step / 255;
          }));
          rafRef.current = requestAnimationFrame(visualize);
        };
        visualize();
      }
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';
      const baseline = valueRef.current.trim();
      recognition.onresult = event => {
        if (session !== voiceSessionRef.current) return;
        // Rebuild from all session results so interim replacements never duplicate words.
        const transcript = Array.from(event.results).map(result => result[0].transcript).join(' ').trim();
        changeValue([baseline, transcript].filter(Boolean).join(' '));
      };
      recognition.onerror = event => { setError(event.error === 'not-allowed' ? 'Microphone access was denied. Allow access in your browser to use voice input.' : 'Voice input stopped. Please try again or type your prompt.'); stopRecording(); };
      recognition.onend = stopRecording;
      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
      setStartingVoice(false);
    } catch {
      if (!mountedRef.current || session !== voiceSessionRef.current) return;
      stopRecording();
      setError('Could not start voice input. Check microphone access and try again.');
    }
  }

  function handleFilesChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (locked) return;
    const images = files.filter(file => file.type.startsWith('image/'));
    const room = Math.max(0, attachmentLimit - attachmentsRef.current.length);
    setError(images.length !== files.length ? 'Only image attachments are supported.' : images.length > room ? `You can attach up to ${attachmentLimit} images.` : '');
    const additions = images.slice(0, room).map(file => ({ id: crypto.randomUUID(), file, name: file.name, url: URL.createObjectURL(file) }));
    if (!additions.length) return;
    setExpanded(true);
    setSmoothResize(true);
    // Reserve slots immediately, before asynchronous image decoding finishes.
    replaceAttachments([...attachmentsRef.current, ...additions]);
    for (const attachment of additions) {
      const image = new Image();
      image.onload = () => {
        if (!mountedRef.current || !attachmentsRef.current.some(item => item.id === attachment.id)) return;
        replaceAttachments(attachmentsRef.current.map(item => item.id === attachment.id ? { ...item, width: image.naturalWidth, height: image.naturalHeight } : item));
      };
      image.onerror = () => {
        if (!mountedRef.current || !attachmentsRef.current.some(item => item.id === attachment.id)) return;
        removeAttachment(attachment.id);
        setError(`Could not open ${attachment.name}. Choose a supported image file.`);
      };
      image.src = attachment.url;
    }
  }
  function removeAttachment(id: string) {
    const target = attachmentsRef.current.find(item => item.id === id);
    if (target) URL.revokeObjectURL(target.url);
    replaceAttachments(attachmentsRef.current.filter(item => item.id !== id));
    setSmoothResize(true);
  }
  async function handleSubmit() {
    if (!hasValue || locked || submitDisabled || recording || startingVoice || submitRef.current || !onSubmit) return;
    submitRef.current = true;
    setSubmitting(true);
    setError('');
    setModelOpen(false);
    try {
      const accepted = await onSubmit(value, { model, effort: efforts[safeEffortIndex] || '', attachments: attachmentsRef.current.map(item => item.file) });
      if (accepted === false || !mountedRef.current) return;
      changeValue('');
      attachmentsRef.current.forEach(item => URL.revokeObjectURL(item.url));
      replaceAttachments([]);
      setActiveAttachment(null);
      setSmoothResize(false);
      setExpanded(false);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Could not send your prompt. Please try again.');
    } finally {
      submitRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }
  const expand = () => { setSmoothResize(false); setExpanded(true); };
  const isVoiceActive = recording || startingVoice;
  const actionLabel = isVoiceActive ? 'Stop recording' : hasValue ? sendLabel : 'Use voice input';
  const transition = `max-width ${smoothResize ? '0.15s ease-out' : `0.4s ${SPRING}`}, height ${smoothResize ? '0.15s ease-out' : `0.4s ${SPRING}`}`;
  const toolbarVisible = expanded && !isVoiceActive;

  return <div ref={node => { containerRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
    className={cn('prompt-input relative flex w-full min-w-0 flex-col', className)} style={{ maxWidth: expanded ? 480 : 320, transition }}
    onBlur={event => {
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setModelOpen(false);
      if (!value.trim() && !attachments.length && !isVoiceActive && !activeAttachment) { setSmoothResize(false); setExpanded(false); }
    }}>
    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilesChosen} className="hidden" tabIndex={-1} aria-label="Attach images" disabled={locked} />
    <div aria-hidden={!attachments.length} className="relative z-0 w-full overflow-hidden" style={{ height: attachments.length && expanded ? 68 : 0, transition }}>
      <div className="prompt-scrollbar absolute inset-x-5 -bottom-2 flex h-[68px] items-start gap-2 overflow-x-auto rounded-t-2xl border border-b-0 border-border bg-muted px-2 pb-1 pt-2" style={{ transform: attachments.length && expanded ? 'translateY(0)' : 'translateY(100%)', transition: `transform 0.4s ${SPRING}` }}>
        {attachments.map((attachment, index) => <AttachmentThumb key={attachment.id} attachment={attachment} index={index} disabled={locked} onRemove={removeAttachment} onOpen={(item, origin) => setActiveAttachment({ attachment: item, origin })} />)}
      </div>
    </div>
    <div className="relative z-10 w-full rounded-3xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/60 focus-within:ring-1 focus-within:ring-ring/20 hover:border-ring/40"
      style={{ height: expanded ? textareaHeight + 56 : 48, transition, overflow: expanded ? 'visible' : 'hidden' }}>
      <textarea ref={textareaRef} value={value} onChange={event => changeValue(event.target.value)} onScroll={updateFades}
        onFocus={expand} placeholder={placeholder} aria-label={ariaLabel} aria-describedby={error || isVoiceActive ? statusId : undefined}
        readOnly={isVoiceActive} disabled={locked} tabIndex={expanded ? 0 : -1} aria-hidden={!expanded}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void handleSubmit(); }
          if (event.key === 'Escape' && !hasValue) { setExpanded(false); setModelOpen(false); }
        }}
        style={{ height: textareaHeight, transition: smoothResize ? 'height 0.15s ease-out' : `opacity 0.3s ease-out, transform 0.3s ease-out, height 0.4s ${SPRING}` }}
        className={cn('prompt-scrollbar absolute inset-x-0 top-0 z-[1] w-full resize-none border-0 bg-transparent py-3.5 pl-4 pr-12 text-sm leading-[22px] text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground', expanded ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-95 opacity-0', scrolling ? 'overflow-y-auto' : 'overflow-y-hidden')} />
      <div className="pointer-events-none absolute left-4 right-12 top-0 z-[2] h-8 bg-gradient-to-b from-card via-card/90 to-transparent" style={{ opacity: fades.top }} />
      <div className="pointer-events-none absolute left-4 right-12 z-[2] h-8 bg-gradient-to-t from-card via-card/90 to-transparent" style={{ opacity: fades.bottom, top: textareaHeight - 32 }} />
      <button type="button" onClick={expand} disabled={locked} tabIndex={expanded ? -1 : 0} aria-hidden={expanded} aria-label="Open prompt input" aria-expanded={expanded}
        className={cn('absolute inset-x-0 top-0 z-[1] cursor-text truncate py-[15px] pl-4 pr-12 text-left text-sm font-medium leading-[17px] text-muted-foreground transition-all duration-400', expanded ? 'pointer-events-none translate-y-1 scale-105 opacity-0' : 'translate-y-0 scale-100 opacity-100')}>{placeholder}</button>
      <div inert={!toolbarVisible} aria-hidden={!toolbarVisible} className={cn('absolute bottom-1 left-2 right-12 z-10 flex min-w-0 items-center transition-all duration-300', toolbarVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0 blur-sm')}>
        {showModelSelector && <div className="relative min-w-0 shrink">
          <button ref={modelButtonRef} type="button" disabled={locked} onClick={() => setModelOpen(!modelOpen)} aria-haspopup="menu" aria-expanded={modelOpen} aria-controls={modelMenuId} aria-label={`Select model. Current: ${model}`}
            className={cn('prompt-tool flex h-10 max-w-full items-center gap-1 rounded-full px-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground', modelOpen && 'bg-accent/60 text-foreground')}>
            <ModelIcon model={model} /><span className="min-w-0 truncate text-xs font-semibold"><MorphingText text={model} /></span><ChevronDown size={11} aria-hidden="true" />
          </button>
          {modelOpen && <div id={modelMenuId} ref={menuRef} role="menu" aria-label="Models" onMouseLeave={() => setHoverIndex(null)}
            onKeyDown={event => {
              const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
              }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setModelOpen(false); modelButtonRef.current?.focus(); }
            }}
            className="absolute bottom-full left-0 z-50 mb-2.5 flex w-52 max-w-[calc(100vw-48px)] origin-bottom-left flex-col gap-0.5 rounded-2xl border border-border bg-card/95 p-1 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 slide-in-from-bottom-3 duration-300">
            <div className="pointer-events-none absolute left-1 right-1 top-1 h-10 rounded-xl bg-accent transition-all duration-200" style={{ opacity: hoverIndex === null ? 0 : 1, transform: `translateY(${(hoverIndex || 0) * 42}px)` }} />
            {(models.length ? models : DEFAULT_MODELS).map((item, index) => <button key={item} type="button" role="menuitemradio" aria-checked={model === item} onFocus={() => setHoverIndex(index)} onMouseEnter={() => setHoverIndex(index)}
              onClick={() => { setSelectedModel(item); setModelOpen(false); modelButtonRef.current?.focus(); }}
              className="relative flex h-10 w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition-transform active:scale-[0.98]">
              <span className="flex min-w-0 items-center gap-2"><ModelIcon model={item} /><span className="truncate">{item}</span></span>{model === item && <Check size={13} aria-hidden="true" />}
            </button>)}
          </div>}
        </div>}
        {showEffortSelector && efforts.length > 0 && <button type="button" disabled={locked} onClick={() => setEffortIndex((safeEffortIndex + 1) % efforts.length)} aria-label={`Reasoning effort: ${efforts[safeEffortIndex]}. Click to change.`}
          className="prompt-tool flex h-10 min-w-0 shrink-0 items-center gap-1 rounded-full px-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <DynamicBarsIcon level={safeEffortIndex} count={efforts.length} /><span className="text-xs font-semibold"><MorphingText text={efforts[safeEffortIndex]} /></span>
        </button>}
        {attachmentLimit > 0 && <button type="button" disabled={locked || attachments.length >= attachmentLimit} onClick={() => fileInputRef.current?.click()} aria-label="Add images" title={`Attach up to ${attachmentLimit} images`}
          className="prompt-tool prompt-icon-tool ml-auto flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-40"><Plus size={16} aria-hidden="true" /></button>}
        {!showModelSelector && !showEffortSelector && <span className="flex h-10 items-center gap-1.5 px-2 text-xs text-muted-foreground"><AudioLines size={14} aria-hidden="true" />Shift + Enter for a new line</span>}
      </div>
      <div aria-hidden="true" className={cn('absolute bottom-2 right-14 z-10 flex h-8 items-center gap-[3px] transition-all duration-300', recording ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-4 opacity-0')}>
        {audioData.map((level, index) => <span key={index} className="w-1 rounded-full bg-primary transition-[height] duration-75" style={{ height: Math.max(4, level * 24) }} />)}
      </div>
      <button type="button" disabled={locked || (hasValue && !isVoiceActive && (submitDisabled || !onSubmit))} aria-label={actionLabel} aria-busy={submitting || startingVoice}
        onClick={() => { if (isVoiceActive) stopRecording(); else if (hasValue) void handleSubmit(); else void startRecording(); }}
        className="prompt-icon-tool absolute bottom-1 right-1 z-10 flex size-10 items-center justify-center rounded-full text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="relative flex size-8 items-center justify-center rounded-full bg-primary">
          {submitting || startingVoice ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <>
            <ArrowUp size={14} aria-hidden="true" className={cn('absolute transition-all duration-300', hasValue && !recording ? 'scale-100 opacity-100' : 'rotate-45 scale-50 opacity-0')} />
            <Mic size={14} aria-hidden="true" className={cn('absolute transition-all duration-300', !hasValue && !recording ? 'scale-100 opacity-100' : '-rotate-45 scale-50 opacity-0')} />
            <Square size={12} fill="currentColor" aria-hidden="true" className={cn('absolute transition-all duration-300', recording ? 'scale-100 opacity-100' : 'rotate-45 scale-50 opacity-0')} />
          </>}
        </span>
      </button>
    </div>
    {(error || isVoiceActive) && <p id={statusId} role={error ? 'alert' : 'status'} className={cn('mt-2 px-3 text-xs leading-relaxed', error ? 'text-destructive' : 'text-muted-foreground')}>{error || (startingVoice ? 'Waiting for microphone access…' : 'Listening… Select stop when you are finished.')}</p>}
    {activeAttachment && <AttachmentGalleryModal attachment={activeAttachment.attachment} origin={activeAttachment.origin} onClose={() => setActiveAttachment(null)} dark={Boolean(containerRef.current?.closest('.dark'))} />}
  </div>;
});

PromptInput.displayName = 'PromptInput';
