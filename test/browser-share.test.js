import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBundle, encryptBundle, makeBundle, newShareKey, shareApi, shareClient, syncShare } from '../server/shareCore.js';
import { createShareHost } from './helpers/shareHost.js';

// A shared canvas end to end: the built hosted canvas (web/static) in headless
// Chromium, opened on a share link, against an in-memory share host mounted
// on the same origin, the way the Klose site serves /canvas/ and /api/share.
// The agent's side is driven with the core directly, as the CLI does.

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'web', 'static');
const executable = playwright?.chromium?.executablePath?.();
const canRun = !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'index.html'));
const skip = canRun ? false : 'Chromium or the built hosted canvas (web/static) unavailable';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serveSite(dir, api) {
  return createServer(async (req, res) => {
    if ((await api(req, res)) !== false) return;
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, clean === '/' ? 'index.html' : clean);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
}

let browser;
let server;
let host;
let origin;

before(async () => {
  if (!canRun) return;
  host = createShareHost();
  server = serveSite(publicDir, host.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function eventually(fn, what, timeout = 10000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} (last: ${JSON.stringify(last)})`);
}

const CARD = 'export default function Card() { return <div className="p-4">Hello from the agent</div>; }';

const project = (nodes) => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Onboarding',
  description: '',
  nodes,
  designSystemPrompt: '',
  projectContext: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});
const sketch = (id, name, x) => ({ id, name, description: '', x, y: 100, width: 420, height: 300, createdAt: 1, updatedAt: 1, status: 'sketch', code: CARD, comments: [] });

/** The agent shares a project, as `klose share` does. */
async function agentShares(nodes) {
  const key = newShareKey();
  const client = shareClient(shareApi(origin));
  const p = project(nodes);
  const { id, etag } = await client.create(await encryptBundle(key, makeBundle(p, { themeCss: ':root{--brand:#f00}', repoName: 'acme-web' })));
  return { id, key, client, synced: { etag, project: p }, project: p };
}

async function openPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { context, page, errors };
}

test('a share link opens straight onto the canvas, with the sketch and the repo name', { skip }, async () => {
  const agent = await agentShares([sketch('a', 'Welcome card', 100)]);
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/s/${agent.id}/${agent.key}`);
    await eventually(() => page.url().endsWith(`#/canvas/${agent.project.id}`), 'the link lands on the project canvas');
    await page.getByText('Welcome card', { exact: true }).first().waitFor();
    assert.ok(host.log.some((l) => l.startsWith(`GET /api/share/${agent.id}`)));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a sketch the agent pushes appears on the open share, and a mark the user makes reaches the agent', { skip }, async () => {
  const agent = await agentShares([sketch('a', 'Welcome card', 100, )]);
  agent.project.nodes[0].comments = [{ id: 'c1', text: 'Bigger heading', createdAt: 1 }];
  agent.synced = (await syncShare({ ...agent, local: agent.project, synced: null })).synced;
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/s/${agent.id}/${agent.key}`);
    await page.getByText('Welcome card', { exact: true }).first().waitFor();

    // The agent adds a sketch from its checkout.
    const next = { ...agent.project, nodes: [...agent.project.nodes, sketch('b', 'Pricing table', 600)] };
    const pushed = await syncShare({ client: agent.client, id: agent.id, key: agent.key, synced: agent.synced, local: next });
    assert.equal(pushed.pushed, true);
    agent.synced = pushed.synced;
    await page.getByText('Pricing table', { exact: true }).first().waitFor({ timeout: 10000 });

    // The user copies the comment for the agent: the canvas marks it sent, and the mark goes out.
    await page.getByRole('button', { name: /^Copy 1 new comment$/ }).click();
    await eventually(async () => {
      const current = await agent.client.fetch(agent.id);
      const bundle = await decryptBundle(agent.key, current.payload);
      return bundle.project.nodes.find((n) => n.id === 'a')?.comments?.[0]?.sentAt;
    }, 'sentAt on the host');
    const onHost = await decryptBundle(agent.key, (await agent.client.fetch(agent.id)).payload);
    assert.equal(onHost.theme.css, ':root{--brand:#f00}', 'the tokens the agent sent survive the browser\'s push');
    assert.deepEqual(onHost.project.nodes.map((n) => n.id), ['a', 'b']);

    // And the agent's next sync sees it.
    const seen = await syncShare({ client: agent.client, id: agent.id, key: agent.key, synced: agent.synced, local: next });
    assert.equal(seen.pulled, true);
    assert.ok(seen.project.nodes[0].comments[0].sentAt > 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a reload comes back to the shared canvas, and a bad link says so', { skip }, async () => {
  const agent = await agentShares([sketch('a', 'Welcome card', 100)]);
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/s/${agent.id}/${agent.key}`);
    await page.getByText('Welcome card', { exact: true }).first().waitFor();
    await page.reload();
    await page.getByText('Welcome card', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.ok(page.url().endsWith(`#/canvas/${agent.project.id}`));

    await page.goto(`${origin}/#/s/${agent.id}/${newShareKey()}`);
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /key does not match/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
