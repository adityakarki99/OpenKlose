import { HubRepo, TrayState } from '../types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Request to ${url} failed (${res.status})`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/** Whether this server is a hub (many repos) or a single repo's canvas. */
export const getServerInfo = (): Promise<{ hub?: boolean; root: string | null; version: string | null }> => get('/api/health');

/** Every repo the hub sees: agents first, then most recently used. */
export const listRepos = async (): Promise<HubRepo[]> => (await get<{ repos: HubRepo[] }>('/api/repos')).repos;

export const getTray = (): Promise<TrayState> => get('/api/tray');

export const getRepo = (id: string): Promise<HubRepo> => get(`/api/repos/${id}`);

/** "now", "4m", "2h", "3d" — how long since something happened in a repo. */
export function sinceShort(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '—';
  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One line on what the agent in a repo is doing. */
export function agentLine(repo: HubRepo): string {
  if (!repo.agent) return 'No agent';
  const what = repo.agent === 'working' ? 'Working' : 'Idle';
  const more = repo.sessions > 1 ? ` · ${repo.sessions} sessions` : '';
  return repo.session?.name ? `${what} · ${repo.session.name}${more}` : `${what}${more}`;
}
