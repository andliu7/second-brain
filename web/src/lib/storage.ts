import type { Workspace, Doc, Activity, Page, Board, Todo, Todos } from '../types';
import { validateWorkspace } from '../../shared/validate.mjs';
// crypto.randomUUID exists only in a secure context: HTTPS, or localhost. Opened over plain
// http from another device, the browser withholds it and every id in the app throws, so
// nothing can be created at all. crypto.getRandomValues is NOT restricted that way, so the
// fallback is still proper randomness, laid out as a version 4 UUID by hand.
export const uid = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;                       // version 4
  b[8] = (b[8] & 0x3f) | 0x80;                       // variant 10xx
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const now = () => new Date().toISOString();
export const activity = (text: string, page: Page): Activity => ({ id: uid(), text, page, created: now() });
export const makeDoc = (name: string, content: string, kind: Doc['kind'] = 'note', tags: string[] = []): Doc => ({ id: uid(), name, content, kind, tags, pinned: false, created: now(), updated: now() });
// The board every workspace starts with, and what a workspace saved before the board existed gets on load.
export const defaultBoard = (): Board => ({ columns: [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done' }], cards: [], view: 'board' });
// The two todos every day starts with, until the user deletes one for good (todos.removedDefaults).
export const DEFAULT_TODOS: { key: string; text: string; minutes: number }[] = [{ key: 'read', text: 'Read for 15 minutes', minutes: 15 }, { key: 'write', text: 'Write for 15 minutes', minutes: 15 }];
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const defaultTodo = (key: string): Todo => { const d = DEFAULT_TODOS.find(t => t.key === key)!; return { id: uid(), text: d.text, done: false, category: 'other', minutes: d.minutes, defaultKey: key }; };
export const defaultTodos = (day = today()): Todos => ({ day, items: DEFAULT_TODOS.map(t => defaultTodo(t.key)), history: {}, removedDefaults: [] });
export function initialWorkspace(): Workspace {
  const guide = makeDoc('Welcome to your second brain', '# A little less scattered.\n\nThis is your personal workspace for the things you know, the things you are building, and the tools that help you get there.\n\n## A simple rhythm\n\nCapture an idea in Files. Turn it into a goal. Attach the right files and a skill in Chat when you need a thinking partner. Save what you create in Generate.\n\n## Your data\n\nNotes, files, goals, conversations, and generated images are saved in this browser on this device. Use Settings → Export backup to keep a portable copy. Cross-device sync is a future step.\n\n## Your existing work\n\nConnect the local library from Files to browse project documents; opening a source reads it, and saving a copy brings it into this workspace. Skills lists every Claude skill installed on this computer, read live.\n\nNo AI requests run until you send a message or start a generation.', 'note', ['Getting started']);
  guide.pinned = true;
  return { version: 1, docs: [guide], goals: [], conversations: [], generations: [], activity: [activity('Your workspace is ready', 'today')], board: defaultBoard(), todos: defaultTodos(), buyList: [] };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const req = indexedDB.open('second-brain-workspace', 1); req.onupgradeneeded = () => req.result.createObjectStore('workspace'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function loadWorkspace(): Promise<Workspace> {
  const db = await database();
  try { const saved = await new Promise<unknown>((resolve, reject) => { const req = db.transaction('workspace').objectStore('workspace').get('current'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); if (!saved) return initialWorkspace(); validateWorkspace(saved); return saved as Workspace; } finally { db.close(); }
}
export async function saveWorkspace(value: Workspace) {
  validateWorkspace(value);
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(value, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted')); }); } finally { db.close(); }
}
export function readData(file: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
export function download(name: string, data: Blob | string) { const url = typeof data === 'string' ? data : URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]/g, '_'); a.click(); if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function parseBackup(raw: string): Workspace { const value = JSON.parse(raw); validateWorkspace(value); return value; }

