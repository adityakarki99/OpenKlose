import { ClassifySummary, ComponentIndex, ComponentRanking } from '../types';
import { API_BASE } from '../lib/repoScope';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

/** Search the host repo's real components. Pass `refresh` to force a re-scan. */
export const listComponents = (query?: string, refresh = false): Promise<ComponentIndex> => {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (refresh) params.set('refresh', '1');
  const qs = params.toString();
  return request(`/components${qs ? `?${qs}` : ''}`);
};

/** Read a single component file's source for the detail view. */
export const getComponentSource = (file: string): Promise<{ file: string; source: string }> =>
  request(`/component-source?file=${encodeURIComponent(file)}`);

/** Ask Jev what each not-yet-classified component is. Costs a request per new component. */
export const classifyComponents = (): Promise<ClassifySummary> =>
  request('/components/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

/** Search this repo's components by meaning. */
export const rankComponents = (query: string): Promise<ComponentRanking> =>
  request(`/components/rank?q=${encodeURIComponent(query)}`);

/** On a hub: search every repo's components by meaning. */
export async function rankAllRepos(query: string): Promise<ComponentRanking> {
  const res = await fetch(`/api/rank?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Search failed (${res.status})`);
  }
  return res.json();
}
