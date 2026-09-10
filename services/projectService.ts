import { Project, ComponentNode, ProjectContext } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const listProjects = (): Promise<Project[]> => request('/projects');

export const getProject = (id: string): Promise<Project> => request(`/projects/${id}`);

export const createProject = (name: string = 'Untitled Project'): Promise<Project> =>
  request('/projects', { method: 'POST', body: JSON.stringify({ name }) });

export const saveProject = (
  id: string,
  updates: {
    name?: string;
    description?: string;
    nodes?: ComponentNode[];
    designSystemPrompt?: string;
    projectContext?: ProjectContext;
  }
): Promise<Project> => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });

export const deleteProject = (id: string): Promise<void> =>
  request(`/projects/${id}`, { method: 'DELETE' });

export const addNode = (projectId: string, node: Partial<ComponentNode>): Promise<ComponentNode> =>
  request(`/projects/${projectId}/nodes`, { method: 'POST', body: JSON.stringify(node) });
