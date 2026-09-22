import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';

/**
 * Scans the host repository for real UI components so Klose can search them and
 * the coding agent can reuse what already exists instead of re-sketching it.
 *
 * This is a deliberately lightweight, dependency-free heuristic scanner (Klose
 * ships zero runtime deps) — it reads source text and pattern-matches exported
 * component declarations, their props, and a leading doc comment. It is not a
 * full TypeScript parser; it aims to be resilient and useful, not exhaustive.
 */

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.cache', '.vercel', '.turbo', '.parcel-cache', 'vendor',
  '.klose', 'web', '.idea', '.vscode', 'tmp', 'temp',
]);

const SOURCE_EXTS = new Set(['.tsx', '.jsx']);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 6000;
const CACHE_TTL_MS = 4000;

// export default function Name(   |   export function Name(
const RE_FUNC = /^\s*export\s+(default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*[<(]/;
// export const Name = ...   |   export const Name: React.FC = ...
const RE_CONST = /^\s*export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*[:=]/;
// export default class Name  |  export class Name
const RE_CLASS = /^\s*export\s+(default\s+)?class\s+([A-Z][A-Za-z0-9_]*)/;
// export default Name;   (default export of an identifier declared elsewhere)
const RE_DEFAULT_IDENT = /^\s*export\s+default\s+([A-Z][A-Za-z0-9_]*)\s*;?\s*$/;

function looksLikeComponentFile(source) {
  // Cheap JSX/React signal so we skip plain .ts utilities that happen to be .tsx.
  return /<[A-Za-z][\s\S]*?>/.test(source) || /from\s+['"]react['"]/.test(source) || /React\./.test(source);
}

// A component is "previewable" in Klose's isolated sandbox only if it doesn't
// import repo-local modules (relative imports won't resolve outside the app).
function hasRelativeImports(source) {
  return /(?:import|require)\s*\(?\s*['"]\.\.?\//.test(source) || /from\s+['"]\.\.?\//.test(source);
}

/** Best-effort git identity for the scanned repo — dependency-free, from .git/. */
async function repoInfo(root) {
  const folder = path.basename(root);
  let branch = null;
  let remote = null;
  try {
    const head = await readFile(path.join(root, '.git', 'HEAD'), 'utf-8');
    const m = head.match(/ref:\s*refs\/heads\/(.+)/);
    branch = m ? m[1].trim() : head.trim().slice(0, 12);
  } catch { /* not a git repo */ }
  try {
    const cfg = await readFile(path.join(root, '.git', 'config'), 'utf-8');
    const m = cfg.match(/url\s*=\s*(.+)/);
    if (m) remote = m[1].trim();
  } catch { /* no remote */ }
  let name = folder;
  if (remote) {
    const rm = remote.match(/[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
    if (rm) name = rm[1];
  }
  return { name, folder, root, branch, remote, isGit: branch !== null };
}

/** Collect a JSDoc block or run of // comments immediately above line index `i`. */
function commentAbove(lines, i) {
  let j = i - 1;
  // skip blank lines and decorators directly above
  while (j >= 0 && lines[j].trim() === '') j--;
  if (j < 0) return '';

  const collected = [];
  if (lines[j].trim().endsWith('*/')) {
    // walk up to the opening /**
    const block = [];
    while (j >= 0) {
      block.unshift(lines[j]);
      if (lines[j].trim().startsWith('/*')) break;
      j--;
    }
    for (const raw of block) {
      const t = raw.trim().replace(/^\/\*+/, '').replace(/\*+\/$/, '').replace(/^\*\s?/, '').trim();
      if (t) collected.push(t);
    }
  } else if (lines[j].trim().startsWith('//')) {
    while (j >= 0 && lines[j].trim().startsWith('//')) {
      collected.unshift(lines[j].trim().replace(/^\/\/\s?/, ''));
      j--;
    }
  }
  return collected.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Read direct property signatures without treating nested type punctuation as separators.
 * Still a heuristic: inherited/mapped props and imported type definitions are not resolved.
 */
function extractProps(source, name) {
  // Tokenize strings before comments so URLs and punctuation inside literals survive.
  const tokens = [];
  const lexer = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|=>|\r?\n|[^\S\r\n]+|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(lexer)) {
    const value = match[0];
    if (value.startsWith('//')) continue;
    if (value.startsWith('/*')) { tokens.push(' '); continue; }
    tokens.push(value);
  }
  // Mask literals only when locating declarations, preventing comment/string decoys.
  const searchable = tokens.map(t => /^["'`]/.test(t) ? ' '.repeat(t.length) : t).join('');
  const declaration = new RegExp(`\\b(?:interface\\s+${name}Props\\s*(?:extends[^{}]+)?|type\\s+${name}Props\\s*=\\s*)\\{`).exec(searchable);
  if (!declaration) return [];
  const start = declaration.index + declaration[0].length;
  let offset = 0;
  let index = 0;
  while (index < tokens.length && offset < start) offset += tokens[index++].length;
  const props = [];
  const stack = [];
  let member = '';
  const append = () => {
    const match = member.trim().match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/);
    if (match && props.length < 16) {
      props.push({ name: match[1], optional: !!match[2], type: match[3].trim().replace(/\s+/g, ' ').slice(0, 80) });
    }
    member = '';
  };
  const closers = { '{': '}', '(': ')', '[': ']', '<': '>' };
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (!stack.length) {
      if (token === '}') { append(); return props; }
      if (token === ';' || token === ',') { append(); continue; }
      // Newlines separate semicolon-free members, but may also continue a union/type.
      if (/\n/.test(token) && /^(?:\s*)(?:readonly\s+)?[A-Za-z_$][\w$]*\s*\??\s*:/.test(tokens.slice(index + 1, index + 20).join(''))) {
        append();
        continue;
      }
    }
    if (Object.hasOwn(closers, token)) stack.push(closers[token]);
    else if (token === stack.at(-1)) stack.pop();
    member += token;
  }
  // An unterminated declaration should not borrow props from unrelated source.
  return [];
}

function categoryFor(relPath) {
  const segs = relPath.split(path.sep).slice(0, -1);
  const anchor = segs.findIndex((s) => /^(components?|ui|design-system|widgets|elements)$/i.test(s));
  if (anchor !== -1 && segs[anchor + 1]) return segs[anchor + 1];
  if (anchor !== -1) return segs[anchor];
  return segs[segs.length - 1] || 'root';
}

function parseFile(relPath, source) {
  if (!looksLikeComponentFile(source)) return [];
  const lines = source.split('\n');
  const found = new Map(); // name -> component
  const importPath = relPath.replace(/\.(tsx|jsx)$/, '');
  const previewable = !hasRelativeImports(source);

  lines.forEach((line, i) => {
    let name = null;
    let isDefault = false;
    let m;
    if ((m = line.match(RE_FUNC))) { name = m[2]; isDefault = !!m[1]; }
    else if ((m = line.match(RE_CONST))) { name = m[1]; }
    else if ((m = line.match(RE_CLASS))) { name = m[2]; isDefault = !!m[1]; }
    else if ((m = line.match(RE_DEFAULT_IDENT))) { name = m[1]; isDefault = true; }
    if (!name) return;

    const existing = found.get(name);
    const description = commentAbove(lines, i);
    if (existing) {
      existing.isDefaultExport = existing.isDefaultExport || isDefault;
      if (!existing.description && description) existing.description = description;
      return;
    }
    found.set(name, {
      id: `${relPath}#${name}`,
      name,
      file: relPath,
      importPath,
      line: i + 1,
      isDefaultExport: isDefault,
      description,
      props: extractProps(source, name),
      category: categoryFor(relPath),
      previewable,
    });
  });

  return [...found.values()];
}

async function walk(dir, root, out) {
  if (out.count >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.count >= MAX_FILES) return;
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (IGNORED_DIRS.has(entry.name)) continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(full, root, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      if (/\.(test|spec|stories|d)\.[jt]sx?$/.test(entry.name)) continue;
      out.count++;
      try {
        const s = await stat(full);
        if (s.size > MAX_FILE_BYTES) continue;
        const source = await readFile(full, 'utf-8');
        const rel = path.relative(root, full);
        for (const comp of parseFile(rel, source)) {
          comp.loc = source.split('\n').length;
          out.components.push(comp);
        }
      } catch {
        // unreadable file — skip
      }
    }
  }
}

let cache = null; // { root, at, data }

/**
 * Scan `cwd` for components. Results are cached briefly so repeated UI/CLI calls
 * don't re-walk the tree; pass { force: true } to bypass the cache.
 */
export async function scanComponents(cwd = process.cwd(), { force = false } = {}) {
  if (!force && cache && cache.root === cwd && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const out = { count: 0, components: [] };
  const [, repo] = await Promise.all([walk(cwd, cwd, out), repoInfo(cwd)]);
  out.components.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  const data = {
    root: cwd,
    repo,
    scannedAt: new Date().toISOString(),
    filesScanned: out.count,
    truncated: out.count >= MAX_FILES,
    count: out.components.length,
    components: out.components,
  };
  cache = { root: cwd, at: Date.now(), data };
  return data;
}

/** Simple substring match across the fields a user/agent would search by. */
export function filterComponents(components, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return components;
  const terms = q.split(/\s+/);
  return components.filter((c) => {
    const hay = `${c.name} ${c.file} ${c.category} ${c.description} ${c.props.map((p) => p.name).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Read a single component file's source for the detail view. `relFile` is
 * validated to stay inside `cwd` and to be a scannable source file.
 */
export async function readComponentSource(cwd, relFile) {
  const resolved = path.resolve(cwd, relFile);
  const rootWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (resolved !== cwd && !resolved.startsWith(rootWithSep)) {
    throw badRequest('Path escapes project root', 'PATH_ESCAPES_ROOT');
  }
  const ext = path.extname(resolved);
  if (!SOURCE_EXTS.has(ext) && ext !== '.ts' && ext !== '.js') {
    throw badRequest('Not a source file', 'NOT_A_SOURCE_FILE');
  }
  const source = await readFile(resolved, 'utf-8');
  return { file: relFile, source };
}
