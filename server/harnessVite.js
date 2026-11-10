// The Vite auto-mode harness. For a Vite repo Klose starts a dev server of its
// own inside the repo, on demand, using the repo's own copy of `vite` and the
// repo's own vite config, plus one small plugin that serves the harness page.
// Nothing is written to the repo: the page is virtual, and Vite's dependency
// cache goes to the OS temp folder instead of node_modules/.vite.
//
// Same trust as `npm run dev`: this runs the user's own code and config.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_HARNESS_PATH } from './harnessCore.js';

export const VIRTUAL_ID = 'virtual:klose-harness';

export class ViteHarnessError extends Error {}

/** Version of `a.b.c` satisfies a `>=` / `^` / `||` engines range, enough for Vite's `engines.node`. */
export function nodeSatisfies(range, version = process.versions.node) {
  const [major, minor = 0] = version.split('.').map(Number);
  if (!range) return true;
  return range.split('||').some((part) => {
    const m = /^\s*(\^|>=)?\s*(\d+)(?:\.(\d+))?/.exec(part);
    if (!m) return true;
    const [, op, rMajor, rMinor = '0'] = m;
    if (op === '>=') return major > +rMajor || (major === +rMajor && minor >= +rMinor);
    return major === +rMajor && minor >= +rMinor;
  });
}

/** Find the repo's own vite: `{ dir, version, engines }`, or null when it isn't installed. */
export function findRepoVite(root) {
  try {
    const pkgPath = createRequire(path.join(root, 'package.json')).resolve('vite/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return { dir: path.dirname(pkgPath), version: pkg.version, engines: pkg.engines?.node };
  } catch {
    return null;
  }
}

/** Does the repo use Vite? (a `vite` dependency or a vite config) */
export function usesVite(root) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.expo) return false;
    if (deps.vite) return true;
  } catch {
    // no package.json
  }
  return ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].some((ext) => existsSync(path.join(root, `vite.config.${ext}`)));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = netServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const JS_STRING = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The harness page, as a module: reads `c` (file), the export and the props
 * from the address, imports the component, wraps it in the repo's providers and
 * mounts it with the repo's own React. Plain JS, no JSX, so it needs no plugin.
 */
export function harnessModuleSource(providers) {
  const providersImport = providers
    ? `import(/* @vite-ignore */ ${JS_STRING(`/${providers}`)}).then((m) => m.default ?? m.Providers ?? m)`
    : 'Promise.resolve(null)';
  return `import React from 'react';
import { createRoot } from 'react-dom/client';

const SAFE_PARENT = /^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\]|[^/]*\\.localhost)(:\\d+)?$/;
const mount = document.getElementById('root');

function show(text) {
  const p = document.createElement('p');
  p.style.cssText = 'padding:16px;color:#b91c1c;font:14px system-ui';
  p.textContent = text;
  mount.replaceChildren(p);
}

// The bridge lets the canvas pick elements to comment on. Only loaded when this
// page is framed by Klose on localhost.
function loadBridge() {
  const parent = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
  if (!SAFE_PARENT.test(parent) || document.querySelector('script[data-klose-bridge]')) return;
  const script = document.createElement('script');
  script.src = parent + '/klose-bridge.js';
  script.dataset.kloseBridge = '';
  document.body.appendChild(script);
}

function readAddress() {
  const file = new URLSearchParams(location.search).get('c');
  const fragment = location.hash.replace(/^#/, '');
  const amp = fragment.indexOf('&');
  const exportName = decodeURIComponent(amp < 0 ? fragment : fragment.slice(0, amp)) || 'default';
  let props = {};
  if (amp >= 0) {
    const encoded = new URLSearchParams(fragment.slice(amp + 1)).get('props');
    if (encoded) {
      try {
        props = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))));
      } catch {
        props = {};
      }
    }
  }
  return { file, exportName, props };
}

async function run() {
  const { file, exportName, props } = readAddress();
  if (!file || file.startsWith('/') || file.split('/').includes('..')) {
    return show('Klose harness: open this page from the Klose canvas, with ?c=<file>#<export>.');
  }
  let mod;
  try {
    mod = await import(/* @vite-ignore */ '/' + file);
  } catch (err) {
    return show('Klose harness: could not load ' + file + ': ' + (err && err.message ? err.message : err));
  }
  const Component = mod[exportName];
  if (!Component) return show('Klose harness: ' + file + ' has no export "' + exportName + '".');
  let Providers = null;
  try {
    Providers = await ${providersImport};
  } catch (err) {
    return show('Klose harness: could not load the providers module: ' + (err && err.message ? err.message : err));
  }
  const element = React.createElement(Component, props);
  createRoot(mount).render(Providers ? React.createElement(Providers, null, element) : element);
  loadBridge();
}

// A card whose export or props change keeps its file, so only the fragment moves: start over.
window.addEventListener('hashchange', () => location.reload());

run();
`;
}

const HARNESS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Klose harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">import '${VIRTUAL_ID}';</script>
  </body>
</html>
`;

/** The Vite plugin: the virtual module, and the page served at `harnessPath`. */
export function kloseHarnessPlugin({ harnessPath = DEFAULT_HARNESS_PATH, providers } = {}) {
  const resolved = `\0${VIRTUAL_ID}`;
  return {
    name: 'klose-harness',
    resolveId: (id) => (id === VIRTUAL_ID ? resolved : null),
    load: (id) => (id === resolved ? harnessModuleSource(providers) : null),
    configureServer(server) {
      // Added directly, so it runs before Vite's own HTML fallback.
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (req.method !== 'GET' || pathname !== harnessPath) return next();
        try {
          const html = await server.transformIndexHtml(req.url, HARNESS_HTML);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

// ── Lifecycle: one lazily started server per repo, stopped with Klose ───────

const running = new Map(); // root -> { key, promise: Promise<{ url, close }> }

async function start(root, { harnessPath, providers }) {
  const found = findRepoVite(root);
  if (!found) {
    throw new ViteHarnessError(
      'This repo uses Vite but "vite" is not installed in it. Run your package manager\'s install, then reload the canvas. Built cards show their snapshot or sketch until then.'
    );
  }
  if (!nodeSatisfies(found.engines)) {
    throw new ViteHarnessError(`vite ${found.version} needs Node ${found.engines}, and Klose is running on Node ${process.versions.node}.`);
  }
  const esm = path.join(found.dir, 'dist', 'node', 'index.js');
  let vite;
  try {
    vite = await import(pathToFileURL(existsSync(esm) ? esm : createRequire(path.join(root, 'package.json')).resolve('vite')).href);
  } catch (err) {
    throw new ViteHarnessError(`Could not load the repo's vite: ${err.message}`);
  }
  const port = await freePort();
  const cacheDir = path.join(tmpdir(), `klose-vite-${createHash('sha1').update(root).digest('hex').slice(0, 10)}`);
  let server;
  try {
    server = await vite.createServer({
      root,
      // Not the repo's node_modules/.vite: nothing of ours goes into the repo.
      cacheDir,
      clearScreen: false,
      logLevel: 'error',
      appType: 'custom',
      server: { host: 'localhost', port, strictPort: true, open: false },
      plugins: [kloseHarnessPlugin({ harnessPath, providers })],
    });
    await server.listen();
  } catch (err) {
    await server?.close().catch(() => {});
    throw new ViteHarnessError(`Could not start the repo's Vite dev server: ${err.message}`);
  }
  return { url: `http://localhost:${port}`, close: () => server.close() };
}

/**
 * The origin of Klose's Vite server for `root`, started on first use and
 * reused after. A failed start is not remembered, so fixing the repo and
 * reloading the canvas works.
 */
export function ensureViteHarness(root, options = {}) {
  // The plugin captures its options, so a changed providers module or harness path needs a new server.
  const key = JSON.stringify([options.harnessPath ?? DEFAULT_HARNESS_PATH, options.providers ?? null]);
  let entry = running.get(root);
  if (entry && entry.key !== key) {
    stopEntry(entry.promise);
    entry = undefined;
  }
  if (!entry) {
    const promise = start(root, options);
    entry = { key, promise };
    running.set(root, entry);
    promise.catch(() => running.get(root) === entry && running.delete(root));
  }
  return entry.promise.then((s) => s.url);
}

const stopping = new Set();

function stopEntry(promise) {
  const done = promise.then((s) => s.close()).catch(() => {});
  stopping.add(done);
  done.finally(() => stopping.delete(done));
}

/** Stop every server we started (the Klose server is closing). Resolves when they are all down, including stops already under way. */
export async function stopViteHarnesses() {
  const all = [...running.values()];
  running.clear();
  for (const { promise } of all) stopEntry(promise);
  await Promise.all([...stopping]);
}
