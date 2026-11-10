// Route discovery and the app map: which pages a repo's app has, read off its
// files (never run), and the cards `klose map` puts on the canvas for them.
//
// Three routers are understood: expo-router and Next.js from their route
// folders, React Router best-effort from `path` literals in source. Every
// route is reported in one pattern syntax whatever the router: `/users/[id]`
// for a param, `/docs/[...rest]` for a catch-all.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isAllowedLiveUrl } from './storeCore.js';

export const DEFAULT_MAP_PROJECT = 'App map';

/** Where each router's dev server usually listens. */
export const DEFAULT_DEV_SERVERS = {
  'expo-router': 'http://localhost:8081',
  next: 'http://localhost:3000',
  'react-router': 'http://localhost:5173',
};

const SOURCE_EXT = /\.(tsx|ts|jsx|js|mdx|md)$/;
// Folders a source scan stays out of. Inside a route folder only node_modules is
// skipped: `build` or `public` there is a route like any other.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'public', 'android', 'ios', '__tests__', '__mocks__']);
const SKIP_IN_ROUTES = new Set(['node_modules', '__tests__', '__mocks__']);

async function readPackageJson(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/** The routers this repo uses, from package.json: any of 'expo-router', 'next', 'react-router'. */
export async function detectRouters(root) {
  const pkg = await readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const found = [];
  if (deps['expo-router']) found.push('expo-router');
  if (deps.next) found.push('next');
  if (deps['react-router'] || deps['react-router-dom']) found.push('react-router');
  return found;
}

/** Every source file under `dir` (repo-relative, posix), skipping dot folders and build output. */
async function walk(root, dir, skip = SKIP_IN_ROUTES) {
  const out = [];
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      out.push(...(await walk(root, rel, skip)));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const isGroup = (seg) => /^\([^.)][^)]*\)$/.test(seg);

/** `[id]` → `{ name: 'id' }`, `[...rest]` and `[[...rest]]` → catch-all; null for a plain segment. */
function paramOf(seg) {
  const m = /^\[(\[)?(\.\.\.)?([^\][]+)\]\]?$/.exec(seg);
  return m ? { name: m[3], catchAll: !!m[2], optional: !!m[1] } : null;
}

function toRoute(segments, file, framework, kind) {
  const kept = segments.filter((s) => !isGroup(s));
  return {
    path: `/${kept.join('/')}`,
    file,
    params: kept.map(paramOf).filter(Boolean).map((p) => p.name),
    framework,
    kind,
  };
}

/** `app` unless only `src/app` exists (what expo-router and Next both do). */
function pickDir(root, name) {
  if (existsSync(path.join(root, name))) return name;
  if (existsSync(path.join(root, 'src', name))) return `src/${name}`;
  return null;
}

async function expoRoutes(root) {
  const dir = pickDir(root, 'app');
  if (!dir) return [];
  const routes = [];
  for (const file of await walk(root, dir)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(file)) continue;
    const segments = file.slice(dir.length + 1).replace(/\.(tsx|ts|jsx|js)$/, '').split('/');
    // home.web.tsx and home.tsx are one route.
    const base = segments.pop().replace(/\.(web|native|ios|android)$/, '');
    if (base.endsWith('+api')) {
      routes.push(toRoute([...segments, base.slice(0, -4)].filter((s) => s && s !== 'index'), file, 'expo-router', 'api'));
    } else if (base === '_layout') {
      routes.push(toRoute(segments, file, 'expo-router', 'layout'));
    } else if (!base.startsWith('+') && !base.startsWith('_')) {
      routes.push(toRoute(base === 'index' ? segments : [...segments, base], file, 'expo-router', 'page'));
    }
  }
  return routes;
}

async function nextRoutes(root) {
  const routes = [];
  const appDir = pickDir(root, 'app');
  if (appDir) {
    for (const file of await walk(root, appDir)) {
      const segments = file.slice(appDir.length + 1).split('/');
      const base = segments.pop().replace(SOURCE_EXT, '');
      // Private folders, parallel slots and intercepting routes aren't addresses of their own.
      if (segments.some((s) => s.startsWith('_') || s.startsWith('@') || /^\(\.+\)/.test(s))) continue;
      if (base === 'page') routes.push(toRoute(segments, file, 'next', 'page'));
      else if (base === 'layout') routes.push(toRoute(segments, file, 'next', 'layout'));
      else if (base === 'route') routes.push(toRoute(segments, file, 'next', 'api'));
    }
  }
  const pagesDir = pickDir(root, 'pages');
  if (pagesDir) {
    for (const file of await walk(root, pagesDir)) {
      const segments = file.slice(pagesDir.length + 1).replace(SOURCE_EXT, '').split('/');
      const base = segments.pop();
      if (segments[0] === 'api') {
        routes.push(toRoute(base === 'index' ? segments : [...segments, base], file, 'next', 'api'));
      } else if (!base.startsWith('_') && !(segments.length === 0 && /^(404|500)$/.test(base))) {
        routes.push(toRoute(base === 'index' ? segments : [...segments, base], file, 'next', 'page'));
      }
    }
  }
  return routes;
}

// ── React Router: best effort, from `path` literals ─────────────────────────

/**
 * `text` with comments and the contents of strings blanked out (same length,
 * so offsets still line up), for counting brackets without being fooled.
 */
function blankStringsAndComments(text) {
  const out = text.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, text.length));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

const ROUTE_LITERAL = /^[\w\-./:*?@~()[\]]*$/;

function joinPath(parent, child) {
  if (child.startsWith('/')) return child;
  const base = parent === '/' ? '' : parent;
  return child ? `${base}/${child}` : parent;
}

/** `/users/:id/*` → `/users/[id]/[...splat]`. */
function normalisePattern(p) {
  const segments = p
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (seg === '*') return '[...splat]';
      const m = /^:([\w-]+)\??$/.exec(seg);
      return m ? `[${m[1]}]` : seg;
    });
  return `/${segments.join('/')}`;
}

/** Paths of route objects (`{ path: 'x', children: [...] }`), nested ones joined to their parent. */
function objectRoutePaths(text, blanked) {
  const found = [];
  const open = []; // per brace depth: the path of the route object open at that depth
  let depth = 0;
  const key = /[{}]|\b(path|index)\s*:\s*/g;
  let m;
  while ((m = key.exec(blanked))) {
    if (m[0] === '{') {
      depth++;
    } else if (m[0] === '}') {
      open.length = Math.min(open.length, depth);
      depth = Math.max(0, depth - 1);
    } else {
      const parent = open.slice(0, depth).reverse().find((p) => p !== undefined) ?? '/';
      const rest = text.slice(key.lastIndex);
      if (m[1] === 'index') {
        if (/^true\b/.test(rest)) found.push(parent);
        continue;
      }
      const lit = /^(["'`])([^"'`\n]*)\1/.exec(rest);
      if (!lit || !ROUTE_LITERAL.test(lit[2])) continue;
      const full = joinPath(parent, lit[2]);
      open[depth] = full;
      found.push(full);
    }
  }
  return found;
}

/** Paths of `<Route path="x">` elements, nested ones joined to their parent. */
function jsxRoutePaths(text, blanked) {
  const found = [];
  const open = []; // paths of the <Route> elements we're inside (null for a pathless one)
  const tag = /<Route\b|<\/Route\s*>/g;
  let m;
  while ((m = tag.exec(blanked))) {
    if (m[0].startsWith('</')) {
      open.pop();
      continue;
    }
    // The tag ends at the first `>` outside braces: `element={<Home />}` has its own.
    let i = tag.lastIndex;
    let braces = 0;
    for (; i < blanked.length; i++) {
      if (blanked[i] === '{') braces++;
      else if (blanked[i] === '}') braces--;
      else if (blanked[i] === '>' && braces <= 0) break;
    }
    const attrs = text.slice(tag.lastIndex, i);
    const selfClosing = blanked[i - 1] === '/';
    tag.lastIndex = i + 1;
    const parent = [...open].reverse().find((p) => p !== null) ?? '/';
    const lit = /(?:^|\s)path\s*=\s*\{?\s*(["'`])([^"'`\n]*)\1/.exec(attrs);
    let full = null;
    if (lit && ROUTE_LITERAL.test(lit[2])) {
      full = joinPath(parent, lit[2]);
      found.push(full);
    } else if (/(?:^|\s)index(?=[\s=/]|$)/.test(attrs.replace(/\{[\s\S]*\}/g, ''))) {
      found.push(parent);
    }
    if (!selfClosing) open.push(full);
  }
  return found;
}

async function reactRouterRoutes(root) {
  const routes = [];
  for (const file of await walk(root, '', SKIP_DIRS)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(file) || /\.(test|spec|stories|d)\.[jt]sx?$/.test(file)) continue;
    const text = await readFile(path.join(root, file), 'utf-8').catch(() => '');
    if (!/['"](react-router|react-router-dom)['"]/.test(text)) continue;
    const blanked = blankStringsAndComments(text);
    for (const raw of [...objectRoutePaths(text, blanked), ...jsxRoutePaths(text, blanked)]) {
      const pattern = normalisePattern(raw);
      // A bare `*` at the top is the not-found page, not an address.
      if (pattern === '/[...splat]') continue;
      routes.push(toRoute(pattern.split('/').filter(Boolean), file, 'react-router', 'page'));
    }
  }
  return routes;
}

/**
 * The app's routes: `[{ path, file, params, framework, kind }]`, sorted by
 * path. `kind` is 'page' (something to look at), 'layout' or 'api'. The Klose
 * harness route itself is left out.
 */
export async function discoverRoutes(root, { harnessPath = '/__klose', routers } = {}) {
  const using = routers || (await detectRouters(root));
  const all = [];
  if (using.includes('expo-router')) all.push(...(await expoRoutes(root)));
  if (using.includes('next')) all.push(...(await nextRoutes(root)));
  if (using.includes('react-router')) all.push(...(await reactRouterRoutes(root)));
  const seen = new Set();
  return all
    .filter((r) => r.path !== harnessPath)
    .filter((r) => {
      // One page per address (home.tsx and home.web.tsx, a parent route and its index child).
      const key = `${r.framework} ${r.kind} ${r.path}${r.kind === 'page' ? '' : ` ${r.file}`}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}

// ── The map ─────────────────────────────────────────────────────────────────

/**
 * The address of `route` with `params` filled in: `{ pathname }`, or
 * `{ missing: [names] }` when a param has no value. An optional catch-all
 * (`[[...slug]]`) with no value is simply left off.
 */
export function fillRoute(routePath, params = {}) {
  const missing = [];
  const out = [];
  for (const seg of routePath.split('/').filter(Boolean)) {
    const p = paramOf(seg);
    if (!p) {
      out.push(seg);
      continue;
    }
    const value = params[p.name];
    if (value === undefined || value === '') {
      if (!p.optional) missing.push(p.name);
      continue;
    }
    const parts = p.catchAll ? String(value).split('/').filter(Boolean) : [String(value)];
    out.push(...parts.map(encodeURIComponent));
  }
  return missing.length ? { missing } : { pathname: `/${out.join('/')}` };
}

const CARD = { width: 480, height: 360 };
const GAP = 80;
const START = { x: 200, y: 160 };
const PER_ROW = 5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The note a card carries while its route still needs params. */
export function needsParamsNote(routePath, missing) {
  const flags = missing.map((name) => `--param ${name}=<value>`).join(' ');
  return `No live frame yet: ${routePath} needs ${missing.length === 1 ? 'a value' : 'values'} for ${missing.map((n) => `[${n}]`).join(', ')}. Run "klose map ${flags}" to fill it in.`;
}

/**
 * What `klose map` should do to a project, without doing it.
 *
 * - `add`: cards for page routes the project has no card for yet, laid out
 *   below everything already there, one band per first path segment;
 * - `fill`: `{ id, updates }` for cards made earlier without an address whose
 *   params now have values (nothing else on an existing card is ever touched);
 * - `kept`: routes that already have a card;
 * - `missing`: routes on cards that the app no longer has, with the cards' ids;
 * - `needParams`: routes still waiting for `--param` values.
 */
export function planMap({ routes, nodes = [], devServer, params = {} }) {
  const base = String(devServer || '').replace(/\/+$/, '');
  if (!isAllowedLiveUrl(base)) {
    throw new Error(`dev server must be http(s) on localhost, 127.0.0.1, [::1] or *.localhost, with no credentials: ${JSON.stringify(devServer)}`);
  }
  const pages = routes.filter((r) => r.kind === 'page');
  // The card for a route itself is the one with no `state`; state cards sit beside it.
  const routeCards = new Map();
  for (const n of nodes) if (typeof n.route === 'string' && !n.state && !routeCards.has(n.route)) routeCards.set(n.route, n);

  const add = [];
  const fill = [];
  const kept = [];
  const needParams = [];
  const fresh = [];
  for (const route of pages) {
    const filled = fillRoute(route.path, params);
    const url = filled.pathname !== undefined ? `${base}${filled.pathname === '/' ? '/' : filled.pathname}` : null;
    if (!url) needParams.push({ route: route.path, params: filled.missing });
    const card = routeCards.get(route.path);
    if (!card) {
      fresh.push({ route, url, missing: filled.missing });
      continue;
    }
    kept.push(route.path);
    if (url && !card.url && !card.code) {
      const updates = { url };
      if (typeof card.notes === 'string' && card.notes.startsWith('No live frame yet: ')) updates.notes = '';
      fill.push({ id: card.id, route: route.path, updates });
    }
  }

  const placed = nodes.filter((n) => isNum(n.x) && isNum(n.y));
  let y = placed.length ? Math.max(...placed.map((n) => n.y + (isNum(n.height) ? n.height : CARD.height))) + GAP : START.y;
  const groups = new Map();
  for (const item of fresh) {
    const group = item.route.path.split('/')[1] || '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  for (const items of groups.values()) {
    items.forEach(({ route, url, missing }, i) => {
      add.push({
        name: route.path,
        description: `The ${route.path} route (${route.file}).`,
        route: route.path,
        ...(url ? { url } : { notes: needsParamsNote(route.path, missing) }),
        x: START.x + (i % PER_ROW) * (CARD.width + GAP),
        y: y + Math.floor(i / PER_ROW) * (CARD.height + GAP),
        ...CARD,
      });
    });
    y += Math.ceil(items.length / PER_ROW) * (CARD.height + GAP);
  }

  const live = new Set(pages.map((r) => r.path));
  const gone = new Map();
  for (const n of nodes) {
    if (typeof n.route !== 'string' || live.has(n.route)) continue;
    if (!gone.has(n.route)) gone.set(n.route, []);
    gone.get(n.route).push(n.id);
  }
  const missing = [...gone].map(([route, nodeIds]) => ({ route, nodeIds }));
  return { add, fill, kept, missing, needParams };
}

/** The dev server `klose map` frames when none is given: the harness config's, else the router's usual one. */
export async function defaultDevServer(root, routers) {
  try {
    const config = JSON.parse(await readFile(path.join(root, 'klose.config.json'), 'utf-8'));
    if (isAllowedLiveUrl(config?.devServer)) return config.devServer;
  } catch {
    // No harness config, or not readable: fall through to the router's default.
  }
  return DEFAULT_DEV_SERVERS[routers[0]] || null;
}

/** The harness route to leave off the map: klose.config.json's `harnessPath`, else the default. */
export async function harnessPathOf(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, 'klose.config.json'), 'utf-8'));
    if (typeof config?.harnessPath === 'string') return config.harnessPath;
  } catch {
    // none
  }
  return '/__klose';
}
