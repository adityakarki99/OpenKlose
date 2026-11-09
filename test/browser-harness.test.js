import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import * as store from '../server/store.js';

// Built cards drawn through the component harness: a fake harness page on
// another port echoes the `c`, export and `props` it was given. Needs
// Playwright + a built web/dist, like browser-live.test.js.

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

const SNAPSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SKETCH_CODE = `export default function Restated() { return <p>Restated sketch</p>; }`;

// The fake harness: shows what the address carried.
const HARNESS_HTML = `<!doctype html><title>Harness</title><pre id="echo"></pre><script>
var frag = location.hash.slice(1), amp = frag.indexOf('&');
var props = null;
if (amp >= 0) { var b = new URLSearchParams(frag.slice(amp + 1)).get('props'); props = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (ch) { return ch.charCodeAt(0); }))); }
document.getElementById('echo').textContent = JSON.stringify({
  c: new URLSearchParams(location.search).get('c'),
  exp: decodeURIComponent(amp < 0 ? frag : frag.slice(0, amp)),
  props: props
});
</script>`;

let browser;
let server;
let origin;
let cwd;
let app;
let appPort;

const writeConfig = (port) =>
  writeFile(path.join(cwd, 'klose.config.json'), JSON.stringify({ framework: 'expo', devServer: `http://127.0.0.1:${port}`, harnessPath: '/__klose' }));

before(async () => {
  if (!canRun) return;
  cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-harness-browser-'));
  server = createKloseServer({ cwd, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  app = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(HARNESS_HTML);
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
  const project = await store.createProject(cwd, `Harness ${Date.now()}`);
  const added = await store.addNode(cwd, project.id, { x: 100, y: 100, width: 420, height: 300, ...node });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/canvas/${project.id}`);
  await page.locator(`[data-node-id="${added.id}"]`).waitFor();
  return { page, node: added, card: page.locator(`[data-node-id="${added.id}"]`) };
}

const BUILT = { name: 'Real card', status: 'built', builtFilePath: 'src/Card.tsx', exportName: 'Card', code: SKETCH_CODE };

test('a built node in the registry is framed at its harness address, with props', { skip }, async () => {
  await writeConfig(appPort);
  const { page, node, card } = await open({ ...BUILT, props: { title: 'Hello ✓', count: 3 } });
  const iframe = card.locator('iframe[data-live-state]');
  await iframe.waitFor();
  const src = await iframe.getAttribute('src');
  assert.ok(src.startsWith(`http://127.0.0.1:${appPort}/__klose?c=src%2FCard.tsx#Card`), src);
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms');
  const echo = JSON.parse(await page.frameLocator(`[data-node-id="${node.id}"] iframe[data-live-state]`).locator('#echo').innerText());
  assert.deepEqual(echo, { c: 'src/Card.tsx', exp: 'Card', props: { title: 'Hello ✓', count: 3 } });
  await page.close();
});

test('Real / Sketch toggle switches between the harness frame and the sandboxed restatement', { skip }, async () => {
  await writeConfig(appPort);
  const { page, card } = await open(BUILT);
  await card.locator('iframe[data-live-state]').waitFor();
  assert.equal(await card.locator('iframe[title="Sketch preview"]').count(), 0);
  await card.getByRole('button', { name: 'Sketch', exact: true }).click();
  await card.locator('iframe[title="Sketch preview"]').waitFor();
  assert.equal(await card.locator('iframe[data-live-state]').count(), 0);
  assert.equal(await card.locator('iframe[title="Sketch preview"]').getAttribute('sandbox'), 'allow-scripts');
  await card.getByRole('button', { name: 'Real', exact: true }).click();
  await card.locator('iframe[data-live-state]').waitFor();
  await page.close();
});

test('fallback order: harness frame, snapshot, sandboxed restatement, placeholder', { skip }, async () => {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const deadPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await writeConfig(deadPort);
  // The registry was written for the earlier config; a new built node keeps it current.
  const snap = await open({ ...BUILT, snapshot: SNAPSHOT });
  await snap.card.locator('img[data-live-state="snapshot"]').waitFor();
  assert.equal(await snap.card.locator('iframe[data-live-state]').count(), 0);
  await snap.page.close();

  const restated = await open(BUILT);
  await restated.card.locator('[data-live-state="fallback"] iframe[title="Sketch preview"]').waitFor();
  await restated.page.close();

  const bare = await open({ name: 'Bare', status: 'built', builtFilePath: 'src/Card.tsx', exportName: 'Card' });
  await bare.card.getByText('Dev server not running').waitFor();
  await bare.page.close();
});

test('a node outside the registry stays a sandboxed restatement', { skip }, async () => {
  await writeConfig(appPort);
  const sketch = await open({ name: 'Idea', code: SKETCH_CODE });
  await sketch.card.locator('iframe[title="Sketch preview"]').waitFor();
  assert.equal(await sketch.card.locator('iframe[data-live-state]').count(), 0);
  await sketch.page.close();
});
