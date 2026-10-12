/**
 * What the services call in the hosted canvas instead of the server's API:
 * the same operations, answered from the open repo folder. Jev, the
 * component index, lint and "save to repo" need the server or the CLI, and
 * say so.
 */
import type { ComponentNode, Project, RepoSave } from '../types';
import { getSession } from './folderSession';
import { IGNORED_DIRS, MAX_CSS_BYTES, MAX_CSS_FILES, collectThemeCss, isThemeSource } from '../server/themeParse.js';

const NOT_OPEN = 'No repo folder is open. Open one from the Klose home page.';

function session() {
  const s = getSession();
  if (!s) throw new Error(NOT_OPEN);
  return s;
}

// Exports happen through the CLI here, so a project is never "saved to the repo" from this canvas.
const CANVAS_ONLY: RepoSave = { state: 'canvas', dir: null, savedAt: null, files: 0 };

function present(record: Record<string, unknown>): Project {
  const { savedToRepo: _saved, ...project } = record;
  return { ...(project as unknown as Project), repo: CANVAS_ONLY };
}

export const listProjects = async (): Promise<Project[]> => (await session().store.listProjects()).map(present);

export const getProject = async (id: string): Promise<Project> => present(await session().store.getProject(id));

export const createProject = async (name?: string): Promise<Project> => present(await session().store.createProject(name));

export const createExampleProject = async (): Promise<Project> => {
  const { store } = session();
  const { project } = await store.seedDemoProject();
  return present(await store.getProject(project.id));
};

export const saveProject = async (id: string, updates: Record<string, unknown>): Promise<Project> =>
  present(await session().store.updateProject(id, updates));

export const deleteProject = async (id: string): Promise<void> => {
  await session().store.deleteProject(id);
};

export const addNode = (projectId: string, node: Partial<ComponentNode>): Promise<ComponentNode> =>
  session().store.addNode(projectId, node) as Promise<ComponentNode>;

export const getRepoName = async (): Promise<string> => session().name;

/** The answer for everything that needs a process next to the repo. */
export const needsServer = (what: string): Promise<never> =>
  Promise.reject(
    new Error(`${what} needs the Klose server or CLI: the hosted canvas only reads and writes the repo folder. Run "npx klose serve --open" for it.`)
  );

/** What /api/health says on a server, for the pages that ask. */
export const serverInfo = () => ({
  hub: false,
  root: getSession()?.name ?? null,
  version: null,
  jev: { available: false },
});

// ---------------------------------------------------------------------- theme

let themePromise: Promise<string> | null = null;
let themeFor: string | null = null;

/**
 * The repo's design tokens as the preview stylesheet, read from the folder:
 * the CSS half of server/theme.js. A Tailwind v3 `tailwind.config.js` is
 * code, which a page can't run, so those tokens are left to the server.
 */
export function loadThemeCss(): Promise<string> {
  const s = getSession();
  if (!s) return Promise.resolve('');
  if (!themePromise || themeFor !== s.name) {
    themeFor = s.name;
    themePromise = collectTheme().catch(() => '');
  }
  return themePromise;
}

async function collectTheme(): Promise<string> {
  const { fs } = session();
  const files: { rel: string; source: string }[] = [];

  async function walk(path: string[], depth: number): Promise<void> {
    if (files.length >= MAX_CSS_FILES) return;
    const entries = (await fs.list(path)).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_CSS_FILES) return;
      if (entry.kind === 'directory') {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk([...path, entry.name], depth + 1);
      } else if (isThemeSource(entry.name, depth)) {
        const source = await fs.read([...path, entry.name], { maxBytes: MAX_CSS_BYTES });
        if (source !== null) files.push({ rel: [...path, entry.name].join('/'), source });
      }
    }
  }

  await walk([], 0);
  return collectThemeCss(files).css;
}
