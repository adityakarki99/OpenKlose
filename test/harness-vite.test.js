import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureViteHarness, findRepoVite, harnessModuleSource, nodeSatisfies, stopViteHarnesses, usesVite, ViteHarnessError } from '../server/harnessVite.js';
import { loadEffectiveHarnessConfig, syncRegistry, initHarness } from '../server/harness.js';
import { validateHarnessConfig } from '../server/harnessCore.js';
import { createKloseServer } from '../server/http.js';
import * as store from '../server/store.js';

// Vite auto-mode: Klose starts the repo's own Vite and serves a harness page
// that imports a real component (which imports a sibling file, exactly what
// the sandbox can't do). Needs the fixture's vite (resolved from the root
// node_modules) and a Node new enough for it; Playwright for the page check.

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development.
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'vite-app');
const vite = findRepoVite(FIXTURE);
const nodeOk = !!vite && nodeSatisfies(vite.engines);
const skipVite = nodeOk ? false : `vite unavailable or needs a newer Node than ${process.versions.node}`;
const executable = playwright?.chromium?.executablePath?.();
const skipBrowser = skipVite || (!!executable && existsSync(executable) ? false : 'Chromium unavailable');

async function listing(dir) {
  const out = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    out.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  return out.sort();
}

after(() => stopViteHarnesses());

test('nodeSatisfies reads Vite-style engine ranges', () => {
  assert.equal(nodeSatisfies('^18.0.0 || ^20.0.0 || >=22.0.0', '18.20.1'), true);
  assert.equal(nodeSatisfies('^18.0.0 || ^20.0.0 || >=22.0.0', '19.0.0'), false);
  assert.equal(nodeSatisfies('^20.19.0 || >=22.12.0', '20.18.0'), false);
  assert.equal(nodeSatisfies('^20.19.0 || >=22.12.0', '22.13.0'), true);
  assert.equal(nodeSatisfies(undefined, '12.0.0'), true);
});

test('vite configs: devServer is optional, and a vite repo is detected without any config', async () => {
  assert.deepEqual(validateHarnessConfig({ framework: 'vite' }).config.framework, 'vite');
  assert.ok(validateHarnessConfig({ framework: 'expo' }).error, 'expo still needs a devServer');
  assert.equal(usesVite(FIXTURE), true);
  assert.equal(usesVite(path.join(here, 'fixtures', 'expo-app')), false);
  const found = await loadEffectiveHarnessConfig(FIXTURE);
  assert.equal(found.auto, true);
  assert.equal(found.config.framework, 'vite');
  assert.equal(await loadEffectiveHarnessConfig(await mkdtemp(path.join(os.tmpdir(), 'klose-novite-'))), null);
});

test('the harness page source imports by path, wraps providers and loads the bridge', () => {
  const src = harnessModuleSource('src/Providers.jsx');
  assert.match(src, /import\(\/\* @vite-ignore \*\/ '\/' \+ file\)/);
  assert.match(src, /import\(\/\* @vite-ignore \*\/ "\/src\/Providers\.jsx"\)/);
  assert.match(src, /klose-bridge\.js/);
  assert.match(src, /file\.split\('\/'\)\.includes\('\.\.'\)/);
  assert.doesNotMatch(harnessModuleSource(), /Providers\.jsx/);
});

test('a repo without vite installed gets a clear error, not a crash', async () => {
  const bare = await mkdtemp(path.join(os.tmpdir(), 'klose-novite-'));
  try {
    // Outside the repo tree, so no node_modules above it holds a vite.
    await assert.rejects(ensureViteHarness(bare), (err) => err instanceof ViteHarnessError && /not installed/.test(err.message));
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});

test('init and sync write nothing for a vite repo', async () => {
  const before = await listing(FIXTURE);
  const result = await initHarness(FIXTURE);
  assert.equal(result.auto, true);
  assert.deepEqual(result.files, []);
  assert.equal((await syncRegistry(FIXTURE, [])).result, 'auto');
  assert.deepEqual(await listing(FIXTURE), before);
});

test('the harness page renders a real component that imports a sibling file, and writes no files', { skip: skipBrowser }, async () => {
  const before = await listing(FIXTURE);
  const origin = await ensureViteHarness(FIXTURE, { providers: 'src/Providers.jsx' });
  assert.match(origin, /^http:\/\/localhost:\d+$/);
  assert.equal(await ensureViteHarness(FIXTURE, { providers: 'src/Providers.jsx' }), origin, 'one server is reused across cards');
  const moved = await ensureViteHarness(FIXTURE, { providers: 'src/Providers.jsx', harnessPath: '/__other' });
  assert.notEqual(moved, origin, 'changed options start a fresh server');
  assert.equal((await fetch(`${moved}/__other`)).status, 200);
  const back = await ensureViteHarness(FIXTURE, { providers: 'src/Providers.jsx' });
  assert.equal((await fetch(`${back}/__klose`)).status, 200);

  const browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    const props = Buffer.from(JSON.stringify({ name: 'Klose' })).toString('base64');
    await page.goto(`${back}/__klose?c=${encodeURIComponent('src/Greeting.jsx')}#Greeting&props=${encodeURIComponent(props)}`);
    await page.locator('#greeting').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#greeting').innerText(), 'Hello, Klose! (config-applied)');
    assert.equal(await page.locator('main[data-providers="yes"] #greeting').count(), 1, 'rendered inside the providers');

    // Same file, other export: only the fragment changes, and the page starts over.
    await page.goto(`${back}/__klose?c=${encodeURIComponent('src/Greeting.jsx')}#Missing`);
    await page.getByText('has no export "Missing"').waitFor({ timeout: 30000 });
    await page.goto(`${back}/__klose?c=${encodeURIComponent('../secret.js')}#x`);
    await page.getByText('open this page from the Klose canvas').waitFor({ timeout: 30000 });
  } finally {
    await browser.close();
  }
  assert.deepEqual(await listing(FIXTURE), before, 'nothing was written to the repo');
});

test('/api/harness starts vite lazily, only once a built card exists', { skip: skipVite }, async () => {
  await stopViteHarnesses();
  const repo = FIXTURE;
  const server = createKloseServer({ cwd: repo, publicDir: os.tmpdir() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const get = async () => (await fetch(`${api}/harness`)).json();
  const before = await listing(repo);
  try {
    const idle = await get();
    assert.equal(idle.config.framework, 'vite');
    assert.deepEqual(idle.registry, []);
    assert.equal(idle.config.devServer, 'http://localhost:5173', 'no server was started yet');

    const project = await store.createProject(repo, 'Vite harness');
    await store.addNode(repo, project.id, { name: 'Greeting', status: 'built', builtFilePath: 'src/Greeting.jsx', exportName: 'Greeting', code: 'export default () => null' });
    const live = await get();
    assert.deepEqual(live.registry, ['src/Greeting.jsx#Greeting']);
    assert.match(live.config.devServer, /^http:\/\/localhost:(?!5173$)\d+$/);
    const page = await fetch(`${live.config.devServer}${live.config.harnessPath}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Klose harness/);
    await store.deleteProject?.(repo, project.id);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await stopViteHarnesses();
  const added = (await listing(repo)).filter((f) => !before.includes(f) && !f.includes(`${path.sep}.klose`));
  assert.deepEqual(added, [], 'only .klose/ (the canvas store) was added');
  await rm(path.join(repo, '.klose'), { recursive: true, force: true });
});
