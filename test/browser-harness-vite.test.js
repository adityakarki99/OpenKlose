import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import { initHarness } from '../server/harness.js';
import * as store from '../server/store.js';

// The Vite harness end to end: the files `klose harness init` generates, served
// by a real Vite dev server, framed by the built canvas. Unlike
// browser-harness.test.js nothing here is faked: the card shows the fixture's
// real component, inside its real providers, with its real stylesheet.
// Needs Playwright, a built web/dist, and this repo's own vite + react.

let playwright;
let vite;
let react;
try {
  playwright = await import('playwright');
  vite = await import('vite');
  react = (await import('@vitejs/plugin-react')).default;
} catch {
  // Optional in local development.
}

// What was written on "this machine" is recorded under ~/.klose (server/sketchTrust.js); keep the tests' own.
process.env.KLOSE_HOME = await mkdtemp(path.join(os.tmpdir(), 'klose-home-'));
process.on('exit', () => rmSync(process.env.KLOSE_HOME, { recursive: true, force: true }));
delete process.env.KLOSE_SKETCHES;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'web', 'dist');
const executable = playwright?.chromium?.executablePath?.();
const canRun = !!vite && !!react && !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'index.html'));
const skip = canRun ? false : 'Chromium, vite or built web assets unavailable';

let browser;
let server;
let origin;
let cwd;
let devServer;

before(async () => {
  if (!canRun) return;
  // Inside the repo, so the fixture's imports of react and vite resolve to this repo's node_modules.
  cwd = await mkdtemp(path.join(here, '.tmp-vite-'));
  await cp(path.join(here, 'fixtures', 'vite-app'), cwd, { recursive: true });
  devServer = await vite.createServer({
    root: cwd,
    configFile: false,
    plugins: [react()],
    cacheDir: path.join(cwd, '.vite'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await devServer.listen();
  await initHarness(cwd, { devServer: `http://127.0.0.1:${devServer.httpServer.address().port}`, providers: 'src/Providers.tsx' });
  server = createKloseServer({ cwd, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await devServer?.close();
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

async function open(node) {
  const project = await store.createProject(cwd, `Vite harness ${Date.now()}`);
  const added = await store.addNode(cwd, project.id, { x: 100, y: 100, width: 420, height: 300, status: 'built', ...node });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/canvas/${project.id}`);
  const card = page.locator(`[data-node-id="${added.id}"]`);
  await card.locator('iframe[data-live-state]').waitFor();
  return { page, card, frame: page.frameLocator(`[data-node-id="${added.id}"] iframe[data-live-state]`) };
}

const SKETCH = `export default function Restated() { return <p>Restated sketch</p>; }`;

test('a built card renders the real component through the Vite dev server: providers, props, styles, bridge', { skip }, async () => {
  const { page, card, frame } = await open({ name: 'Card', builtFilePath: 'src/Card.tsx', exportName: 'Card', code: SKETCH, props: { title: 'Hello ✓', count: 3 } });
  const real = frame.locator('[data-real-card]');
  await real.waitFor();
  // "Real:" comes from the app's provider, the title and count from the card's props.
  assert.equal(await real.locator('h2').innerText(), 'Real: Hello ✓');
  assert.equal(await real.locator('[data-count]').innerText(), '3');
  // src/index.css is imported by the app's entry, and so by the harness.
  assert.equal(await real.evaluate((el) => getComputedStyle(el).color), 'rgb(1, 2, 3)');
  await frame.locator('script[data-klose-bridge]').waitFor({ state: 'attached' });
  // Real first; the restatement is one click away.
  assert.equal(await card.locator('iframe[title="Sketch preview"]').count(), 0);
  await card.getByRole('button', { name: 'Sketch', exact: true }).click();
  await card.locator('iframe[title="Sketch preview"]').waitFor();
  await page.close();
});

test('the default export renders, and a component missing from the file says so', { skip }, async () => {
  const screen = await open({ name: 'Screen', builtFilePath: 'src/Card.tsx' });
  await screen.frame.locator('[data-real-screen]').waitFor();
  await screen.page.close();

  const missing = await open({ name: 'Gone', builtFilePath: 'src/Card.tsx', exportName: 'Nope' });
  await missing.frame.getByText('"src/Card.tsx#Nope" has no such export').waitFor();
  await missing.page.close();
});

// A sketch that imports the fixture's real component and reads the app's
// context: the sandbox can't draw this at all.
const REAL_SKETCH = `import { Card } from './src/Card';
import { useGreeting } from './src/Providers';
export default function Pricing() {
  const greeting = useGreeting();
  return (
    <div data-sketch>
      <Card title="Pro plan" count={2} />
      <button id="target" data-testid="buy">{greeting} Buy</button>
    </div>
  );
}`;

test('a sketch renders through the Vite dev server with its real imports, and an element in it can be targeted', { skip }, async () => {
  const { page, card, frame } = await open({ name: 'Pricing sketch', status: 'sketch', code: REAL_SKETCH });
  // The fixture's own Card, inside the app's providers, with the app's stylesheet.
  const real = frame.locator('[data-sketch] [data-real-card]');
  await real.waitFor();
  assert.equal(await real.locator('h2').innerText(), 'Real: Pro plan');
  assert.equal(await real.evaluate((el) => getComputedStyle(el).color), 'rgb(1, 2, 3)');
  assert.equal(await frame.locator('#target').innerText(), 'Real: Buy');
  assert.equal(await card.locator('iframe[title="Sketch preview"]').count(), 0, 'real first, not the sandbox');

  // Pick an element in it for a comment, as on any bridged frame.
  await frame.locator('script[data-klose-bridge]').waitFor({ state: 'attached' });
  await card.click({ position: { x: 200, y: 16 } });
  const comment = page.getByRole('button', { name: 'Comment', exact: true });
  await comment.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pick-unavailable"]'));
  await comment.click();
  // The page shows a crosshair once the bridge has been told to pick.
  await frame.locator('html[style*="crosshair"]').waitFor();
  await frame.locator('#target').click();
  await page.getByRole('button', { name: 'Element for the next comment' }).waitFor();
  await page.getByLabel(/^Comment on Pricing sketch/).fill('Make this primary');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.getByRole('button', { name: /^Comment 1: Make this primary/ }).waitFor();

  // The sandbox can't load the repo's modules, and says so instead of failing.
  await card.getByRole('button', { name: 'Sandbox', exact: true }).click();
  const notice = card.locator('[data-real-only="waiting"]');
  await notice.waitFor();
  assert.match(await notice.innerText(), /This sketch uses real components/);
  assert.match(await notice.innerText(), /Start your dev server/);
  assert.match(await notice.innerText(), /imports \.\/src\/Card, \.\/src\/Providers/);
  assert.equal(await card.locator('iframe[title="Sketch preview"]').count(), 0);
  await page.close();
});

test('a sketch whose code came from somewhere else stays out of the dev server until it is accepted on the canvas', { skip }, async () => {
  const project = await store.createProject(cwd, `Arrived ${Date.now()}`);
  const node = { id: `arrived-${Date.now()}`, name: 'Arrived', status: 'sketch', code: REAL_SKETCH, x: 100, y: 100, width: 420, height: 300 };
  await store.putProject(cwd, { ...project, nodes: [node] });
  assert.ok(!existsSync(path.join(cwd, 'klose.sketches', `${node.id}.tsx`)));

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/canvas/${project.id}`);
  const card = page.locator(`[data-node-id="${node.id}"]`);
  const notice = card.locator('[data-real-only="pending"]');
  await notice.waitFor();
  assert.match(await notice.innerText(), /did not come from this machine/);
  assert.equal(await card.locator('iframe').count(), 0, 'nothing of it runs anywhere yet');

  await notice.getByRole('button', { name: 'Run in my app' }).click();
  const frame = page.frameLocator(`[data-node-id="${node.id}"] iframe[data-live-state]`);
  await frame.locator('[data-sketch] [data-real-card]').waitFor();
  assert.ok(existsSync(path.join(cwd, 'klose.sketches', `${node.id}.tsx`)));
  await page.close();
});
