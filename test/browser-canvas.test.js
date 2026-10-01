import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import * as store from '../server/store.js';

// The canvas itself, driven in headless Chromium against a real server and a
// temp repo. Like browser-preview.test.js, this needs Playwright and a built
// web/dist, and skips without them; CI's build job provides both.

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

const CARD = `export default function Card() {
  return <div className="p-6"><h1 className="text-xl font-semibold">Card</h1><button className="mt-4 rounded bg-blue-600 px-3 py-1 text-white">Go</button></div>;
}`;

let browser;
let server;
let origin;
let cwd;

before(async () => {
  if (!canRun) return;
  cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-canvas-test-'));
  server = createKloseServer({ cwd, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

/** Polls `fn` until it returns a truthy value, or fails with `what`. */
async function eventually(fn, what, timeout = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

/** A project with two sketches side by side, opened on the canvas. */
async function openCanvas({ comments = [] } = {}) {
  const project = await store.createProject(cwd, `Test ${Date.now()}`);
  const a = await store.addNode(cwd, project.id, { name: 'Card A', code: CARD, x: 100, y: 100, width: 420, height: 300, comments });
  const b = await store.addNode(cwd, project.id, { name: 'Card B', code: CARD, x: 600, y: 100, width: 420, height: 300 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/canvas/${project.id}`);
  await page.locator(`[data-node-id="${a.id}"]`).waitFor();
  return { page, project, a, b, errors };
}

const select = (page, id) => page.locator(`[data-node-id="${id}"]`).click({ position: { x: 200, y: 16 } });

test('opening a file writes nothing and reads as saved', { skip }, async () => {
  const { page, project, errors } = await openCanvas();
  const before = (await store.getProject(cwd, project.id)).updated_at;
  // Longer than the 2s autosave debounce.
  await page.waitForTimeout(2600);
  assert.equal((await store.getProject(cwd, project.id)).updated_at, before);
  assert.equal(await page.getByRole('button', { name: 'All changes saved' }).count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test("the agent's write keeps an unsaved local edit, and undo can't revert the agent", { skip }, async () => {
  const { page, project, a, b, errors } = await openCanvas();
  await select(page, a.id);
  // Unsaved local edit: nudge A one grid step right (autosave waits 2s).
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  // Meanwhile the agent rewrites B.
  await store.updateNode(cwd, project.id, b.id, { name: 'Card B v2' });

  await page.getByText('Card B v2').first().waitFor();
  await page.getByText(/Agent updated "Card B v2"/).waitFor();
  const aBox = await page.locator(`[data-node-id="${a.id}"]`).evaluate((el) => el.style.left);
  assert.equal(aBox, '120px', 'the local nudge survived the merge');

  // Undo after the agent's update must not bring the old B back.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('Card B v2').count() > 0, true);

  // Autosave then writes the merge: both changes on disk.
  await eventually(async () => {
    const saved = await store.getProject(cwd, project.id);
    const nodeA = saved.nodes.find((n) => n.id === a.id);
    const nodeB = saved.nodes.find((n) => n.id === b.id);
    return nodeA.x === 120 && nodeB.name === 'Card B v2';
  }, 'the merged version on disk');
  assert.deepEqual(errors, []);
  await page.close();
});

test('copying marks comments sent; the agent resolving them shows up', { skip }, async () => {
  const { page, project, a, errors } = await openCanvas({ comments: [{ id: 'c1', text: 'Bigger heading', createdAt: 1 }] });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await select(page, a.id);
  // The selected sketch rides in the chat box as a tag, which also filters the list.
  await page.getByRole('button', { name: 'Show all sketches' }).waitFor();
  await page.getByRole('button', { name: /^Copy 1 new comment$/ }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /1\. Bigger heading \[comment c1\]/);
  await eventually(async () => (await store.getProject(cwd, project.id)).nodes[0].comments[0].sentAt, 'sentAt on disk');

  await store.resolveComments(cwd, project.id, a.id, ['c1'], { note: 'Now text-2xl' });
  await page.getByText(/resolved 1 comment/).waitFor();
  await page.getByRole('button', { name: /Resolved · 1/ }).click();
  await page.getByText('Now text-2xl').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('each comment copies on its own, and Fit lives in the size panel', { skip }, async () => {
  const { page, project, a, errors } = await openCanvas({
    comments: [
      { id: 'c1', text: 'Bigger heading', createdAt: 1 },
      { id: 'c2', text: 'Less padding', createdAt: 2 },
    ],
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await select(page, a.id);

  await page.getByRole('button', { name: 'Copy comment 2 for the agent' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /Less padding \[comment c2\]/);
  assert.doesNotMatch(clip, /Bigger heading/, 'only that comment is copied');
  await eventually(async () => {
    const [c1, c2] = (await store.getProject(cwd, project.id)).nodes[0].comments;
    return c2.sentAt && !c1.sentAt;
  }, 'only c2 marked sent');
  await page.getByRole('button', { name: /^Copy 1 new comment$/ }).waitFor();

  // Fitting the frame is a sizing control now, not a toolbar action.
  assert.equal(await page.getByRole('toolbar').getByRole('button', { name: 'Fit frame to preview' }).count(), 0);
  assert.equal(await page.getByRole('group', { name: 'Frame size' }).getByRole('button', { name: 'Fit frame to preview' }).count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('delete undoes from the toast; zoom answers keys and a wheel over a preview', { skip }, async () => {
  const { page, a, b, errors } = await openCanvas();
  await select(page, b.id);
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('[data-node-id]').count(), 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.locator('[data-node-id]').count(), 2);

  const zoomLabel = () => page.getByRole('group', { name: 'Zoom' }).textContent();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Equal');
  await eventually(async () => (await zoomLabel()).includes('125%'), 'zoom 125%');

  // A selected preview takes pointer events; ⌘/Ctrl + wheel over it must still zoom the canvas.
  await select(page, a.id);
  const frame = page.locator(`[data-node-id="${a.id}"] iframe`);
  await page.frameLocator(`[data-node-id="${a.id}"] iframe`).getByRole('button', { name: 'Go' }).waitFor();
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await eventually(async () => !(await zoomLabel()).includes('125%'), 'zoom to change from a wheel over the preview');
  assert.deepEqual(errors, []);
  await page.close();
});

test('white text on a saturated fill stays white in the light theme', { skip }, async () => {
  const { page, errors } = await openCanvas({ comments: [{ id: 'c1', text: 'Hi', createdAt: 1 }] });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  // The tray's number badge: white on blue/slate.
  const color = await page.locator('aside[aria-label="Feedback"] span.text-white').first().evaluate((el) => getComputedStyle(el).color);
  assert.equal(color, 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  assert.deepEqual(errors, []);
  await page.close();
});
