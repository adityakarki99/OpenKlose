/**
 * The project store for a canvas that runs without a server: the same
 * records as server/store.js, read and written through a folder the browser
 * was given (the File System Access API) instead of node:fs. The agent's CLI
 * keeps writing the same files, so nothing on its side changes.
 *
 * Takes the folder as a small interface so it can be tested with an
 * in-memory one; lib/folderSession.ts provides the real one. Paths are arrays
 * of names relative to the repo root. Everything written lands under
 * `.klose/`, never anywhere else in the repo.
 *
 * @typedef {{ name: string, kind: 'file' | 'directory', lastModified?: number, size?: number }} Entry
 * @typedef {{
 *   list(path: string[], options?: { stat?: boolean }): Promise<Entry[]>,
 *   read(path: string[], options?: { maxBytes?: number }): Promise<string | null>,
 *   write(path: string[], text: string): Promise<void>,
 *   remove(path: string[]): Promise<void>,
 * }} FolderFs
 *
 * `list` fills in `lastModified` and `size` only when asked (`stat: true`):
 * each costs a file read in the browser. `read` answers null for a missing
 * file, and for one larger than `maxBytes`.
 */
import {
  DEMO_NODE,
  DEMO_PROJECT_NAME,
  KLOSE_GITIGNORE,
  feedbackOf,
  isValidId,
  newProject,
  nextUpdatedAt,
  placeNode,
  projectSummary,
} from '../server/storeCore.js';

export const KLOSE_DIR = '.klose';
export const PROJECTS = [KLOSE_DIR, 'projects'];

export class StoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
  }
}

const notFound = (message, code) => new StoreError(message, code, 404);

function assertValidId(id) {
  if (!isValidId(id)) throw new StoreError(`Invalid project id: ${JSON.stringify(id)}`, 'INVALID_PROJECT_ID');
  return id;
}

/**
 * @param {FolderFs} fs
 * @param {{ uuid?: () => string, now?: () => number }} [options]
 */
export function createFolderStore(fs, { uuid = () => globalThis.crypto.randomUUID(), now = () => Date.now() } = {}) {
  const projectFile = (id) => [...PROJECTS, `${assertValidId(id)}.json`];

  async function readProject(id) {
    const raw = await fs.read(projectFile(id));
    if (raw === null) throw notFound(`Project ${id} not found`, 'PROJECT_NOT_FOUND');
    return JSON.parse(raw);
  }

  let gitignoreChecked = false;
  /** Makes sure the per-machine files Klose writes under .klose/ stay out of git. */
  async function ensureGitignore() {
    if (gitignoreChecked) return;
    gitignoreChecked = true;
    const file = [KLOSE_DIR, '.gitignore'];
    const current = (await fs.read(file)) || '';
    const lines = current.split('\n').map((l) => l.trim()).filter(Boolean);
    const missing = KLOSE_GITIGNORE.filter((l) => !lines.includes(l));
    if (missing.length) await fs.write(file, [...lines, ...missing].join('\n') + '\n');
  }

  async function writeProject(project) {
    await ensureGitignore();
    await fs.write(projectFile(project.id), JSON.stringify(project, null, 2));
  }

  async function projectNames() {
    const entries = await fs.list(PROJECTS);
    return entries.filter((e) => e.kind === 'file' && e.name.endsWith('.json'));
  }

  // Files whose names aren't well-formed UUIDs (or that don't parse) are
  // skipped rather than failing the listing: they aren't projects we wrote.
  async function listProjects() {
    const files = await projectNames();
    const projects = await Promise.all(
      files.map(async (f) => {
        const id = f.name.replace(/\.json$/, '');
        if (!isValidId(id)) return null;
        try {
          return await readProject(id);
        } catch {
          return null;
        }
      })
    );
    return projects
      .filter(Boolean)
      .map(projectSummary)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async function getProject(id) {
    return readProject(id);
  }

  async function createProject(name = 'Untitled Project') {
    const project = newProject(uuid(), name, new Date(now()).toISOString());
    await writeProject(project);
    return project;
  }

  // `savedToRepo` is bookkeeping the export writes: a caller round-tripping
  // a project it read earlier must not put a stale copy back.
  async function updateProject(id, updates) {
    const existing = await readProject(id);
    const { savedToRepo: _ignored, repo: _computed, ...rest } = updates || {};
    const merged = { ...existing, ...rest, id, updated_at: nextUpdatedAt(existing.updated_at, now()) };
    await writeProject(merged);
    return merged;
  }

  async function deleteProject(id) {
    await fs.remove(projectFile(id));
  }

  async function addNode(id, node) {
    const project = await readProject(id);
    const at = now();
    const newNode = {
      id: uuid(),
      status: 'sketch',
      createdAt: at,
      updatedAt: at,
      ...node,
      ...placeNode(project.nodes || [], node),
    };
    project.nodes = [...(project.nodes || []), newNode];
    project.updated_at = nextUpdatedAt(project.updated_at, at);
    await writeProject(project);
    return newNode;
  }

  async function updateNode(id, nodeId, updates) {
    const project = await readProject(id);
    let updatedNode = null;
    project.nodes = (project.nodes || []).map((n) => {
      if (n.id !== nodeId) return n;
      updatedNode = { ...n, ...updates };
      return updatedNode;
    });
    if (!updatedNode) throw notFound(`Node ${nodeId} not found in project ${id}`, 'NODE_NOT_FOUND');
    project.updated_at = nextUpdatedAt(project.updated_at, now());
    await writeProject(project);
    return updatedNode;
  }

  async function listFeedback({ projectId, includeResolved = false } = {}) {
    const projects = projectId ? [await readProject(projectId)] : await listProjects();
    return feedbackOf(projects, { includeResolved });
  }

  /** The sketch "Try an example" puts on an empty canvas: the one `klose init` seeds. */
  async function seedDemoProject() {
    const project = await createProject(DEMO_PROJECT_NAME);
    const node = await addNode(project.id, { ...DEMO_NODE });
    return { project, node };
  }

  /**
   * A string that changes whenever any project file is added, removed or
   * written. The canvas polls it to notice the agent's writes, since a web
   * page can't watch a folder.
   */
  async function stamp() {
    const files = (await fs.list(PROJECTS, { stat: true })).filter((e) => e.kind === 'file' && e.name.endsWith('.json'));
    return files
      .map((f) => `${f.name}:${f.lastModified ?? ''}:${f.size ?? ''}`)
      .sort()
      .join('|');
  }

  /**
   * Leaves a note that the hosted canvas has this repo open, so `klose status`
   * and the /klose skill know not to start a server for it. Only once the repo
   * has a .klose/ (someone sketched there, or ran `klose init`): opening a
   * folder to look must not write into it. Resolves to whether it wrote.
   */
  async function writeCanvasMarker({ url }) {
    if (!(await fs.list([KLOSE_DIR])).length) return false;
    await ensureGitignore();
    await fs.write([KLOSE_DIR, 'canvas.json'], JSON.stringify({ canvas: 'hosted', url, seenAt: new Date(now()).toISOString() }, null, 2) + '\n');
    return true;
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    addNode,
    updateNode,
    listFeedback,
    seedDemoProject,
    stamp,
    writeCanvasMarker,
  };
}

/**
 * A folder kept in memory, for tests and for trying the store without a
 * browser. `files` maps "a/b/c" to text.
 * @returns {FolderFs & { files: Map<string, { text: string, lastModified: number }> }}
 */
export function memoryFolder(initial = {}, { now = () => Date.now() } = {}) {
  const files = new Map(Object.entries(initial).map(([k, text]) => [k, { text, lastModified: now() }]));
  const key = (path) => path.join('/');
  return {
    files,
    async list(path) {
      const prefix = path.length ? `${key(path)}/` : '';
      const seen = new Map();
      for (const [k, v] of files) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const name = rest.split('/')[0];
        if (rest.includes('/')) seen.set(name, { name, kind: 'directory' });
        else seen.set(name, { name, kind: 'file', lastModified: v.lastModified, size: v.text.length });
      }
      return [...seen.values()];
    },
    async read(path, { maxBytes } = {}) {
      const file = files.get(key(path));
      if (!file || (maxBytes !== undefined && file.text.length > maxBytes)) return null;
      return file.text;
    },
    async write(path, text) {
      files.set(key(path), { text, lastModified: now() });
    },
    async remove(path) {
      if (!files.delete(key(path))) {
        const err = new Error(`No such file: ${key(path)}`);
        err.name = 'NotFoundError';
        throw err;
      }
    },
  };
}
