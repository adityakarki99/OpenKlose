import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { collectThemeCss, IGNORED_DIRS } from './themeParse.js';
import { githubContext, parseRepository, projectFromContext } from './githubContext.js';
import * as store from './store.js';
import { createShare } from './share.js';

const hash = (text) => createHash('sha256').update(text).digest('hex');
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return null;
  }
}
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}

/** One persistent board per GitHub repo + branch, independent of the invoking folder. */
export async function openOnline({ repo, branch, cwd, home, host, token, fetch, project: requestedProject }) {
  let context;
  let workspace = cwd;
  if (repo) {
    parseRepository(repo);
    const cacheDir = path.join(home, 'context-cache');
    context = await githubContext(repo, {
      branch,
      token,
      fetch,
      cache: {
        get: (key) => readJson(path.join(cacheDir, `${hash(key)}.json`)),
        set: (key, value) => writeJson(path.join(cacheDir, `${hash(key)}.json`), value),
      },
    });
    workspace = path.join(home, 'online', hash(`${context.repo.toLowerCase()}@${context.branch}`));
  }
  await mkdir(path.join(workspace, '.klose'), { recursive: true });
  // A lock avoids duplicate boards if two agents open the same repo at once.
  const lock = path.join(workspace, '.klose', 'open.lock');
  try {
    await mkdir(lock);
  } catch (e) {
    if (e.code === 'EEXIST')
      throw new Error(`This workspace is already opening. Retry when it finishes. After a crashed process, remove ${lock}.`);
    throw e;
  }
  try {
    const recordPath = path.join(workspace, '.klose', 'online.json');
    let record = await readJson(recordPath);
    let project;
    if (requestedProject && record?.projectId !== requestedProject) record = null;
    if (record) project = await store.getProject(workspace, record.projectId);
    else {
      const existing = await store.listProjects(workspace);
      if (requestedProject) project = await store.getProject(workspace, requestedProject);
      else if (!repo && existing.length === 1) project = await store.getProject(workspace, existing[0].id);
      else if (!repo && existing.length > 1) throw new Error('This repo has several boards. Use --project <id> to select one.');
      if (!project && !context) context = await localContext(workspace);
      if (!project) project = context ? projectFromContext(context) : await store.createProject(workspace, path.basename(workspace));
      if (context?.local) {
        project.source = { provider: 'local', name: path.basename(workspace) };
        project.description = path.basename(workspace);
        project.projectContext.techNotes = 'Local repository inventory. Application code is not executed.';
      }
      if (context) await store.putProject(workspace, project);
      record = { projectId: project.id };
      // Persist identity before network access: a failed upload resumes this board.
      await writeJson(recordPath, record);
    }
    if (context) await writeFile(path.join(workspace, '.klose', 'source-theme.css'), context.theme.css);
    const shared = await createShare(workspace, project.id, {
      host,
      fetch,
      ...(context ? { themeCss: context.theme.css, repoName: context.repo } : {}),
    });
    return { ...shared, workspace, source: project.source || null };
  } finally {
    const { rmdir } = await import('node:fs/promises');
    await rmdir(lock);
  }
}

async function localContext(cwd) {
  const paths = [];
  async function walk(dir, depth = 0) {
    if (depth > 8 || paths.length >= 5000) return;
    for (const entry of await readdir(path.join(cwd, dir), { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) await walk(rel, depth + 1);
      else if (entry.isFile()) paths.push(rel);
      if (paths.length >= 5000) break;
    }
  }
  await walk('');
  const files = [];
  for (const rel of paths
    .filter((p) => /(^|\/)(design\.md|README\.md|package\.json|(?:index|globals?|theme|tokens|app)\.css)$/i.test(p))
    .slice(0, 12)) {
    const { stat } = await import('node:fs/promises');
    if ((await stat(path.join(cwd, rel))).size <= 128 * 1024) files.push({ rel, source: await readFile(path.join(cwd, rel), 'utf8') });
  }
  return {
    local: true,
    repo: path.basename(cwd),
    branch: 'local',
    commit: '',
    description: '',
    files,
    components: paths.filter((p) => /(^|\/)components\//.test(p) && /\.(tsx|jsx)$/.test(p)).slice(0, 80),
    pages: paths.filter((p) => /(^|\/)(pages|app)\//.test(p) && /\.(tsx|jsx)$/.test(p)).slice(0, 50),
    theme: collectThemeCss(files.filter((f) => f.rel.endsWith('.css'))),
  };
}
