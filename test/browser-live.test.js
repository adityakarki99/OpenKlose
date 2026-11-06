import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import * as store from '../server/store.js';

// Live frame cards: a node with a `url` is drawn as a frame onto a page
// running on this machine, and falls back to its snapshot when that page is
// gone. Needs Playwright + a built web/dist, like browser-canvas.test.js.

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'web', 'dist');
const executable = playwright?.chromium?.executablePath?.();
const canRun = !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'index.html'));
const skip = canRun ? false : 'Chromium or built web assets unavailable';

// A 1x1 PNG.
const SNAPSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let browser;
let server;
let origin;
let cwd;
let app;
let appPort;

const APP_HTML = `<!doctype html><title>Live</title><button id="b" onclick="this.textContent='Clicked'">Press me</button>`;

before(async () => {
  if (!canRun) return;
  cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-live-test-'));
  server = createKloseServer({ cwd, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  app = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(APP_HTML);
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  appPort = app.address().port;
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (app?.listening) await new Promise((resolve) => app.close(resolve));
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

async function open(node) {
  const project = await store.createProject(cwd, `Live ${Date.now()}`);
  const added = await store.addNode(cwd, project.id, { x: 100, y: 100, width: 420, height: 300, ...node });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/canvas/${project.id}`);
  await page.locator(`[data-node-id="${added.id}"]`).waitFor();
  return { page, project, node: added };
}

test('a url node renders a live, clickable frame once selected', { skip }, async () => {
  const { page, node } = await open({ name: 'Live', status: 'built', url: `http://127.0.0.1:${appPort}/`, snapshot: SNAPSHOT });
  const card = page.locator(`[data-node-id="${node.id}"]`);
  const iframe = card.locator('iframe');
  await iframe.waitFor();
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms');
  assert.equal(await iframe.getAttribute('referrerpolicy'), 'no-referrer');
  const frame = page.frameLocator(`[data-node-id="${node.id}"] iframe`);
  await frame.getByRole('button', { name: 'Press me' }).waitFor();
  // Unselected: the frame ignores the mouse, so the canvas can drag the card.
  assert.equal(await iframe.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
  await card.click({ position: { x: 200, y: 16 } });
  await page.waitForFunction((id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"] iframe`)).pointerEvents === 'auto', node.id);
  await frame.getByRole('button', { name: 'Press me' }).click();
  await frame.getByRole('button', { name: 'Clicked' }).waitFor();
  await page.close();
});

test('with the dev server stopped the card shows its snapshot, or a placeholder', { skip }, async () => {
  // A port nothing listens on: grab one and release it.
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const deadPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const url = `http://127.0.0.1:${deadPort}/`;

  const withSnap = await open({ name: 'Snap', status: 'built', url, snapshot: SNAPSHOT });
  const img = withSnap.page.locator(`[data-node-id="${withSnap.node.id}"] img[data-live-state="snapshot"]`);
  await img.waitFor();
  assert.equal(await withSnap.page.locator(`[data-node-id="${withSnap.node.id}"] iframe`).count(), 0);
  await withSnap.page.close();

  const bare = await open({ name: 'Bare', status: 'built', url });
  const card = bare.page.locator(`[data-node-id="${bare.node.id}"]`);
  await card.getByText('Dev server not running').waitFor();
  assert.match(await card.innerText(), new RegExp(`127\\.0\\.0\\.1:${deadPort}`));
  await bare.page.close();
});

test('a bad url written straight into the project file shows the error state, never a frame', { skip }, async () => {
  const project = await store.createProject(cwd, `Bad ${Date.now()}`);
  const added = await store.addNode(cwd, project.id, { name: 'Sneaky', x: 100, y: 100, width: 420, height: 300 });
  // Bypass the stores' check the way a hand edit would.
  await store.putProject(cwd, {
    ...(await store.getProject(cwd, project.id)),
    nodes: [{ ...added, url: 'https://example.com/', snapshot: SNAPSHOT }],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const requested = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(`${origin}/canvas/${project.id}`);
  const card = page.locator(`[data-node-id="${added.id}"]`);
  await card.getByRole('alert').waitFor();
  await card.getByText("This address can't be shown").waitFor();
  assert.equal(await card.locator('iframe').count(), 0);
  assert.equal(requested.some((u) => u.startsWith('https://example.com')), false);
  await page.close();
});
