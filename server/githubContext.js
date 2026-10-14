/** Bounded, read-only GitHub import. Shared by the CLI and hosted canvas. */
import { collectThemeCss, IGNORED_DIRS } from './themeParse.js';
import { newProject } from './storeCore.js';

export function parseRepository(input) {
  const text = String(input || '')
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(text) || text.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error('Enter a GitHub repository as owner/name or its https://github.com URL.');
  }
  return text;
}

export function contextPaths(tree) {
  return tree
    .filter((f) => f.type === 'blob' && f.size <= 128 * 1024 && !f.path.split('/').some((p) => IGNORED_DIRS.has(p)))
    .filter(
      (f) => /(^|\/)(design\.md|README\.md|package\.json)$/i.test(f.path) || /(^|\/)(index|globals?|theme|tokens|app)\.css$/i.test(f.path),
    )
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, 12);
}

/** @param {string} input
 * @param {{branch?: string, fetch?: typeof globalThis.fetch, token?: string, cache?: {get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<any>}} [options]
 */
export async function githubContext(input, { branch, fetch: request = globalThis.fetch, token, cache } = {}) {
  const repo = parseRepository(input);
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const get = async (suffix) => {
    const res = await request(`https://api.github.com/repos/${repo}/${suffix}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok)
      throw new Error(
        res.status === 404
          ? 'Repository or branch not found. For private repos, run klose open with GH_TOKEN or GITHUB_TOKEN in your terminal.'
          : `GitHub request failed (${res.status}). Try again after checking your access or rate limit.`,
      );
    return res.json();
  };
  const info = await get('');
  const ref = branch || info.default_branch;
  const commit = await get(`commits/${encodeURIComponent(ref)}`);
  const cacheKey = `${info.full_name.toLowerCase()}@${commit.sha}`;
  const cached = await cache?.get(cacheKey);
  if (cached) return { ...cached, branch: ref };
  const tree = await get(`git/trees/${commit.sha}?recursive=1`);
  const files = [];
  for (const f of contextPaths(tree.tree || [])) {
    const blob = await get(`git/blobs/${f.sha}`);
    if (blob.encoding !== 'base64' || blob.size > 128 * 1024) continue;
    const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
    files.push({ rel: f.path, source: new TextDecoder().decode(bytes) });
  }
  const paths = (tree.tree || []).filter((f) => f.type === 'blob').map((f) => f.path);
  const context = {
    repo: info.full_name,
    branch: ref,
    commit: commit.sha,
    description: info.description || '',
    files,
    pages: paths.filter((p) => /(^|\/)(pages|app)\//.test(p) && /\.(tsx|jsx|vue|svelte)$/.test(p)).slice(0, 50),
    components: paths.filter((p) => /(^|\/)components\//.test(p) && /\.(tsx|jsx)$/.test(p)).slice(0, 80),
    truncated: !!tree.truncated,
    theme: collectThemeCss(files.filter((f) => f.rel.endsWith('.css'))),
  };
  await cache?.set(cacheKey, context);
  return context;
}

/** An honest first board: source inventory, not an imitation of the running app. */
export function projectFromContext(context, id = crypto.randomUUID()) {
  const p = newProject(id, context.repo.split('/').pop());
  p.description = `${context.repo} · ${context.branch}`;
  p.source = { provider: 'github', repository: context.repo, branch: context.branch, commit: context.commit };
  p.designSystemPrompt = context.files
    .filter((f) => /(^|\/)design\.md$/i.test(f.rel))
    .map((f) => f.source)
    .join('\n\n');
  p.projectContext.projectDescription = context.description || `Design workspace for ${context.repo}`;
  p.projectContext.techNotes = `Source: https://github.com/${context.repo}/tree/${encodeURIComponent(context.branch)}\nCommit: ${context.commit}\n${context.components.length} component files; ${context.pages.length} page files. Context import only; application code is not executed.`;
  const data = {
    provider: context.local ? 'LOCAL' : 'GITHUB',
    repo: context.repo,
    branch: context.branch,
    pages: context.pages.slice(0, 8),
    components: context.components.slice(0, 8),
    tokens: context.theme.tokenCount,
  };
  p.nodes.push({
    id: 'project-overview',
    name: 'Project overview',
    status: 'sketch',
    x: 100,
    y: 100,
    width: 640,
    height: 560,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    comments: [],
    description: 'Repository inventory. This is not a live application preview.',
    code: `const info = ${JSON.stringify(data)};\nexport default function Overview(){return <main style={{fontFamily:'system-ui',padding:32,background:'#f8fafc',color:'#172033',minHeight:'100vh'}}><p style={{fontSize:12}}>{info.provider} PROJECT · {info.branch}</p><h1 style={{fontSize:28,margin:'12px 0'}}>{info.repo}</h1><p>{info.tokens} design tokens loaded. Ready for your first sketch.</p><p style={{fontSize:12,margin:'12px 0'}}>Source inventory — not a live application preview.</p>{[['Pages',info.pages],['Components',info.components]].map(([label,files])=><section key={label} style={{marginTop:20}}><h2 style={{fontSize:18}}>{label}</h2>{files.length ? files.map(file=><p key={file} style={{fontSize:12,overflowWrap:'anywhere',marginTop:6}}>{file}</p>) : <p>No matching files found.</p>}</section>)}</main>}`,
  });
  return p;
}
