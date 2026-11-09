// The component harness, filesystem half: reading klose.config.json, and
// writing the generated files (`klose harness init` / `sync`). The schema and
// the address the canvas frames live in server/harnessCore.js.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GENERATED_HEADER,
  HARNESS_CONFIG_FILE,
  DEFAULT_EXPO_DEV_SERVER,
  DEFAULT_HARNESS_PATH,
  REGISTRY_FILE,
  registryKey,
  validateHarnessConfig,
} from './harnessCore.js';

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

function registrySource(keys) {
  const lines = keys.map((key) => {
    const [file, exp] = key.split('#');
    const pick = exp === 'default' ? '.default' : `[${JSON.stringify(exp)}]`;
    return `  ${JSON.stringify(key)}: () => require(${JSON.stringify(`./${file}`)})${pick},`;
  });
  return `// Components the canvas can render through the harness, by "<file>#<export>".\nexport const registry: Record<string, () => unknown> = {\n${lines.join('\n')}${lines.length ? '\n' : ''}};\n`;
}

/** Registry keys currently in klose.registry.ts (what the canvas may frame). */
export async function readRegistryKeys(root) {
  try {
    const text = await readFile(path.join(root, REGISTRY_FILE), 'utf-8');
    return [...text.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): \(\) => require/gm)].map((m) => JSON.parse(m[1]));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Regenerate klose.registry.ts from the built nodes of `projects`. Writes only
 * when the content changes, and never over a file the user edited (without force).
 */
export async function syncRegistry(root, projects, { force = false } = {}) {
  const config = await loadHarnessConfig(root);
  if (!config) throw new HarnessError(`No ${HARNESS_CONFIG_FILE} here. Run "klose harness init" first.`);
  const keys = collectRegistryKeys(projects, config);
  const result = await writeGenerated(root, REGISTRY_FILE, registrySource(keys), { force });
  return { result, keys };
}

// ── Debounced sync after a store write ──────────────────────────────────────

const DEBOUNCE_MS = 40;
const pending = new Map(); // root -> Promise

/**
 * Called by the store after it saves a node that is (or just stopped being)
 * built. Does nothing in a repo without a harness config. Writes coalesce:
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

/** What kind of project this is: `{ framework: 'expo', router: boolean }`, or null. */
export async function detectFramework(root) {
  const pkg = await readPackageJson(root);
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.expo) return { framework: 'expo', router: !!deps['expo-router'] };
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

/**
 * Set a repo up for the harness. Idempotent: existing config is kept, and a
 * generated file the user has edited is left alone unless `force`.
 * Returns `{ framework, router, config, files: [{ file, result }], manual?: string }`.
 */
export async function initHarness(root, { force = false, devServer, harnessPath, providers, projects = [] } = {}) {
  const detected = await detectFramework(root);
  if (!detected) {
    throw new HarnessError(
      'klose harness init supports Expo projects (an "expo" dependency in package.json). Vite projects use the auto-mode harness instead.'
    );
  }

  const files = [];
  let config = await loadHarnessConfig(root);
  if (!config) {
    const candidate = {
      framework: 'expo',
      devServer: devServer || DEFAULT_EXPO_DEV_SERVER,
      harnessPath: harnessPath || DEFAULT_HARNESS_PATH,
      ...(providers ? { providers } : {}),
    };
    const { config: valid, error } = validateHarnessConfig(candidate);
    if (error) throw new HarnessError(error);
    config = valid;
    await writeFile(path.join(root, HARNESS_CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
    files.push({ file: HARNESS_CONFIG_FILE, result: 'created' });
  } else if (config.framework !== 'expo') {
    throw new HarnessError(`${HARNESS_CONFIG_FILE} says framework "${config.framework}", but this is an Expo project.`);
  } else {
    files.push({ file: HARNESS_CONFIG_FILE, result: 'unchanged' });
  }

  const bridgeNote = 'The bridge lets the canvas pick elements to comment on. Only loaded when this page is framed by Klose on localhost.';
  files.push({ file: HARNESS_COMPONENT_FILE, result: await writeGenerated(root, HARNESS_COMPONENT_FILE, harnessComponentSource(config, bridgeNote), { force }) });
  files.push({ file: REGISTRY_FILE, result: await writeGenerated(root, REGISTRY_FILE, registrySource(collectRegistryKeys(projects, config)), { force }) });

  let manual;
  if (detected.router) {
    const dir = routesDir(root);
    const route = `${dir}/__klose.tsx`;
    files.push({ file: route, result: await writeGenerated(root, route, routeSource(dir), { force }) });
  } else {
    manual =
      `This project doesn't use expo-router, so add the harness screen by hand: register ` +
      `${HARNESS_COMPONENT_FILE} (default export KloseHarness) as a web route at "${config.harnessPath}" ` +
      `in your navigator, then open ${config.devServer}${config.harnessPath}?c=<file>#<export> to check it.`;
  }

  return { framework: 'expo', router: detected.router, config, files, manual };
}

/** Projects as `getProject` returns them, for every project in the repo's store. */
export async function readAllProjects(store, root) {
  const summaries = await store.listProjects(root);
  return Promise.all(summaries.map((s) => store.getProject(root, s.id)));
}
