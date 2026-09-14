import type { Workspace, Doc, Activity, Page } from '../types';
import { validateWorkspace } from '../../shared/validate.mjs';
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const activity = (text: string, page: Page): Activity => ({ id: uid(), text, page, created: now() });
export const makeDoc = (name: string, content: string, kind: Doc['kind'] = 'note', tags: string[] = []): Doc => ({ id: uid(), name, content, kind, tags, pinned: false, created: now(), updated: now() });
export function initialWorkspace(): Workspace {
  const guide = makeDoc('Welcome to your second brain', '# A little less scattered.\n\nThis is your personal workspace for the things you know, the things you are building, and the tools that help you get there.\n\n## A simple rhythm\n\nCapture an idea in Files. Turn it into a goal. Attach the right files and a skill in Chat when you need a thinking partner. Save what you create in Generate.\n\n## Your data\n\nNotes, files, goals, conversations, and generated images are saved in this browser on this device. Use Settings → Export backup to keep a portable copy. Cross-device sync is a future step.\n\n## Your existing work\n\nConnect the local library from Files to browse project documents; opening a source reads it, and saving a copy brings it into this workspace. Skills lists every Claude skill installed on this computer, read live.\n\nNo AI requests run until you send a message or start a generation.', 'note', ['Getting started']);
  guide.pinned = true;
  return { version: 1, docs: [guide], goals: [], conversations: [], generations: [], activity: [activity('Your workspace is ready', 'overview')] };
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

