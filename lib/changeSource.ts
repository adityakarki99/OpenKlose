/**
 * Telling a page that the repo's projects changed under it, usually because
 * the agent's CLI wrote a sketch.
 *
 * On a server this is server-sent events, fed by a watch on .klose/projects/.
 * The hosted canvas has no process to watch the folder, so, like
 * excalidraw.com re-reading its storage when its tab comes back, it looks at
 * the project files' timestamps every little while and whenever the tab
 * regains focus. A handful of file reads; nothing while the tab is hidden.
 */
import { API_BASE } from './repoScope';
import { STATIC } from './mode';
import { getSession } from './folderSession';

const POLL_MS = 1500;

/** Calls `onUpdate` whenever the projects change on disk. Returns the unsubscribe. */
export function subscribeProjectChanges(onUpdate: () => void): () => void {
  if (!STATIC) {
    const source = new EventSource(`${API_BASE}/events`);
    source.addEventListener('update', onUpdate);
    return () => source.close();
  }

  let last: string | null = null;
  let stopped = false;
  let busy = false;

  const check = async () => {
    if (stopped || busy || document.visibilityState === 'hidden') return;
    const session = getSession();
    if (!session) return;
    busy = true;
    try {
      const stamp = await session.store.stamp();
      if (last !== null && stamp !== last) onUpdate();
      last = stamp;
    } catch {
      // A folder that just vanished, or a permission that lapsed: the next read on the page reports it.
    } finally {
      busy = false;
    }
  };

  void check();
  const timer = window.setInterval(check, POLL_MS);
  const onWake = () => void check();
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', onWake);
    document.removeEventListener('visibilitychange', onWake);
  };
}
