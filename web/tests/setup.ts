import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
beforeEach(()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());
  window.location.hash='';
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
  // jsdom is never idle: App's idle preload (lib/preload.ts) would otherwise import every lazy page,
  // Drawnix and tiptap included, into each test that renders App. preload.test.tsx drives it directly.
  vi.stubGlobal('requestIdleCallback',()=>0);
  vi.stubGlobal('cancelIdleCallback',()=>{});
  HTMLElement.prototype.scrollIntoView=()=>{};
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  URL.createObjectURL=vi.fn(()=> 'blob:test-fixture');
  URL.revokeObjectURL=vi.fn();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

