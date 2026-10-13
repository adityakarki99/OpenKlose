/**
 * The repo folder the hosted canvas works in.
 *
 * excalidraw.com keeps your drawing in the browser and saves it as a file you
 * pick; Klose's data already is files, under .klose/ in the repo. So the
 * hosted canvas asks for the repo folder once (the File System Access API,
 * Chromium browsers only), remembers the handle in IndexedDB, and from then on
 * reads and writes .klose/ in it directly: no server, no account, nothing
 * leaves the machine. The agent's CLI writes the same files.
 */
import { useSyncExternalStore } from 'react';
import { createFolderStore } from './folderStore.js';

export interface FolderEntry {
  name: string;
  kind: 'file' | 'directory';
  lastModified?: number;
  size?: number;
}

/** What lib/folderStore.js needs from a folder. */
export interface FolderFs {
  list(path: string[], options?: { stat?: boolean }): Promise<FolderEntry[]>;
  read(path: string[], options?: { maxBytes?: number }): Promise<string | null>;
  write(path: string[], text: string): Promise<void>;
  remove(path: string[]): Promise<void>;
}

// The parts of the File System Access API this file uses. TypeScript's DOM
// typings lag the API, so they are spelled out here rather than relied on.
export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}

export interface DirHandleLike {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<FileHandleLike | DirHandleLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<string>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<string>;
}

type PickerWindow = Window & { showDirectoryPicker?: (options?: Record<string, unknown>) => Promise<DirHandleLike> };

/** Whether this browser can open a folder (Chrome, Edge and other Chromium browsers). */
export const isFolderApiSupported = (): boolean =>
  typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');

/** A folder handle as the store sees it. */
export function folderFs(root: DirHandleLike): FolderFs {
  async function dir(path: string[], create: boolean): Promise<DirHandleLike | null> {
    let handle = root;
    for (const name of path) {
      try {
        handle = await handle.getDirectoryHandle(name, { create });
      } catch (err) {
        if (!create && isNotFound(err)) return null;
        throw err;
      }
    }
    return handle;
  }

  return {
    async list(path, { stat = false } = {}) {
      const handle = await dir(path, false);
      if (!handle) return [];
      const out: FolderEntry[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file') out.push({ name: entry.name, kind: 'directory' });
        else if (!stat) out.push({ name: entry.name, kind: 'file' });
        else {
          const file = await entry.getFile();
          out.push({ name: entry.name, kind: 'file', lastModified: file.lastModified, size: file.size });
        }
      }
      return out;
    },

    async read(path, { maxBytes } = {}) {
      const handle = await dir(path.slice(0, -1), false);
      if (!handle) return null;
      try {
        const file = await (await handle.getFileHandle(path[path.length - 1])).getFile();
        if (maxBytes !== undefined && file.size > maxBytes) return null;
        return await file.text();
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    // `createWritable` writes to a temporary file and swaps it in on close, so
    // the CLI never reads a half-written project.
    async write(path, text) {
      const handle = await dir(path.slice(0, -1), true);
      const file = await handle!.getFileHandle(path[path.length - 1], { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(text);
        await writable.close();
      } catch (err) {
        await writable.abort?.().catch(() => {});
        throw err;
      }
    },

    async remove(path) {
      const handle = await dir(path.slice(0, -1), false);
      if (!handle) {
        const err = new Error(`No such file: ${path.join('/')}`);
        err.name = 'NotFoundError';
        throw err;
      }
      await handle.removeEntry(path[path.length - 1]);
    },
  };
}

// ---------------------------------------------------------------- remembering

const DB_NAME = 'klose-hosted';
const DB_STORE = 'folders';
const DB_KEY = 'repo';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const request = run(tx.objectStore(DB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      })
  );
}

/** Keeps the folder for next time. Best effort: a browser that can't store handles just asks again. */
export async function rememberFolder(handle: DirHandleLike): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(handle, DB_KEY));
  } catch {
    // Private windows, cleared site data, handles that can't be stored.
  }
}

export async function rememberedFolder(): Promise<DirHandleLike | null> {
  try {
    return (await withStore<DirHandleLike | undefined>('readonly', (store) => store.get(DB_KEY))) || null;
  } catch {
    return null;
  }
}

export async function forgetFolder(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(DB_KEY));
  } catch {
    // Nothing to forget.
  }
}

/**
 * Whether the page may read and write the folder. A remembered handle needs
 * the user's say-so again after a reload; call this from a click.
 */
export async function ensurePermission(handle: DirHandleLike): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Opens the browser's folder picker. Call from a click; rejects with AbortError when dismissed. */
export function pickFolder(): Promise<DirHandleLike> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return Promise.reject(new Error('This browser cannot open folders.'));
  return picker.call(window, { mode: 'readwrite', id: 'klose-repo' });
}

// ------------------------------------------------------------------- session

export interface FolderSession {
  /**
   * 'folder': the repo folder the browser was given (this file).
   * 'share':  a project at a link, kept in step with a share host
   *           (lib/shareSession.ts); the folder is in memory.
   */
  kind: 'folder' | 'share';
  /** The folder's name: the repo. */
  name: string;
  handle?: DirHandleLike;
  fs: FolderFs;
  store: ReturnType<typeof createFolderStore>;
  /** On a share: the link's parts, and what the agent's checkout sent along. */
  share?: { id: string; key: string; host: string; projectId: string };
  themeCss?: string;
  /** On a share: lets the session end its sync loop when it closes. */
  dispose?: () => void;
}

let current: FolderSession | null = null;
const listeners = new Set<() => void>();
let markerTimer: number | null = null;

const MARKER_EVERY_MS = 60_000;

function notify() {
  for (const fn of listeners) fn();
}

/** Tells the CLI and the skill that the hosted canvas has this repo open (see folderStore.writeCanvasMarker). */
function touchMarker() {
  if (!current || current.kind !== 'folder' || document.visibilityState === 'hidden') return;
  current.store.writeCanvasMarker({ url: window.location.href.split('#')[0] }).catch(() => {});
}

export function getSession(): FolderSession | null {
  return current;
}

export function openSession(handle: DirHandleLike): FolderSession {
  const fs = folderFs(handle);
  setSession({ kind: 'folder', name: handle.name, handle, fs, store: createFolderStore(fs) });
  return current!;
}

/** Makes `session` the open one (a folder here, a share from lib/shareSession.ts), closing whatever was open. */
export function setSession(session: FolderSession): void {
  current?.dispose?.();
  current = session;
  touchMarker();
  if (markerTimer === null) markerTimer = window.setInterval(touchMarker, MARKER_EVERY_MS);
  notify();
}

export function closeSession(): void {
  current?.dispose?.();
  current = null;
  if (markerTimer !== null) window.clearInterval(markerTimer);
  markerTimer = null;
  notify();
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The open folder, re-rendering when it changes. */
export function useFolderSession(): FolderSession | null {
  return useSyncExternalStore(subscribeSession, getSession, () => null);
}
