// The component harness, filesystem half: reading klose.config.json, and
// writing the generated files (`klose harness init` / `sync`). The schema and
// the address the canvas frames live in server/harnessCore.js.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GENERATED_HEADER,
  HARNESS_CONFIG_FILE,
  DEFAULT_EXPO_DEV_SERVER,
  DEFAULT_HARNESS_PATH,
  DEFAULT_SKETCH_DIR,
  DEFAULT_VITE_DEV_SERVER,
  REGISTRY_FILE,
  registryKey,
  sketchFile,
  validateHarnessConfig,
} from './harnessCore.js';
import { mapRelativeImports } from './sketchImports.js';
import { harnessSetting, sketchSetting } from './settings.js';
import { acceptSketches, isTrusted, readTrust } from './sketchTrust.js';

export const HARNESS_COMPONENT_FILE = 'klose.harness.tsx';

export class HarnessError extends Error {}

/** The repo's harness config, or null when there is none. Throws HarnessError when it is invalid. */
export async function loadHarnessConfig(root) {
  let text;
  try {
    text = await readFile(path.join(root, HARNESS_CONFIG_FILE), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new HarnessError(`${HARNESS_CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  const { config, error } = validateHarnessConfig(raw);
  if (error) throw new HarnessError(`${HARNESS_CONFIG_FILE}: ${error}`);
  return config;
}

// ── Generated files ─────────────────────────────────────────────────────────

const hashOf = (body) => createHash('sha1').update(body).digest('hex').slice(0, 12);

/** A generated file: header, a hash of the body (so a user edit is noticed), then the body. */
function generated(body) {
  return `${GENERATED_HEADER}\n// klose-hash: ${hashOf(body)}\n${body}`;
}

/** True when `text` is a generated file nobody has edited since. */
function isUntouched(text) {
  const m = /^(.*)\n\/\/ klose-hash: ([0-9a-f]+)\n([\s\S]*)$/.exec(text);
  return !!m && m[1] === GENERATED_HEADER && m[2] === hashOf(m[3]);
}

/**
 * Write a generated file unless the user has changed it. Returns
 * 'created' | 'updated' | 'unchanged' | 'skipped' (user-edited, no force).
 */
async function writeGenerated(root, rel, body, { force = false } = {}) {
  const file = path.join(root, rel);
  const next = generated(body);
  let current = null;
  try {
    current = await readFile(file, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (current === next) return 'unchanged';
  if (current !== null && !force && !isUntouched(current)) return 'skipped';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
  return current === null ? 'created' : 'updated';
}

/** `writeGenerated` for an HTML page: the hash rides in a comment on the last line. */
async function writeHtml(root, rel, body, { force = false } = {}) {
  const file = path.join(root, rel);
  const next = `${body}<!-- klose-hash: ${hashOf(body)} -->\n`;
  let current = null;
  try {
    current = await readFile(file, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (current === next) return 'unchanged';
  const m = current === null ? null : /^([\s\S]*)<!-- klose-hash: ([0-9a-f]+) -->\n$/.exec(current);
  if (current !== null && !force && !(m && m[2] === hashOf(m[1]))) return 'skipped';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
  return current === null ? 'created' : 'updated';
}

const posix = (p) => p.split(path.sep).join('/');

/** `./a/b` from `fromDir` (repo-relative) to `file` (repo-relative), without the extension. */
function relativeModule(fromDir, file, { keepExt = true } = {}) {
  let rel = posix(path.relative(fromDir || '.', file));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return keepExt ? rel : rel.replace(/\.(tsx?|jsx?)$/, '');
}

// ── Registry ────────────────────────────────────────────────────────────────

function safeRepoFile(file) {
  return typeof file === 'string' && !!file && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..') && !/[\r\n"]/.test(file);
}

function safeExport(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

/** Registry keys (`<file>#<export>`) for built nodes in `projects`, plus the pinned `components`. */
export function collectRegistryKeys(projects, config) {
  const keys = new Set();
  for (const project of projects) {
    for (const node of project.nodes || []) {
      if (node.status !== 'built' || !node.builtFilePath) continue;
      const key = registryKey(node.builtFilePath, node.exportName);
      const [file, exp] = key.split('#');
      if (safeRepoFile(file) && safeExport(exp)) keys.add(key);
    }
  }
  for (const key of config?.components || []) {
    const [file, exp] = key.split('#');
    if (safeRepoFile(file) && safeExport(exp)) keys.add(registryKey(file, exp));
  }
  return [...keys].sort();
}

// Metro can't import a path chosen at runtime, so the Expo registry is static
// `require`s. Vite wants ES modules: a dynamic `import()` per component, which
// also keeps one broken file from taking the whole harness page down.
//
// `sketchKeys` are sketches written into the repo (see "Sketches" below). A
// sketch is found the way the sandbox finds it: the named export, else the
// default export, else the first component the file exports.
function registrySource(keys, framework = 'expo', sketchKeys = []) {
  const vite = framework === 'vite';
  const sketches = new Set(sketchKeys);
  const lines = [...new Set([...keys, ...sketchKeys])].sort().map((key) => {
    const [file, exp] = key.split('#');
    const from = JSON.stringify(`./${file}`);
    if (sketches.has(key)) {
      if (vite) return `  ${JSON.stringify(key)}: () => import(${from}).then((m) => pickSketch(m, ${JSON.stringify(exp)})),`;
      return `  ${JSON.stringify(key)}: () => pickSketch(require(${from}), ${JSON.stringify(exp)}),`;
    }
    if (vite) return `  ${JSON.stringify(key)}: () => import(${from}).then((m) => m[${JSON.stringify(exp)}]),`;
    const pick = exp === 'default' ? '.default' : `[${JSON.stringify(exp)}]`;
    return `  ${JSON.stringify(key)}: () => require(${from})${pick},`;
  });
  // The generated Vite files import by full file name, which a strict tsconfig refuses.
  const head = vite ? '// @ts-nocheck\n' : '';
  const pickSketch = sketches.size
    ? `// A sketch from the canvas: the export it names, else its default export, else the first component it exports.
const isComponent = (value: unknown): boolean => typeof value === 'function' || (!!value && typeof value === 'object' && '$$typeof' in (value as object));
function pickSketch(mod: Record<string, unknown>, name: string): unknown {
  if (isComponent(mod[name])) return mod[name];
  if (isComponent(mod.default)) return mod.default;
  return Object.values(mod).find(isComponent);
}

`
    : '';
  return `${head}// Components the canvas can render through the harness, by "<file>#<export>".\n${pickSketch}export const registry: Record<string, () => unknown> = {\n${lines.join('\n')}${lines.length ? '\n' : ''}};\n`;
}

/** Registry keys currently in klose.registry.ts (what the canvas may frame). */
export async function readRegistryKeys(root) {
  try {
    const text = await readFile(path.join(root, REGISTRY_FILE), 'utf-8');
    return [...text.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): \(\) => (?:pickSketch\()?(?:require|import)\(/gm)].map((m) => JSON.parse(m[1]));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// ── Sketches ────────────────────────────────────────────────────────────────
//
// A sketch's `code` is drawn in the sandbox, which can't import anything from
// the repo. With a harness in use, the sketch is also written into the repo as
// a file ("materialised") and registered, so the repo's own bundler draws it,
// real imports and all. Only code written on this machine is written out
// (server/sketchTrust.js); the rest stays in the sandbox until it is accepted.
//
// The files are generated, like the registry, and they are not git-ignored:
// Tailwind v4 skips ignored paths when it looks for class names, so an ignored
// sketch would lose every class that only it uses. Commit them or not, as you
// do the registry. A generated sketch file that is already in the repo and
// matches its card's code counts as accepted: it came with the repo's source.

const SKETCH_FILE = /^[A-Za-z0-9][\w-]{0,63}\.tsx$/;

/** The body of a sketch's file: its code, with repo-root imports pointed at the root from where the file lives. */
export function sketchSource(node, config) {
  const dir = config.sketchDir || DEFAULT_SKETCH_DIR;
  const up = '../'.repeat(dir.split('/').length);
  let code = mapRelativeImports(node.code, (spec) => `${up}${spec.slice(2)}`);
  // The sandbox hands every sketch `React` as a global; a file has to import it.
  if (!/\bimport\s+(?:\*\s+as\s+)?React\b/.test(code)) code = `import React from 'react';\n${code}`;
  const name = String(node.name || 'Untitled sketch').replace(/[\r\n]+/g, ' ').slice(0, 120);
  return `/* eslint-disable */
// @ts-nocheck
// The sketch "${name}" from the Klose canvas (${node.id}), written here so your
// bundler can draw it with real imports. Change it on the canvas or with
// "klose project update-node"; this file is rewritten from there.
${code.replace(/\s+$/, '')}
`;
}

async function readOrNull(file) {
  try {
    return await readFile(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Bring the sketch files in step with `projects`: write the file of every
 * trusted sketch, and remove generated files whose sketch is gone, was built,
 * lost its code, or changed to code that isn't trusted. A file a person edited
 * is never rewritten or removed. With the `sketches` setting on `sandbox` (or
 * the harness off) no sketch gets a file, so every generated one is removed.
 *
 * Returns `{ keys, files, pending }`: the registry keys of sketches that have a
 * usable file, what happened to each file, and the ids of sketches waiting to
 * be accepted.
 */
export async function syncSketches(root, projects, config) {
  const dir = config.sketchDir || DEFAULT_SKETCH_DIR;
  const on = (await sketchSetting(root)).value === 'real' && (await harnessSetting(root)).value !== 'off';
  const trust = on ? await readTrust(root) : null;
  const keys = [];
  const files = [];
  const pending = [];
  const keep = new Set();
  for (const project of on ? projects : []) {
    for (const node of project.nodes || []) {
      const file = sketchFile(config, node);
      if (!file || keep.has(file) || !safeExport(node.exportName || 'default')) continue;
      const body = sketchSource(node, config);
      if (isTrusted(trust, node)) {
        files.push({ file, result: await writeGenerated(root, file, body) });
      } else if ((await readOrNull(path.join(root, file))) !== generated(body)) {
        pending.push(node.id);
        continue;
      }
      keep.add(file);
      keys.push(registryKey(file, node.exportName));
    }
  }
  let names = [];
  try {
    names = await readdir(path.join(root, dir));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let left = names.length;
  for (const name of names) {
    const file = `${dir}/${name}`;
    if (!SKETCH_FILE.test(name) || keep.has(file)) continue;
    const text = await readOrNull(path.join(root, file));
    if (text === null || !isUntouched(text)) continue;
    await unlink(path.join(root, file));
    files.push({ file, result: 'removed' });
    left--;
  }
  if (names.length && left === 0) await rmdir(path.join(root, dir)).catch(() => {});
  return { keys: keys.sort(), files, pending };
}

/** The ids of sketches whose code hasn't been written on, or accepted on, this machine. */
export async function pendingSketches(root, projects, config) {
  if ((await sketchSetting(root)).value !== 'real') return [];
  const trust = await readTrust(root);
  const pending = [];
  for (const project of projects) {
    for (const node of project.nodes || []) {
      const file = sketchFile(config, node);
      if (!file || isTrusted(trust, node)) continue;
      if ((await readOrNull(path.join(root, file))) !== generated(sketchSource(node, config))) pending.push(node.id);
    }
  }
  return pending;
}

/**
 * A person accepts sketches that came from somewhere else: `nodes` may now be
 * written into the repo and run in the app. Syncs, and returns the ids accepted.
 */
export async function acceptPendingSketches(root, nodes, projects) {
  const config = await loadHarnessConfig(root);
  if (!config) throw new HarnessError(`No ${HARNESS_CONFIG_FILE} here. Run "klose harness init" first.`);
  const accepted = await acceptSketches(root, nodes.filter((n) => sketchFile(config, n)));
  await syncRegistry(root, projects);
  return accepted;
}

/**
 * Regenerate klose.registry.ts from the built nodes of `projects` and the
 * sketches written into the repo (which this also brings up to date). Writes
 * only when the content changes, and never over a file the user edited
 * (without force).
 */
export async function syncRegistry(root, projects, { force = false } = {}) {
  const config = await loadHarnessConfig(root);
  if (!config) throw new HarnessError(`No ${HARNESS_CONFIG_FILE} here. Run "klose harness init" first.`);
  const built = collectRegistryKeys(projects, config);
  const sketches = await syncSketches(root, projects, config);
  const result = await writeGenerated(root, REGISTRY_FILE, registrySource(built, config.framework, sketches.keys), { force });
  return { result, keys: [...new Set([...built, ...sketches.keys])].sort(), sketches };
}

// ── Debounced sync after a store write ──────────────────────────────────────

const DEBOUNCE_MS = 40;
const pending = new Map(); // root -> Promise

/**
 * Called by the store after it saves nodes: a built card or a sketch may have
 * appeared, changed or gone. Does nothing in a repo without a harness config. Writes coalesce:
 * calls within a short window share one sync, and the registry is only
 * rewritten when its content changes. Resolves when the sync is done, so a CLI
 * process can await it before exiting; never rejects (the node was saved).
 */
export function scheduleRegistrySync(root, listProjects) {
  if (!existsSync(path.join(root, HARNESS_CONFIG_FILE))) return Promise.resolve();
  if (pending.has(root)) return pending.get(root);
  const run = new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS))
    .then(async () => {
      pending.delete(root);
      await syncRegistry(root, await listProjects());
    })
    .catch(() => {
      pending.delete(root);
    });
  pending.set(root, run);
  return run;
}

// ── init ────────────────────────────────────────────────────────────────────

async function readPackageJson(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function readText(root, rel) {
  try {
    return await readFile(path.join(root, rel), 'utf-8');
  } catch {
    return null;
  }
}

/** The module an index.html loads (`<script type="module" src>`), repo-relative, or null. */
function htmlEntry(html) {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src && !/^([a-z]+:)?\/\//i.test(src)) return src.replace(/^\.?\//, '');
  }
  return null;
}

/**
 * What kind of project this is, or null when the harness can't serve it:
 * `{ framework: 'expo', router }` or `{ framework: 'vite', entry }`. Vite means
 * a React single-page app (an index.html at the repo root that loads a module):
 * frameworks that only build with Vite route requests themselves, so a page
 * Klose drops next to index.html would never be served.
 */
export async function detectFramework(root) {
  const pkg = await readPackageJson(root);
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.expo) return { framework: 'expo', router: !!deps['expo-router'] };
  if (deps.vite && deps.react && deps['react-dom']) {
    const html = await readText(root, 'index.html');
    const entry = html && htmlEntry(html);
    if (entry) return { framework: 'vite', router: false, entry };
  }
  return null;
}

/** The directory expo-router reads routes from. */
function routesDir(root) {
  return existsSync(path.join(root, 'src', 'app')) && !existsSync(path.join(root, 'app')) ? 'src/app' : 'app';
}

function harnessComponentSource(config, bridgeNote) {
  const providers = config.providers
    ? `const Providers: React.ComponentType<{ children: React.ReactNode }> = (() => {\n  const mod = require(${JSON.stringify(relativeModule('.', config.providers, { keepExt: false }))});\n  return mod.default ?? mod.Providers ?? mod;\n})();\n`
    : `const Providers = ({ children }: { children: React.ReactNode }) => <>{children}</>;\n`;
  return `import React, { useEffect, useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import { registry } from './klose.registry';

${providers}
// Address: <devServer>${config.harnessPath}?c=<file>#<export>&props=<base64 json>
// Web builds only: the canvas frames this page, so the address is the window's.
function readAddress() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const file = new URLSearchParams(window.location.search).get('c');
  const fragment = window.location.hash.replace(/^#/, '');
  const amp = fragment.indexOf('&');
  const exportName = decodeURIComponent(amp < 0 ? fragment : fragment.slice(0, amp)) || 'default';
  let props: Record<string, unknown> = {};
  if (amp >= 0) {
    const encoded = new URLSearchParams(fragment.slice(amp + 1)).get('props');
    if (encoded) {
      try {
        const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
        props = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        props = {};
      }
    }
  }
  return file ? { key: \`\${file}#\${exportName}\`, props } : null;
}

// ${bridgeNote}
function loadBridge() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const parent = (window.location as { ancestorOrigins?: ArrayLike<string> }).ancestorOrigins?.[0];
  if (!parent || !/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\]|[^/]*\\.localhost)(:\\d+)?$/.test(parent)) return;
  if (document.querySelector('script[data-klose-bridge]')) return;
  const script = document.createElement('script');
  script.src = \`\${parent}/klose-bridge.js\`;
  script.dataset.kloseBridge = '';
  document.body.appendChild(script);
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: '#b91c1c' }}>{children}</Text>
    </View>
  );
}

export default function KloseHarness() {
  const address = useMemo(readAddress, []);
  useEffect(loadBridge, []);
  if (!address) return <Message>Klose harness: open this page from the Klose canvas, with ?c=&lt;file&gt;#&lt;export&gt;.</Message>;
  const load = (registry as Record<string, (() => unknown) | undefined>)[address.key];
  if (!load) return <Message>{\`Klose harness: "\${address.key}" is not in klose.registry.ts. Run "klose harness sync".\`}</Message>;
  const Component = load() as React.ComponentType<Record<string, unknown>> | undefined;
  if (!Component) return <Message>{\`Klose harness: "\${address.key}" has no such export.\`}</Message>;
  return (
    <Providers>
      <Component {...address.props} />
    </Providers>
  );
}
`;
}

function routeSource(dir) {
  const rel = relativeModule(dir, 'klose.harness', { keepExt: false });
  return `export { default } from ${JSON.stringify(rel)};\n`;
}

// ── Where sketches go ───────────────────────────────────────────────────────

const TAILWIND_CONFIGS = ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts'];
// Folders a router turns into pages: a sketch file there would become a route.
const ROUTE_DIRS = ['app', 'src/app', 'pages', 'src/pages'];

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if (ch === '{') out += '(?:';
    else if (ch === '}') out += ')';
    else if (ch === ',') out += '|';
    else out += /[\w/-]/.test(ch) ? ch : `\\${ch}`;
  }
  return new RegExp(`^${out}$`);
}

/**
 * The folder sketches are written to in this repo. The default sits at the
 * repo root, next to the registry. Tailwind v4 finds class names anywhere that
 * isn't git-ignored, so that works there. Tailwind v3 only reads the files its
 * `content` globs name: when those don't reach the default folder, the sketches
 * go inside the first folder they do reach (and that isn't a routes folder),
 * e.g. `src/klose.sketches`, so a class only a sketch uses is still generated.
 */
export async function chooseSketchDir(root) {
  let text = null;
  for (const name of TAILWIND_CONFIGS) if ((text = await readText(root, name)) !== null) break;
  const content = text && /\bcontent\s*:\s*(?:\{[\s\S]*?\bfiles\s*:\s*)?\[([\s\S]*?)\]/.exec(text)?.[1];
  if (!content) return DEFAULT_SKETCH_DIR;
  const globs = [...content.matchAll(/["'`]([^"'`\n]+)["'`]/g)].map((m) => m[1].replace(/^\.\//, '')).filter((g) => !g.startsWith('!') && !g.startsWith('..'));
  const reaches = (dir) => globs.some((g) => globToRegExp(g).test(`${dir}/sketch.tsx`));
  if (!globs.length || reaches(DEFAULT_SKETCH_DIR)) return DEFAULT_SKETCH_DIR;
  for (const glob of globs) {
    const prefix = glob.split('/**')[0];
    if (!glob.includes('/**') || !/^[\w@.-]+(\/[\w@.-]+)*$/.test(prefix) || ROUTE_DIRS.includes(prefix)) continue;
    if (!existsSync(path.join(root, prefix)) || !reaches(`${prefix}/${DEFAULT_SKETCH_DIR}`)) continue;
    return `${prefix}/${DEFAULT_SKETCH_DIR}`;
  }
  return DEFAULT_SKETCH_DIR;
}

// ── Vite ────────────────────────────────────────────────────────────────────

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vite.config.cjs'];

/** The dev server a Vite repo starts: its configured `port`, else Vite's default. */
async function viteDevServer(root) {
  for (const name of VITE_CONFIGS) {
    const port = /\bport:\s*(\d{2,5})\b/.exec((await readText(root, name)) || '')?.[1];
    if (port) return `http://localhost:${port}`;
  }
  return DEFAULT_VITE_DEV_SERVER;
}

/**
 * The stylesheets the app's entry module imports for their side effect
 * (`import './index.css'`), as specifiers the harness at the repo root can
 * import. Without them a real component renders unstyled.
 */
async function entryStyles(root, entry) {
  const source = (await readText(root, entry)) || '';
  const styles = [];
  for (const [, spec] of source.matchAll(/^\s*import\s+["']([^"'\r\n]+\.(?:css|scss|sass|less|styl|pcss))["']/gm)) {
    const resolved = spec.startsWith('.') ? `./${path.posix.join(path.posix.dirname(entry), spec)}` : spec;
    if (!resolved.startsWith('./..') && !styles.includes(resolved)) styles.push(resolved);
  }
  return styles;
}

/** `/__klose` → `__klose.html`: Vite's dev server answers `/x` with `x.html` when that file exists. */
const vitePageFile = (config) => `${config.harnessPath.slice(1)}.html`;

function vitePageSource(config) {
  const up = '../'.repeat(config.harnessPath.split('/').length - 2);
  return `<!doctype html>
<!-- ${GENERATED_HEADER.replace(/^\/\/ /, '')}. Served by the dev server only; it is not part of the build. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Klose harness</title>
  </head>
  <body>
    <div id="klose-harness"></div>
    <script type="module" src="${up ? up : './'}${HARNESS_COMPONENT_FILE}"></script>
  </body>
</html>
`;
}

function viteHarnessSource(config, styles, bridgeNote) {
  const providers = config.providers
    ? `import * as providersModule from ${JSON.stringify(relativeModule('.', config.providers))};\nconst Providers = providersModule.default ?? providersModule.Providers;\n`
    : `const Providers = ({ children }) => <>{children}</>;\n`;
  const styleImports = styles.length ? `// The stylesheets your app's entry imports, so components look as they do in the app.\n${styles.map((s) => `import ${JSON.stringify(s)};`).join('\n')}\n` : '';
  return `// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registry } from './klose.registry';
${styleImports}
${providers}
// Address: <devServer>${config.harnessPath}?c=<file>#<export>&props=<base64 json>
function readAddress() {
  const file = new URLSearchParams(window.location.search).get('c');
  const fragment = window.location.hash.replace(/^#/, '');
  const amp = fragment.indexOf('&');
  const exportName = decodeURIComponent(amp < 0 ? fragment : fragment.slice(0, amp)) || 'default';
  let props = {};
  if (amp >= 0) {
    const encoded = new URLSearchParams(fragment.slice(amp + 1)).get('props');
    if (encoded) {
      try {
        const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
        props = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        props = {};
      }
    }
  }
  return file ? { key: \`\${file}#\${exportName}\`, props } : null;
}

// ${bridgeNote}
function loadBridge() {
  const parent = window.location.ancestorOrigins?.[0];
  if (!parent || !/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\]|[^/]*\\.localhost)(:\\d+)?$/.test(parent)) return;
  if (document.querySelector('script[data-klose-bridge]')) return;
  const script = document.createElement('script');
  script.src = \`\${parent}/klose-bridge.js\`;
  script.dataset.kloseBridge = '';
  document.body.appendChild(script);
}

function Message({ children }) {
  return <p style={{ padding: 16, margin: 0, color: '#b91c1c', font: '14px system-ui, sans-serif' }}>{children}</p>;
}

// A component that throws (often: a prop it needs is missing) says so instead of leaving a blank card.
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Message>{\`Klose harness: the component threw: \${this.state.error?.message || this.state.error}\`}</Message>;
    return this.props.children;
  }
}

function KloseHarness() {
  const address = useMemo(readAddress, []);
  const [loaded, setLoaded] = useState(null);
  const load = address ? registry[address.key] : undefined;
  useEffect(loadBridge, []);
  useEffect(() => {
    if (!load) return;
    let live = true;
    Promise.resolve()
      .then(load)
      .then(
        (Component) => live && setLoaded({ Component }),
        (error) => live && setLoaded({ error })
      );
    return () => {
      live = false;
    };
  }, [load]);
  // The hash carries the export and the props, and changing only it doesn't reload the page.
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);
  if (!address) return <Message>Klose harness: open this page from the Klose canvas, with ?c=&lt;file&gt;#&lt;export&gt;.</Message>;
  if (!load) return <Message>{\`Klose harness: "\${address.key}" is not in klose.registry.ts. Run "klose harness sync".\`}</Message>;
  if (!loaded) return null;
  if (loaded.error) return <Message>{\`Klose harness: "\${address.key}" could not be loaded: \${loaded.error?.message || loaded.error}\`}</Message>;
  const { Component } = loaded;
  if (!Component) return <Message>{\`Klose harness: "\${address.key}" has no such export.\`}</Message>;
  return (
    <Boundary>
      <Providers>
        <Component {...address.props} />
      </Providers>
    </Boundary>
  );
}

createRoot(document.getElementById('klose-harness')).render(<KloseHarness />);
`;
}

/**
 * Set a repo up for the harness. Idempotent: existing config is kept, and a
 * generated file the user has edited is left alone unless `force`.
 * Returns `{ framework, router, config, files: [{ file, result }], manual?: string }`.
 */
export async function initHarness(root, { force = false, devServer, harnessPath, providers, projects = [] } = {}) {
  const detected = await detectFramework(root);
  if (!detected) {
    throw new HarnessError(
      'klose harness init supports Expo projects (an "expo" dependency in package.json) and Vite + React apps ' +
        '("vite", "react" and "react-dom" in package.json, and an index.html at the repo root that loads a module script).'
    );
  }
  const { framework } = detected;

  const files = [];
  let config = await loadHarnessConfig(root);
  if (!config) {
    const sketchDir = await chooseSketchDir(root);
    const candidate = {
      framework,
      devServer: devServer || (framework === 'vite' ? await viteDevServer(root) : DEFAULT_EXPO_DEV_SERVER),
      harnessPath: harnessPath || DEFAULT_HARNESS_PATH,
      ...(providers ? { providers } : {}),
      ...(sketchDir !== DEFAULT_SKETCH_DIR ? { sketchDir } : {}),
    };
    const { config: valid, error } = validateHarnessConfig(candidate);
    if (error) throw new HarnessError(error);
    config = valid;
    await writeFile(path.join(root, HARNESS_CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
    files.push({ file: HARNESS_CONFIG_FILE, result: 'created' });
  } else if (config.framework !== framework) {
    throw new HarnessError(`${HARNESS_CONFIG_FILE} says framework "${config.framework}", but this is ${framework === 'expo' ? 'an Expo' : 'a Vite'} project.`);
  } else {
    files.push({ file: HARNESS_CONFIG_FILE, result: 'unchanged' });
  }

  const bridgeNote = 'The bridge lets the canvas pick elements to comment on. Only loaded when this page is framed by Klose on localhost.';
  const component = framework === 'vite' ? viteHarnessSource(config, await entryStyles(root, detected.entry), bridgeNote) : harnessComponentSource(config, bridgeNote);
  files.push({ file: HARNESS_COMPONENT_FILE, result: await writeGenerated(root, HARNESS_COMPONENT_FILE, component, { force }) });
  const sketches = await syncSketches(root, projects, config);
  files.push({ file: REGISTRY_FILE, result: await writeGenerated(root, REGISTRY_FILE, registrySource(collectRegistryKeys(projects, config), framework, sketches.keys), { force }) });

  let manual;
  if (framework === 'vite') {
    files.push({ file: vitePageFile(config), result: await writeHtml(root, vitePageFile(config), vitePageSource(config), { force }) });
  } else if (detected.router) {
    // The route lives where the configured harnessPath says (/__klose → app/__klose.tsx,
    // /preview/components → app/preview/components.tsx), so the canvas address reaches it.
    const route = `${routesDir(root)}${config.harnessPath}.tsx`;
    files.push({ file: route, result: await writeGenerated(root, route, routeSource(path.posix.dirname(route)), { force }) });
  } else {
    manual =
      `This project doesn't use expo-router, so add the harness screen by hand: register ` +
      `${HARNESS_COMPONENT_FILE} (default export KloseHarness) as a web route at "${config.harnessPath}" ` +
      `in your navigator, then open ${config.devServer}${config.harnessPath}?c=<file>#<export> to check it.`;
  }

  return { framework, router: detected.router, config, files, manual };
}

// ── Automatic setup ─────────────────────────────────────────────────────────

const notices = [];

/** What automatic setup wrote in this process since the last call, for a CLI to report. */
export function takeAutoSetupNotices() {
  return notices.splice(0);
}

/**
 * Set the harness up without being asked, when the repo's `harness` setting
 * allows it (`auto`, the default; see server/settings.js), there is no
 * klose.config.json yet, and the project is one `initHarness` can finish by
 * itself: an Expo project without expo-router needs a hand-written route, so
 * it is left to `klose harness init`. Returns what `initHarness` did, or null.
 * Never throws: it runs after a save that already succeeded.
 */
export async function autoSetupHarness(root, listProjects) {
  try {
    if (existsSync(path.join(root, HARNESS_CONFIG_FILE))) return null;
    if ((await harnessSetting(root)).value !== 'auto') return null;
    const detected = await detectFramework(root);
    if (!detected || (detected.framework === 'expo' && !detected.router)) return null;
    const result = await initHarness(root, { projects: await listProjects() });
    notices.push(result);
    return result;
  } catch {
    return null;
  }
}

/** Projects as `getProject` returns them, for every project in the repo's store. */
export async function readAllProjects(store, root) {
  const summaries = await store.listProjects(root);
  return Promise.all(summaries.map((s) => store.getProject(root, s.id)));
}

/**
 * What turning the setting on (or `klose init`) does: set the harness up if
 * `autoSetupHarness` would, else bring an existing registry up to date.
 * Returns the setup result, or null when there was nothing to set up.
 */
export async function ensureHarness(root, store) {
  const listAll = () => readAllProjects(store, root);
  const setup = await autoSetupHarness(root, listAll);
  if (!setup && existsSync(path.join(root, HARNESS_CONFIG_FILE))) {
    try {
      await syncRegistry(root, await listAll());
    } catch {
      // An invalid config or an unreadable project: `klose harness sync` says which.
    }
  }
  return setup;
}
