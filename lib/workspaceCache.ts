/** Device-local recovery records. Contents (including history) are encrypted with the link key. */
import { decryptBundle, encryptBundle, isShareId, isShareKey } from '../server/shareCore.js';
export type RecentWorkspace = { id: string; key: string; host: string; name: string; openedAt: number; source?: string };
const RECENT = 'klose:recent-workspaces';
export function recentWorkspaces(): RecentWorkspace[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || '[]')
      .filter((r: RecentWorkspace) => isShareId(r.id) && isShareKey(r.key) && r.host === location.origin)
      .slice(0, 20);
  } catch {
    return [];
  }
}
export function rememberWorkspace(item: RecentWorkspace) {
  localStorage.setItem(RECENT, JSON.stringify([item, ...recentWorkspaces().filter((r) => r.id !== item.id)].slice(0, 20)));
}
export function forgetWorkspace(id: string) {
  localStorage.setItem(RECENT, JSON.stringify(recentWorkspaces().filter((r) => r.id !== id)));
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('klose-online-recovery', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function access(id: string, value?: unknown): Promise<any> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', value === undefined ? 'readonly' : 'readwrite');
    const store = tx.objectStore('drafts');
    const req = value === undefined ? store.get(id) : store.put(value, id);
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Recovery storage is unavailable.'));
    };
  });
}
export async function readRecovery(id: string, key: string) {
  const value = await access(id);
  return value ? decryptBundle(key, value) : null;
}
export async function writeRecovery(id: string, key: string, record: unknown) {
  await access(id, await encryptBundle(key, record));
}

/** Public GitHub context is cached by commit; never used for authenticated imports. */
export const publicContextCache = {
  get: (key: string) => access(`github:${key}`).catch(() => null),
  set: (key: string, value: unknown) => access(`github:${key}`, value).catch(() => undefined),
};
