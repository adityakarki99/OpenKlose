import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decryptBundle,
  encryptBundle,
  isPayload,
  makeBundle,
  mergeShared,
  newShareId,
  newShareKey,
  parseShareUrl,
  shareApi,
  shareClient,
  shareUrl,
  syncShare,
} from '../server/shareCore.js';
import * as share from '../server/share.js';
import * as store from '../server/store.js';
import { createShareHost } from './helpers/shareHost.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

// A shared canvas: the project at a link, encrypted with a key only the link
// carries, kept in step between the agent's checkout (server/share.js) and
// the hosted canvas (lib/shareSession.ts) by server/shareCore.js. These tests
// drive both sides against an in-memory share host (test/helpers/shareHost.js),
// which is what the Klose site's api/share functions implement.

let host;
let origin;

before(async () => {
  host = createShareHost();
  origin = await host.listen();
});

after(async () => {
  await host.close();
});

const project = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Billing',
  description: '',
  nodes: [],
  designSystemPrompt: '',
  projectContext: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const node = (id, overrides = {}) => ({ id, name: id, x: 0, y: 0, width: 1, height: 1, createdAt: 1, updatedAt: 1, code: 'a', comments: [], ...overrides });

test('a bundle round-trips through the payload, and only with the right key', async () => {
  const key = newShareKey();
  const bundle = makeBundle(project(), { themeCss: ':root{--x:1}', repoName: 'acme' });
  const payload = await encryptBundle(key, bundle);
  assert.ok(isPayload(payload));
  assert.ok(!JSON.stringify(payload).includes('Billing'), 'the host sees no plaintext');
  assert.deepEqual(await decryptBundle(key, payload), bundle);
  await assert.rejects(decryptBundle(newShareKey(), payload), /key does not match/);
  await assert.rejects(decryptBundle(key, { ...payload, data: payload.data.slice(0, -2) + 'AA' }), /key does not match/);
  assert.equal(isPayload({ ...payload, alg: 'none' }), false);
});

test('a share link carries the host, the id and the key, and parses back', () => {
  const id = newShareId();
  const key = newShareKey();
  const url = shareUrl('https://www.klosegrid.com/', id, key);
  assert.equal(url, `https://www.klosegrid.com/canvas/#/s/${id}/${key}`);
  assert.deepEqual(parseShareUrl(url), { host: 'https://www.klosegrid.com', id, key });
  assert.equal(parseShareUrl('https://www.klosegrid.com/canvas/#/projects'), null);
  assert.equal(shareApi('https://www.klosegrid.com/'), 'https://www.klosegrid.com/api/share');
});

test('mergeShared keeps local edits, takes the rest from the other side, and never drops a comment', () => {
  const base = project({ nodes: [node('a'), node('b'), node('c')] });
  // The agent rewrote a's code and deleted c; the user commented on a and moved b.
  const local = project({ nodes: [node('a', { code: 'new', updatedAt: 5 }), node('b')] });
  const incoming = project({
    name: 'Billing v2',
    nodes: [node('a', { comments: [{ id: 'c1', text: 'bigger', createdAt: 9 }], updatedAt: 7 }), node('b', { x: 50, updatedAt: 6 }), node('c')],
  });
  const merged = mergeShared({ base, local, incoming });
  assert.equal(merged.name, 'Billing v2', 'a project field not edited locally takes the incoming value');
  assert.deepEqual(
    merged.nodes.map((n) => n.id),
    ['a', 'b'],
    'the deletion sticks'
  );
  const a = merged.nodes.find((n) => n.id === 'a');
  assert.equal(a.code, 'new', 'the local edit wins on the sketch');
  assert.deepEqual(a.comments.map((c) => c.id), ['c1'], 'and the comment the user left on it is kept');
  assert.equal(a.updatedAt, 7);
  assert.equal(merged.nodes.find((n) => n.id === 'b').x, 50, 'an unchanged sketch takes the incoming one');
});

test('mergeShared prefers the more settled copy of a comment both sides hold', () => {
  const comment = { id: 'c1', text: 'bigger', createdAt: 1 };
  const base = project({ nodes: [node('a', { comments: [comment] })] });
  const local = project({ nodes: [node('a', { code: 'x', comments: [{ ...comment, resolvedAt: 5, resolution: 'done' }] })] });
  const incoming = project({ nodes: [node('a', { comments: [{ ...comment, sentAt: 3 }] })] });
  const [a] = mergeShared({ base, local, incoming }).nodes;
  assert.equal(a.comments[0].resolvedAt, 5);
});

test('syncShare keeps two sides in step through the host, merging when both wrote', async () => {
  const key = newShareKey();
  const client = shareClient(shareApi(origin));
  const agentProject = project({ nodes: [node('a')] });
  const { id, etag } = await client.create(await encryptBundle(key, makeBundle(agentProject, { themeCss: 'css' })));

  // The browser opens the link: nothing synced yet, nothing local.
  let browser = await syncShare({ client, id, key, synced: null, local: null });
  assert.equal(browser.pulled, true);
  assert.equal(browser.pushed, false);
  assert.deepEqual(browser.project, agentProject);
  assert.equal(browser.bundle.theme.css, 'css');
  assert.equal(browser.synced.etag, etag);

  // Nothing changed anywhere: no write.
  const idle = await syncShare({ client, id, key, synced: browser.synced, local: browser.project });
  assert.deepEqual([idle.pulled, idle.pushed], [false, false]);

  // The user comments; the agent, meanwhile, adds a sketch. Both push.
  const userVersion = { ...browser.project, nodes: [{ ...browser.project.nodes[0], comments: [{ id: 'c1', text: 'hi', createdAt: 2 }], updatedAt: 2 }] };
  browser = await syncShare({ client, id, key, synced: browser.synced, local: userVersion, bundleExtras: { themeCss: 'css' } });
  assert.equal(browser.pushed, true);

  const agentVersion = { ...agentProject, nodes: [agentProject.nodes[0], node('b')] };
  const agent = await syncShare({ client, id, key, synced: { etag, project: agentProject }, local: agentVersion, bundleExtras: { themeCss: 'css' } });
  assert.equal(agent.pulled, true, 'the comment came in');
  assert.equal(agent.pushed, true, 'the new sketch went out');
  assert.deepEqual(agent.project.nodes.map((n) => n.id), ['a', 'b']);
  assert.equal(agent.project.nodes[0].comments[0].text, 'hi');

  browser = await syncShare({ client, id, key, synced: browser.synced, local: browser.project });
  assert.deepEqual(browser.project, agent.project, 'the browser now sees the same project');
  assert.equal(browser.bundle.theme.css, 'css', 'the tokens survive every push');
});

test('syncShare retries on a write that lost a race, on top of what won', async () => {
  const key = newShareKey();
  const client = shareClient(shareApi(origin));
  const p0 = project({ nodes: [node('a')] });
  const { id, etag } = await client.create(await encryptBundle(key, makeBundle(p0)));
  const synced = { etag, project: p0 };

  // Between this side's read and write, the other side lands a change.
  let intercepted = false;
  const racing = {
    ...client,
    async put(...args) {
      if (!intercepted) {
        intercepted = true;
        await client.put(id, await encryptBundle(key, makeBundle({ ...p0, nodes: [p0.nodes[0], node('other')] })), { ifMatch: etag });
      }
      return client.put(...args);
    },
  };
  const mine = { ...p0, nodes: [p0.nodes[0], node('mine')] };
  const result = await syncShare({ client: racing, id, key, synced, local: mine });
  assert.equal(result.pushed, true);
  assert.deepEqual(result.project.nodes.map((n) => n.id).sort(), ['a', 'mine', 'other']);
  const onHost = await decryptBundle(key, (await client.fetch(id)).payload);
  assert.deepEqual(onHost.project, result.project);
});

// ----------------------------------------------------------------- the CLI

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

// The share host lives in this process, so the CLI has to run without
// blocking the event loop (spawnSync would starve the host).
function run(cwd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, KLOSE_SHARE_HOST: origin, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const klose = (cwd, ...args) => run(cwd, args);

async function withTempRepo(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-share-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('klose share prints a link, keeps the key out of git, and syncs around the project commands', async () => {
  await withTempRepo(async (dir) => {
    const p = await store.createProject(dir, 'Shared');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'x' });

    const shared = await klose(dir, 'share', p.id, '--json');
    assert.equal(shared.status, 0, shared.stderr);
    const info = JSON.parse(shared.stdout);
    assert.equal(info.created, true);
    const link = parseShareUrl(info.url);
    assert.equal(link.host, origin);
    assert.ok(host.blobs.has(link.id));
    assert.ok(existsSync(path.join(dir, '.klose', 'shares', `${p.id}.json`)));
    assert.match(await readFile(path.join(dir, '.klose', '.gitignore'), 'utf-8'), /shares\//);
    assert.match((await klose(dir, 'share', p.id)).stdout, /Already shared at/);
    assert.match((await klose(dir, 'status')).stdout, new RegExp(`is shared at ${origin.replace(/[.]/g, '\\.')}`));

    // The user, on the shared canvas, leaves a comment: simulated with the core directly.
    const client = shareClient(shareApi(origin));
    const theirs = await syncShare({ client, id: link.id, key: link.key, synced: null, local: null });
    assert.equal(theirs.bundle.repo.name, path.basename(dir));
    const commented = { ...theirs.project, nodes: [{ ...theirs.project.nodes[0], comments: [{ id: 'c1', text: 'Bigger', createdAt: 3 }], updatedAt: 3 }] };
    await syncShare({ client, id: link.id, key: link.key, synced: theirs.synced, local: commented });

    // `klose feedback` pulls first, so the comment is there.
    const feedback = await klose(dir, 'feedback', `--project=${p.id}`);
    assert.equal(feedback.status, 0, feedback.stderr);
    assert.deepEqual(JSON.parse(feedback.stdout).feedback.map((f) => f.commentId), ['c1']);

    // `klose resolve` and `klose project update-node` push afterwards.
    assert.equal((await klose(dir, 'resolve', p.id, a.id, 'c1', '--note=done')).status, 0);
    const updated = await klose(dir, 'project', 'update-node', p.id, a.id, '{"code":"y"}');
    assert.equal(updated.status, 0, updated.stderr);
    const onHost = await decryptBundle(link.key, (await client.fetch(link.id)).payload);
    assert.equal(onHost.project.nodes[0].code, 'y');
    assert.equal(onHost.project.nodes[0].comments[0].resolvedAt > 0, true);

    const list = JSON.parse((await klose(dir, 'share', 'list', '--json')).stdout);
    assert.deepEqual(list.shares.map((s) => s.projectId), [p.id]);

    // Another checkout joins the same link and gets the project.
    await withTempRepo(async (other) => {
      const joined = await klose(other, 'share', 'join', info.url, '--json');
      assert.equal(joined.status, 0, joined.stderr);
      assert.equal(JSON.parse(joined.stdout).projectId, p.id);
      const got = await store.getProject(other, p.id);
      assert.equal(got.nodes[0].code, 'y');
    });

    assert.match((await klose(dir, 'share', 'leave', p.id)).stdout, /Forgot the share/);
    assert.equal((await klose(dir, 'share', 'list')).stdout.includes(p.id), false);
  });
});

test('a share host that cannot be reached is a warning, not a failure of klose feedback', async () => {
  await withTempRepo(async (dir) => {
    const p = await store.createProject(dir, 'Offline');
    const shared = await klose(dir, 'share', p.id, '--json');
    assert.equal(shared.status, 0, shared.stderr);
    // The record remembers its host, so point it at a port nothing listens on.
    const record = JSON.parse(await readFile(path.join(dir, '.klose', 'shares', `${p.id}.json`), 'utf-8'));
    record.host = 'http://127.0.0.1:9';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, '.klose', 'shares', `${p.id}.json`), JSON.stringify(record));
    const unreachable = await klose(dir, 'feedback', `--project=${p.id}`);
    assert.equal(unreachable.status, 0, unreachable.stderr);
    assert.match(unreachable.stderr, /could not sync the shared canvas/);
    assert.equal(JSON.parse(unreachable.stdout).count, 0);
  });
});
