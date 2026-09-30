import { Project, ComponentNode, ProjectContext, RepoSave } from '../types';
import { API_BASE, REPO_ID } from '../lib/repoScope';
import { getRepo, getServerInfo } from './hubService';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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

/** A file with one live demo sketch on it, for a first look at the canvas. */
export const createExampleProject = (): Promise<Project> =>
  request('/projects', { method: 'POST', body: JSON.stringify({ example: true }) });

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

/** Writes the project into the repo as files (README + one .tsx per sketch). */
export const saveProjectToRepo = (id: string): Promise<{ dir: string; files: string[]; repo: RepoSave }> =>
  request(`/projects/${id}/export`, { method: 'POST', body: '{}' });

/** Folder name of the repo this canvas is for. */
export const getRepoName = async (): Promise<string> => {
  if (REPO_ID) return (await getRepo(REPO_ID)).name;
  const { root } = await getServerInfo();
  return (root || '').split(/[\\/]/).filter(Boolean).pop() || '';
};

export const addNode = (projectId: string, node: Partial<ComponentNode>): Promise<ComponentNode> =>
  request(`/projects/${projectId}/nodes`, { method: 'POST', body: JSON.stringify(node) });
