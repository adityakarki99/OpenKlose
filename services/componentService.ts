import { ComponentIndex } from '../types';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
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
