import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedLiveUrl, liveNodeProblem, MAX_SNAPSHOT_CHARS } from '../server/storeCore.js';
import * as store from '../server/store.js';
import { createFolderStore, memoryFolder } from '../lib/folderStore.js';
import { createKloseServer } from '../server/http.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const GOOD = 'http://localhost:8081/__klose?c=Home';
const BAD = 'https://example.com/app';

test('isAllowedLiveUrl accepts only http(s) on this machine', () => {
  for (const url of [
    'http://localhost',
    'http://localhost:8081/x?y=1#z',
    'https://localhost:3000',
    'http://127.0.0.1:5173/',
    'http://[::1]:19006/',
    'http://app.localhost:3000/',
    'http://LOCALHOST:3000',
  ]) assert.equal(isAllowedLiveUrl(url), true, url);
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'ftp://localhost/',
    'http://user:pw@localhost:3000/',
    'http://user@localhost/',
    'https://example.com',
    'http://localhost.evil.com/',
    'http://evil.com/.localhost',
    'http://notlocalhost/',
    'http://127.0.0.2/',
    'http://0.0.0.0:3000/',
    ' http://localhost',
    'localhost:3000',
    '',
    null,
    undefined,
    42,
  ]) assert.equal(isAllowedLiveUrl(url), false, String(url));
});

test('liveNodeProblem checks url and snapshot, and ignores nodes without them', () => {
  assert.equal(liveNodeProblem({ name: 'x' }), null);
  assert.equal(liveNodeProblem({ url: GOOD, snapshot: PNG }), null);
  assert.match(liveNodeProblem({ url: BAD }), /localhost/);
  assert.match(liveNodeProblem({ snapshot: 'http://x/y.png' }), /PNG data URL/);
  assert.match(liveNodeProblem({ snapshot: PNG + 'A'.repeat(MAX_SNAPSHOT_CHARS) }), /limit/);
});

test('the disk store round-trips a good url and refuses a bad one', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-live-'));
  try {
    const p = await store.createProject(cwd, 'Live');
    const node = await store.addNode(cwd, p.id, { name: 'Home', url: GOOD, snapshot: PNG });
    assert.equal((await store.getProject(cwd, p.id)).nodes[0].url, GOOD);
    await assert.rejects(store.addNode(cwd, p.id, { name: 'Bad', url: BAD }), { status: 400, code: 'INVALID_LIVE_URL' });
    await assert.rejects(store.updateNode(cwd, p.id, node.id, { url: 'javascript:alert(1)' }), { code: 'INVALID_LIVE_URL' });
    await assert.rejects(store.updateProject(cwd, p.id, { nodes: [{ id: 'n', url: BAD }] }), { code: 'INVALID_LIVE_URL' });
    assert.equal((await store.updateNode(cwd, p.id, node.id, { url: 'http://127.0.0.1:5173/' })).url, 'http://127.0.0.1:5173/');
    assert.equal((await store.getProject(cwd, p.id)).nodes.length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the folder store round-trips a good url and refuses a bad one', async () => {
  const store2 = createFolderStore(memoryFolder(), { uuid: randomUUID });
  const p = await store2.createProject('Live');
  const node = await store2.addNode(p.id, { name: 'Home', url: GOOD });
  assert.equal((await store2.getProject(p.id)).nodes[0].url, GOOD);
  await assert.rejects(store2.addNode(p.id, { name: 'Bad', url: BAD }), { code: 'INVALID_LIVE_URL' });
  await assert.rejects(store2.updateNode(p.id, node.id, { url: 'file:///x' }), { code: 'INVALID_LIVE_URL' });
  await assert.rejects(store2.updateProject(p.id, { nodes: [{ id: 'n', url: BAD }] }), { code: 'INVALID_LIVE_URL' });
});

test('the HTTP API answers 400 INVALID_LIVE_URL for a bad url', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-live-'));
  const server = createKloseServer({ cwd, version: '9.9.9' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const { body: p } = await call('POST', '/api/projects', { name: 'P' });
    const ok = await call('POST', `/api/projects/${p.id}/nodes`, { name: 'Home', url: GOOD });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.url, GOOD);
    const bad = await call('POST', `/api/projects/${p.id}/nodes`, { name: 'Bad', url: BAD });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_LIVE_URL');
    const patch = await call('PATCH', `/api/projects/${p.id}/nodes/${ok.body.id}`, { url: 'http://u:p@localhost/' });
    assert.equal(patch.status, 400);
    const put = await call('PATCH', `/api/projects/${p.id}`, { nodes: [{ id: 'n', url: BAD }] });
    assert.equal(put.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(cwd, { recursive: true, force: true });
  }
});

test('klose project add-node / update-node accept a good url and refuse a bad one', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-live-'));
  try {
    const p = await store.createProject(cwd, 'CLI');
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');
    const run = (...args) => spawnSync(process.execPath, [cli, 'project', ...args], { cwd, encoding: 'utf-8' });
    const added = run('add-node', p.id, JSON.stringify({ name: 'Home', url: GOOD }));
    assert.equal(added.status, 0, added.stderr);
    const node = JSON.parse(added.stdout);
    assert.equal(node.url, GOOD);
    const bad = run('add-node', p.id, JSON.stringify({ name: 'Bad', url: BAD }));
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /localhost/);
    const badUpdate = run('update-node', p.id, node.id, JSON.stringify({ url: 'data:text/html,x' }));
    assert.notEqual(badUpdate.status, 0);
    assert.equal((await store.getProject(cwd, p.id)).nodes.length, 1);
    assert.match(spawnSync(process.execPath, [cli, 'help', 'project'], { encoding: 'utf-8' }).stdout, /"url":"http:\/\/localhost/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
