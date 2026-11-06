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

// The klose-bridge.js protocol end to end: a page on another port loads the
// script from the Klose server, the canvas frames it, and the card picks
// elements, pins comments to them and refreshes its snapshot.
// Needs Playwright + a built web/dist, like browser-live.test.js.

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'web', 'dist');
const executable = playwright?.chromium?.executablePath?.();
const canRun =
  !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'index.html')) && existsSync(path.join(publicDir, 'klose-bridge.js'));
const skip = canRun ? false : 'Chromium or built web assets (with klose-bridge.js) unavailable';

let browser;
let server;
let origin;
let cwd;
let app;
let appPort;

const page_ = (bridgeSrc) => `<!doctype html><html><head><title>Bridged</title>
<style>body{margin:0;font:16px sans-serif;background:#fff}</style></head>
<body><h1>Title</h1><section><p>First</p><button id="target" style="margin:40px">Pick me</button></section>
${bridgeSrc ? `<script src="${bridgeSrc}"></script>` : ''}</body></html>`;

before(async () => {
  if (!canRun) return;
  cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-bridge-test-'));
  server = createKloseServer({ cwd, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  app = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(page_(req.url.startsWith('/plain') ? '' : `${origin}/klose-bridge.js`));
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

async function open(node, project) {
  project ??= await store.createProject(cwd, `Bridge ${Date.now()}`);
  const added = node ? await store.addNode(cwd, project.id, { x: 100, y: 100, width: 420, height: 320, status: 'built', ...node }) : null;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/canvas/${project.id}`);
  if (added) await page.locator(`[data-node-id="${added.id}"]`).waitFor();
  return { page, project, node: added };
}

const select = async (page, node) => {
  await page.locator(`[data-node-id="${node.id}"]`).click({ position: { x: 200, y: 16 } });
};

test('the server serves klose-bridge.js as a script any local page can load', { skip }, async () => {
  const res = await fetch(`${origin}/klose-bridge.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const body = await res.text();
  assert.match(body, /klose:ready/);
  assert.doesNotMatch(body, /^\s*import\s/m);
});

test('a bridged card picks an element, pins the comment, and the pin survives a reload', { skip }, async () => {
  const { page, project, node } = await open({ name: 'Bridged', url: `http://127.0.0.1:${appPort}/` });
  await select(page, node);
  const comment = page.getByRole('button', { name: 'Comment', exact: true });
  await comment.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pick-unavailable"]'));
  await comment.click();
  const frame = page.frameLocator(`[data-node-id="${node.id}"] iframe`);
  await frame.locator('#target').click();
  // The pick lands in the composer as the element being commented on.
  await page.getByRole('button', { name: 'Element for the next comment' }).waitFor();
  const composer = page.getByLabel(/^Comment on Bridged/);
  await composer.fill('Make this bigger');
  await page.getByRole('button', { name: 'Add comment' }).click();

  const pin = page.getByRole('button', { name: /^Comment 1: Make this bigger/ });
  await pin.waitFor();
  // The canvas saves a moment after the edit.
  let saved;
  for (const deadline = Date.now() + 10000; Date.now() < deadline; ) {
    saved = (await store.getProject(cwd, project.id)).nodes.find((n) => n.id === node.id);
    if (saved?.comments?.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(saved.comments.length, 1);
  assert.equal(saved.comments[0].element.tagName, 'button');
  assert.equal(saved.comments[0].element.text, 'Pick me');
  assert.ok(saved.comments[0].element.locator);

  // Reload: select the card again and the pin lands on the same button.
  await page.reload();
  await page.locator(`[data-node-id="${node.id}"]`).waitFor();
  await select(page, node);
  const again = page.getByRole('button', { name: /^Comment 1: Make this bigger/ });
  await again.waitFor();
  const pinBox = await again.boundingBox();
  const target = await page.frameLocator(`[data-node-id="${node.id}"] iframe`).locator('#target').boundingBox();
  assert.ok(pinBox && target);
  // The pin's tail points at the button's top-right corner.
  assert.ok(Math.abs(pinBox.x - (target.x + target.width)) < 6, `pin x ${pinBox.x} vs button right ${target.x + target.width}`);
  assert.ok(Math.abs(pinBox.y + pinBox.height - target.y) < 6, `pin y ${pinBox.y} vs button y ${target.y}`);
  await page.close();
});

test('a bridged card writes a snapshot after it loads', { skip }, async () => {
  const { page, project, node } = await open({ name: 'Snap', url: `http://127.0.0.1:${appPort}/` });
  const deadline = Date.now() + 15000;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = (await store.getProject(cwd, project.id)).nodes.find((n) => n.id === node.id)?.snapshot;
    if (snapshot) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(snapshot?.startsWith('data:image/png;base64,'), 'snapshot was written');
  await page.close();
});

test('a page without the bridge stays a plain frame: pick is disabled with a hint', { skip }, async () => {
  const { page, node } = await open({ name: 'Plain', url: `http://127.0.0.1:${appPort}/plain` });
  await select(page, node);
  const pick = page.getByTestId('pick-unavailable');
  await pick.waitFor();
  assert.equal(await pick.isDisabled(), true);
  assert.match(await pick.getAttribute('title'), /klose-bridge\.js/);
  const frame = page.frameLocator(`[data-node-id="${node.id}"] iframe`);
  await frame.locator('#target').waitFor();
  await page.close();
});

test('a framed page that is not the canvas gets no answer from the bridge', { skip }, async () => {
  // Another local origin framing the same bridged page: it is local, so the hello
  // is accepted, but a wrong nonce is not. Forged messages must do nothing.
  const { page } = await open(null);
  await page.goto(`http://127.0.0.1:${appPort}/`);
  const answered = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.src = `${location.origin}/`;
        document.body.appendChild(frame);
        window.addEventListener('message', (e) => e.source === frame.contentWindow && resolve(e.data));
        frame.onload = () => {
          // No handshake: a capture with a made-up nonce must get nothing back.
          frame.contentWindow.postMessage({ klose: 'canvas', nonce: 'x'.repeat(32), type: 'capture', id: '1' }, '*');
          setTimeout(() => resolve(null), 800);
        };
      })
  );
  assert.equal(answered, null);
  await page.close();
});
