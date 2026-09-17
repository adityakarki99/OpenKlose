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

/**
 * Return pending feedback in a stable, agent-friendly shape. This avoids
 * making an agent scrape every project/node or depend on clipboard text.
 */
export async function listFeedback(cwd, { projectId } = {}) {
  const projects = projectId ? [await getProject(cwd, projectId)] : await listProjects(cwd);
  return projects.flatMap((project) =>
    (project.nodes || []).flatMap((node) =>
      (node.comments || []).map((comment) => ({
        projectId: project.id,
        projectName: project.name,
        nodeId: node.id,
        nodeName: node.name,
        builtFilePath: node.builtFilePath || null,
        commentId: comment.id,
        text: comment.text,
        createdAt: comment.createdAt,
        element: comment.element || null,
      }))
    )
  );
}

export function projectsWatchDir(cwd) {
  return projectsDir(cwd);
}

const DEMO_SKETCH_CODE = `export default function WelcomeCard() {
  return (
    <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
        <span>✦</span> Klose demo sketch
      </div>
      <h2 className="text-lg font-semibold text-slate-900">This is a sketch</h2>
      <p className="mt-2 text-sm text-slate-600">
        A live-rendered preview, not a labeled box. Leave a comment below, or click an element in
        the preview to scope feedback to it — then ask your agent to address it.
      </p>
      <button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
        Ask your agent to build this
      </button>
    </div>
  );
}
`;

// Gives a first-time `klose init` something on the canvas instead of an empty
// board. Only called when no projects exist yet, so it never clobbers real work.
export async function seedDemoProject(cwd) {
  const project = await createProject(cwd, 'Klose demo');
  const node = await addNode(cwd, project.id, {
    name: 'Welcome to Klose',
    description: 'A live-rendered preview, not a static mockup — this is what a sketch looks like.',
    notes:
      "Created by `klose init` so the canvas isn't empty on first run. Leave a comment on it (or " +
      'click an element in the preview) to see feedback flow back to your agent, then ask it to ' +
      'build something real for your project — that replaces this note with actual work.',
    code: DEMO_SKETCH_CODE,
  });
  return { project, node };
}

// Built sketches and empty projects are safe to remove: the real component
// already lives in the repo (for `built`), or there was never anything on the
// canvas to lose (for `emptyProjects`). Defaults to a dry run — nothing is
// written to disk unless `apply` is true, so callers can show the user what
// would happen before doing it.
export async function cleanup(cwd, { built = true, emptyProjects = true, apply = false } = {}) {
  await ensureDir(cwd);
  const files = (await readdir(projectsDir(cwd))).filter((f) => f.endsWith('.json'));
  const report = { removedNodes: [], removedProjects: [] };

  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    let project;
    try {
      project = await readProjectFile(cwd, id);
    } catch {
      continue; // not a project we wrote (invalid id or unparseable) — leave it alone
    }

    let nodes = project.nodes || [];
    let removedHere = [];
    if (built) {
      removedHere = nodes.filter((n) => n.status === 'built');
      nodes = nodes.filter((n) => n.status !== 'built');
    }

    if (emptyProjects && nodes.length === 0) {
      report.removedProjects.push({ projectId: id, projectName: project.name });
      report.removedNodes.push(
        ...removedHere.map((n) => ({ projectId: id, projectName: project.name, nodeId: n.id, name: n.name }))
      );
      if (apply) await unlink(projectFile(cwd, id));
      continue;
    }

    if (removedHere.length) {
      report.removedNodes.push(
        ...removedHere.map((n) => ({ projectId: id, projectName: project.name, nodeId: n.id, name: n.name }))
      );
      if (apply) {
        project.nodes = nodes;
        project.updated_at = new Date().toISOString();
        await writeProjectFile(cwd, project);
      }
    }
  }

  return report;
}
