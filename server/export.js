import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getProject, listProjects, setSavedToRepo } from './store.js';

/**
 * Saves a project's sketches into the repo as real files: one `.tsx` per
 * sketch (the preview code, ready to be read and built from) plus a README
 * that carries everything the canvas knows — descriptions, notes, status,
 * pending comments — so the folder doubles as a planning doc that survives
 * without Klose running.
 *
 * `.klose/projects/` stays the source of truth; the folder is a snapshot the
 * user chose to commit. Each save records where it went and a digest of what
 * it wrote (`savedToRepo` on the project), which is how the canvas can tell
 * "saved" from "changed since" without comparing timestamps — moving a sketch
 * around the board changes nothing a save would write, so it isn't a change.
 */

const README = 'README.md';

/** First line of every exported sketch; the component scanner skips these. */
export const SKETCH_MARKER = 'Klose sketch — "';

export function slugify(text, fallback = 'untitled') {
  const slug = String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function nodeFileName(node, used) {
  const base = slugify(node.name, 'sketch');
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
  used.add(name);
  return `${name}.tsx`;
}

// The sketch is a picture of a component, not part of the host app: it may
// import packages the repo doesn't have, so keep it out of tsc and eslint.
function fileHeader(project, node) {
  const lines = [
    `${SKETCH_MARKER}${node.name}" (${node.status || 'sketch'})`,
    `Project: ${project.name} · project ${project.id} · node ${node.id}`,
  ];
  if (node.description) lines.push('', node.description);
  lines.push(
    '',
    'This is the canvas preview: a self-contained component (react, lucide-react',
    'and recharts only, Tailwind classes) that shows the intended look. It is a',
    `reference for the real build, not a drop-in file. Notes and feedback: ${README}.`
  );
  const comment = lines.map((l) => (l ? ` * ${l.replace(/\*\//g, '* /')}` : ' *')).join('\n');
  return `// @ts-nocheck\n/* eslint-disable */\n/*\n${comment}\n */\n\n`;
}

function section(title, body) {
  return body ? `### ${title}\n\n${body.trim()}\n\n` : '';
}

function contextBlock(project) {
  const ctx = project.projectContext || {};
  const rows = [
    ['Product', ctx.productInfo],
    ['Description', ctx.projectDescription],
    ['Audience', ctx.targetAudience],
    ['Brand', [ctx.brandName, ctx.brandVoice].filter(Boolean).join(' — ')],
    ['Design references', ctx.designReferences],
    ['Tech notes', ctx.techNotes],
  ].filter(([, v]) => v && String(v).trim());
  if (!rows.length) return '';
  return `## Project context\n\n${rows.map(([k, v]) => `- **${k}:** ${String(v).trim()}`).join('\n')}\n\n`;
}

function commentsBlock(node) {
  // Resolved comments are done; the README only carries what's still open.
  const comments = (node.comments || []).filter((c) => !c.resolvedAt);
  if (!comments.length) return '';
  const items = comments.map((c, i) => {
    const el = c.element;
    const label = el ? [el.tagName || el.tag, el.text].filter(Boolean).join(' ') : '';
    return `${i + 1}. ${c.text}${label ? ` _(on \`${label}\`)_` : ''}`;
  });
  return `**Pending feedback**\n\n${items.join('\n')}\n\n`;
}

export function renderReadme(project, files) {
  const nodes = project.nodes || [];
  const built = nodes.filter((n) => n.status === 'built').length;
  let md = `# ${project.name}\n\n`;
  if (project.description) md += `${project.description.trim()}\n\n`;
  md += `_Exported from Klose project \`${project.id}\` · ${nodes.length} sketch${nodes.length === 1 ? '' : 'es'}`;
  md += built ? `, ${built} built_\n\n` : `_\n\n`;
  md += contextBlock(project);
  if (project.designSystemPrompt && project.designSystemPrompt.trim()) {
    md += `## Design system notes\n\n${project.designSystemPrompt.trim()}\n\n`;
  }
  if (nodes.length) {
    md += '## Sketches\n\n';
    md += nodes.map((n, i) => `${i + 1}. [${n.name}](#${slugify(n.name, 'sketch')}) — ${n.status || 'sketch'}`).join('\n') + '\n\n';
  }
  nodes.forEach((n, i) => {
    md += `---\n\n## ${n.name}\n\n`;
    const meta = [`**Status:** ${n.status || 'sketch'}`, `**Preview:** [\`${files[i]}\`](./${files[i]})`];
    if (n.builtFilePath) meta.push(`**Built as:** \`${n.builtFilePath}\``);
    md += meta.join(' · ') + '\n\n';
    if (n.description) md += `${n.description.trim()}\n\n`;
    md += section('Notes', n.notes);
    md += commentsBlock(n);
  });
  return md;
}

/** Everything a save writes, in order: the README, then one file per sketch. */
function build(project) {
  const used = new Set();
  const nodes = project.nodes || [];
  const names = nodes.map((n) => nodeFileName(n, used));
  return [
    { name: README, content: renderReadme(project, names) },
    ...nodes.map((n, i) => ({ name: names[i], content: fileHeader(project, n) + (n.code || '').trimEnd() + '\n' })),
  ];
}

function digestOf(files) {
  const hash = createHash('sha256');
  for (const f of files) hash.update(f.name).update('\0').update(f.content).update('\0');
  return hash.digest('hex');
}

/** Repo-relative, forward-slashed path of `dir`, or null when it's outside the repo. */
function repoRelative(cwd, dir) {
  const rel = path.relative(cwd, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function savedDir(cwd, project) {
  const dir = project.savedToRepo && project.savedToRepo.dir;
  if (typeof dir !== 'string' || !dir) return null;
  const abs = path.resolve(cwd, dir);
  return repoRelative(cwd, abs) ? abs : null;
}

/**
 * Whether `project`'s folder in the repo matches the canvas:
 *   canvas  — never saved (or the folder has since been deleted)
 *   saved   — a save now would write exactly what is already there
 *   changed — the canvas moved on since the last save
 */
export function repoState(cwd, project) {
  const abs = savedDir(cwd, project);
  if (!abs || !existsSync(path.join(abs, README))) {
    return { state: 'canvas', dir: null, savedAt: null, files: 0 };
  }
  const saved = project.savedToRepo;
  return {
    state: saved.digest === digestOf(build(project)) ? 'saved' : 'changed',
    dir: repoRelative(cwd, abs),
    savedAt: saved.at || null,
    files: Array.isArray(saved.files) ? saved.files.length : 0,
  };
}

/**
 * Where a project saves when nobody says otherwise: the folder it was last
 * saved to, else `docs/klose/<name>` — suffixed if another project already
 * owns that folder, so two files with the same name can't overwrite each other.
 */
export async function defaultExportDir(cwd, project) {
  const previous = savedDir(cwd, project);
  if (previous) return previous;
  const taken = new Set(
    (await listProjects(cwd))
      .filter((p) => p.id !== project.id && p.savedToRepo && p.savedToRepo.dir)
      .map((p) => p.savedToRepo.dir)
  );
  const base = `docs/klose/${slugify(project.name)}`;
  let dir = base;
  for (let i = 2; taken.has(dir); i++) dir = `${base}-${i}`;
  return path.join(cwd, dir);
}

/**
 * Save project `id` under `outDir` (absolute; defaults to defaultExportDir).
 * Files an earlier save wrote to the same folder that no longer correspond to
 * a sketch are removed — only ones this project recorded writing, never
 * anything else that happens to live there.
 */
export async function exportProject(cwd, id, outDir) {
  const project = await getProject(cwd, id);
  const dir = outDir || (await defaultExportDir(cwd, project));
  const files = build(project);
  const names = files.map((f) => f.name);

  await mkdir(dir, { recursive: true });
  await Promise.all(files.map((f) => writeFile(path.join(dir, f.name), f.content, 'utf-8')));

  const rel = repoRelative(cwd, dir);
  const previous = project.savedToRepo;
  if (rel && previous && previous.dir === rel && Array.isArray(previous.files)) {
    const stale = previous.files.filter((f) => typeof f === 'string' && path.basename(f) === f && !names.includes(f));
    await Promise.all(stale.map((f) => unlink(path.join(dir, f)).catch(() => {})));
  }

  // A folder outside the repo is a plain export: nothing to keep in sync.
  let saved = project;
  if (rel) {
    saved = await setSavedToRepo(cwd, id, { dir: rel, digest: digestOf(files), at: new Date().toISOString(), files: names });
  }
  return { project: { id: project.id, name: project.name }, dir, files: names, repo: repoState(cwd, saved) };
}
