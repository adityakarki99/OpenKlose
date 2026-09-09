import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';

function projectsDir(cwd) {
  return path.join(cwd, '.klose', 'projects');
}

function projectFile(cwd, id) {
  return path.join(projectsDir(cwd), `${id}.json`);
}

async function ensureDir(cwd) {
  await mkdir(projectsDir(cwd), { recursive: true });
}

async function readProjectFile(cwd, id) {
  const raw = await readFile(projectFile(cwd, id), 'utf-8');
  return JSON.parse(raw);
}

async function writeProjectFile(cwd, project) {
  await ensureDir(cwd);
  await writeFile(projectFile(cwd, project.id), JSON.stringify(project, null, 2), 'utf-8');
}

export async function listProjects(cwd) {
  await ensureDir(cwd);
  const files = (await readdir(projectsDir(cwd))).filter((f) => f.endsWith('.json'));
  const projects = await Promise.all(
    files.map(async (f) => {
      try {
        return await readProjectFile(cwd, f.replace(/\.json$/, ''));
      } catch {
        return null;
      }
    })
  );
  return projects
    .filter(Boolean)
    .map(({ id, name, description, nodes, created_at, updated_at }) => ({
      id,
      name,
      description,
      nodes,
      created_at,
      updated_at,
    }))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function getProject(cwd, id) {
  return readProjectFile(cwd, id);
}

export async function createProject(cwd, name = 'Untitled Project') {
  const now = new Date().toISOString();
  const project = {
    id: randomUUID(),
    name,
    description: '',
    nodes: [],
    designSystemPrompt: '',
    projectContext: {
      projectDescription: '',
      targetAudience: '',
      brandName: '',
      brandVoice: '',
      designReferences: '',
      techNotes: '',
      productInfo: '',
    },
    created_at: now,
    updated_at: now,
  };
  await writeProjectFile(cwd, project);
  return project;
}

export async function updateProject(cwd, id, updates) {
  const existing = await readProjectFile(cwd, id);
  const merged = { ...existing, ...updates, id, updated_at: new Date().toISOString() };
  await writeProjectFile(cwd, merged);
  return merged;
}

export async function deleteProject(cwd, id) {
  await unlink(projectFile(cwd, id));
}

export async function addNode(cwd, id, node) {
  const project = await readProjectFile(cwd, id);
  const newNode = { id: randomUUID(), status: 'sketch', ...node };
  project.nodes = [...(project.nodes || []), newNode];
  project.updated_at = new Date().toISOString();
  await writeProjectFile(cwd, project);
  return newNode;
}

export async function updateNode(cwd, id, nodeId, updates) {
  const project = await readProjectFile(cwd, id);
  let updatedNode = null;
  project.nodes = (project.nodes || []).map((n) => {
    if (n.id !== nodeId) return n;
    updatedNode = { ...n, ...updates };
    return updatedNode;
  });
  if (!updatedNode) throw new Error(`Node ${nodeId} not found in project ${id}`);
  project.updated_at = new Date().toISOString();
  await writeProjectFile(cwd, project);
  return updatedNode;
}

export function projectsWatchDir(cwd) {
  return projectsDir(cwd);
}
