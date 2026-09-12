import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, notFound } from './errors.js';

// Project ids are always server-generated UUIDs (randomUUID()). Route params
// reach this file straight from the HTTP layer, so anything that isn't a
// well-formed UUID is rejected before it can influence a filesystem path.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw badRequest(`Invalid project id: ${JSON.stringify(id)}`, 'INVALID_PROJECT_ID');
  }
  return id;
}

function projectsDir(cwd) {
  return path.join(cwd, '.klose', 'projects');
}

function projectFile(cwd, id) {
  return path.join(projectsDir(cwd), `${assertValidId(id)}.json`);
}

async function ensureDir(cwd) {
  await mkdir(projectsDir(cwd), { recursive: true });
}

async function readProjectFile(cwd, id) {
  let raw;
  try {
    raw = await readFile(projectFile(cwd, id), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') throw notFound(`Project ${id} not found`, 'PROJECT_NOT_FOUND');
    throw err;
  }
  return JSON.parse(raw);
}

async function writeProjectFile(cwd, project) {
  await ensureDir(cwd);
  await writeFile(projectFile(cwd, project.id), JSON.stringify(project, null, 2), 'utf-8');
}

// Files whose names aren't well-formed UUIDs (or that don't parse as JSON) are
// skipped rather than failing the whole listing: ids have always been
// randomUUID(), so anything else in the directory isn't a project we wrote.
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
  if (!updatedNode) throw notFound(`Node ${nodeId} not found in project ${id}`, 'NODE_NOT_FOUND');
  project.updated_at = new Date().toISOString();
  await writeProjectFile(cwd, project);
  return updatedNode;
}

export function projectsWatchDir(cwd) {
  return projectsDir(cwd);
}
