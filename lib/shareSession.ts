/**
 * A shared canvas in the browser: the project at a link
 * (`<host>/canvas/#/s/<id>/<key>`, see server/shareCore.js), opened without
 * a folder or a server. The agent, wherever it runs, pushed the project to
 * the share host encrypted with the key in the link; this page pulls it,
 * keeps it in an in-memory folder so every page works as it does over a real
 * one, and syncs: what the user does here goes out within a second, what the
 * agent writes comes in every couple of seconds while the tab is visible.
 */
import { useSyncExternalStore } from 'react';
import { createFolderStore, memoryFolder } from './folderStore.js';
import { FolderFs, FolderSession, getSession, setSession } from './folderSession';
import {
  ShareError,
  decryptBundle,
  isBundle,
  isShareId,
  isShareKey,
  shareApi,
  shareClient,
  syncShare,
  mergeShared,
} from '../server/shareCore.js';

import { readRecovery, writeRecovery, rememberWorkspace } from './workspaceCache';

const PULL_MS = 2000;
const PUSH_DEBOUNCE_MS = 400;
const REMEMBER_KEY = 'klose:share';

export type ShareStatus = 'ok' | 'syncing' | 'offline' | 'gone' | 'storage-error';

export interface ShareLink {
  id: string;
  key: string;
  host: string;
}

/** The share this tab was on, so a reload comes back to it without a picker. */
export function rememberedShare(): ShareLink | null {
  try {
    const raw = sessionStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const link = JSON.parse(raw);
    return isShareId(link.id) && isShareKey(link.key) && typeof link.host === 'string' ? link : null;
  } catch {
    return null;
  }
}

function remember(link: ShareLink | null) {
  try {
    if (link) sessionStorage.setItem(REMEMBER_KEY, JSON.stringify(link));
    else sessionStorage.removeItem(REMEMBER_KEY);
  } catch {
    // A tab that can't remember just asks for the link again.
  }
}

// ----------------------------------------------------------------- status

let status: ShareStatus = 'ok';
const listeners = new Set<() => void>();
function setStatus(next: ShareStatus) {
  if (status === next) return;
  status = next;
  for (const fn of listeners) fn();
}
function subscribeStatus(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** How the open share's sync is doing, for the navbar. */
export function useShareStatus(): ShareStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => 'ok',
  );
}

// ------------------------------------------------------------------- open

type Project = { id: string; nodes?: unknown[]; name?: string } & Record<string, unknown>;

/**
 * Opens the link: fetches and decrypts the project, puts it in a memory
 * folder, and starts syncing. Rejects when the link is malformed, expired or
 * the key is wrong. The share host is the page's own origin: the link opens
 * the canvas on the site that hosts the API.
 */
export async function openShare(id: string, key: string, host = window.location.origin): Promise<FolderSession> {
  if (!isShareId(id) || !isShareKey(key)) throw new ShareError('Not a valid share link.', 400);
  const client = shareClient(shareApi(host));
  const recovery = await readRecovery(id, key).catch(() => null);
  let first;
  let initialStatus: ShareStatus = 'ok';
  try {
    first = await client.fetch(id);
  } catch (error) {
    if (!recovery) throw error;
    initialStatus = error instanceof ShareError && error.status === 404 ? 'gone' : 'offline';
  }
  const bundle = first ? await decryptBundle(key, first.payload) : recovery.bundle;
  if (!isBundle(bundle)) throw new ShareError('This link does not hold a Klose project.', 422);
  const project = (
    recovery ? mergeShared({ base: recovery.synced?.project, local: recovery.local, incoming: bundle.project }) : bundle.project
  ) as Project;
  const projectPath = ['.klose', 'projects', `${project.id}.json`];
  const raw = memoryFolder({ [projectPath.join('/')]: JSON.stringify(project, null, 2) });
  let synced: { etag: string; project: Project } = first ? { etag: first.etag, project: bundle.project } : recovery.synced;
  const extras = { themeCss: bundle.theme?.css || '', repoName: bundle.repo?.name || '' };
  let history: { at: number; project: Project }[] = recovery?.history || [];
  let storageFailed = false;
  let checkpointValue = '';
  let writeQueue: Promise<unknown> = Promise.resolve();
  const transact = <T>(task: () => Promise<T>): Promise<T> => {
    const done = writeQueue.catch(() => {}).then(task);
    writeQueue = done;
    return done;
  };
  const checkpoint = async (local: Project, previous?: Project) => {
    const nextHistory =
      previous && JSON.stringify(previous) !== JSON.stringify(local)
        ? [...history, { at: Math.max(Date.now(), (history.at(-1)?.at || 0) + 1), project: previous }].slice(-10)
        : history;
    const record = { bundle: { ...bundle, theme: { css: extras.themeCss }, project: local }, local, synced, history: nextHistory };
    const value = JSON.stringify(record);
    if (value === checkpointValue && !storageFailed) return;
    try {
      await writeRecovery(id, key, record);
      checkpointValue = value;
      history = nextHistory;
      storageFailed = false;
    } catch (error) {
      storageFailed = true;
      setStatus('storage-error');
      throw error;
    }
  };
  await checkpoint(project).catch(() => {});

  let busy = false;
  let again = false;
  let stopped = false;
  let pushTimer: number | null = null;

  const readLocal = async (): Promise<Project | null> => {
    const text = await raw.read(projectPath);
    return text ? (JSON.parse(text) as Project) : null;
  };

  /** One round with the host: the memory folder's version against the share's. */
  const sync = async () => {
    if (stopped || busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const local = await readLocal();
      if (JSON.stringify(local) !== JSON.stringify(synced.project)) setStatus('syncing');
      const result = await syncShare({ client, id, key, synced, local: local || synced.project, bundleExtras: extras });
      if (stopped) return;
      await transact(async () => {
        if (stopped) return;
        const latest = await readLocal();
        const merged = mergeShared({ base: local, local: latest, incoming: result.project }) as Project;
        synced = result.synced as typeof synced;
        if (result.bundle?.theme) extras.themeCss = result.bundle.theme.css || '';
        await checkpoint(merged, result.pulled ? latest : undefined);
        if (stopped) return;
        if (JSON.stringify(merged) !== JSON.stringify(latest)) await raw.write(projectPath, JSON.stringify(merged, null, 2));
        const pending = JSON.stringify(merged) !== JSON.stringify(synced.project);
        setStatus(pending ? 'syncing' : 'ok');
        if (pending) again = true;
      });
    } catch (err) {
      if (stopped) return;
      setStatus(storageFailed ? 'storage-error' : err instanceof ShareError && err.status === 404 ? 'gone' : 'offline');
    } finally {
      busy = false;
      if (again && !stopped) {
        again = false;
        void sync();
      }
    }
  };

  const schedulePush = () => {
    if (pushTimer !== null) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushTimer = null;
      void sync();
    }, PUSH_DEBOUNCE_MS);
  };

  // The folder the store sees: every write the canvas makes is pushed soon after.
  const fs: FolderFs = {
    list: (path, options) => raw.list(path, options),
    read: (path, options) => raw.read(path, options),
    async write(path, text) {
      return transact(async () => {
        if (path.join('/') === projectPath.join('/')) {
          const previous = await readLocal();
          await checkpoint(JSON.parse(text), previous || undefined);
          await raw.write(path, text);
          setStatus('syncing');
          schedulePush();
        } else await raw.write(path, text);
      });
    },
    remove: (path) => raw.remove(path),
  };

  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'hidden') void sync();
  }, PULL_MS);
  const onWake = () => void sync();
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', onWake);

  const session: FolderSession = {
    kind: 'share',
    name: extras.repoName || String(project.name || 'Shared canvas'),
    fs,
    store: createFolderStore(fs),
    share: { id, key, host, projectId: project.id },
    themeCss: extras.themeCss,
    retrySync: sync,
    revisions: () => history.map((r) => ({ at: r.at, name: String(r.project.name || 'Untitled') })),
    async restoreRevision(at: number) {
      const revision = history.find((r) => r.at === at);
      if (!revision) throw new Error('This revision is no longer available.');
      await fs.write(projectPath, JSON.stringify({ ...revision.project, updated_at: new Date().toISOString() }));
    },
    dispose() {
      stopped = true;
      window.clearInterval(timer);
      if (pushTimer !== null) window.clearTimeout(pushTimer);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
      remember(null);
      setStatus('ok');
    },
  };
  setSession(session);
  remember({ id, key, host });
  try {
    rememberWorkspace({
      id,
      key,
      host,
      name: String(project.name || 'Shared canvas'),
      openedAt: Date.now(),
      source: project.source ? JSON.stringify(project.source) : undefined,
    });
  } catch {
    /* Canvas still works without a recent list. */
  }
  setStatus(storageFailed ? 'storage-error' : initialStatus === 'ok' && JSON.stringify(project) !== JSON.stringify(synced.project) ? 'syncing' : initialStatus);
  if (initialStatus === 'ok' && JSON.stringify(project) !== JSON.stringify(synced.project)) schedulePush();
  return session;
}

/** The open share, if the open session is one. */
export function currentShare(): FolderSession | null {
  const s = getSession();
  return s?.kind === 'share' ? s : null;
}
