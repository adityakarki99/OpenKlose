import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFolderStore, memoryFolder } from '../lib/folderStore.js';
import * as diskStore from '../server/store.js';

// The hosted canvas's store writes the same files as server/store.js, through
// a folder the browser was given instead of node:fs. These tests drive it
// over an in-memory folder and, where it matters, compare it with the disk
// store, so the CLI (disk) and the hosted canvas (folder) can't drift apart.

function fresh(initial) {
  let tick = 1_700_000_000_000;
  const now = () => (tick += 1000);
  const fs = memoryFolder(initial, { now });
  return { fs, store: createFolderStore(fs, { uuid: randomUUID, now }) };
}

test('an empty folder lists no projects and never creates .klose/ by reading', async () => {
  const { fs, store } = fresh();
  assert.deepEqual(await store.listProjects(), []);
  assert.equal(await store.stamp(), '');
  assert.equal(fs.files.size, 0);
});

test('create, list, get, update and delete a project under .klose/projects/', async () => {
  const { fs, store } = fresh();
  const project = await store.createProject('Billing');
  assert.ok([...fs.files.keys()].includes(`.klose/projects/${project.id}.json`));
  assert.equal(project.name, 'Billing');
  assert.deepEqual(project.nodes, []);

  const listed = await store.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, project.id);
  assert.equal('projectContext' in listed[0], false, 'the listing leaves out the fields a save writes');

  const updated = await store.updateProject(project.id, { name: 'Billing v2', repo: { state: 'saved' }, savedToRepo: { x: 1 } });
  assert.equal(updated.name, 'Billing v2');
  assert.equal('savedToRepo' in updated, false, 'export bookkeeping cannot be written back through an update');
  assert.equal('repo' in updated, false);
  assert.ok(updated.updated_at > project.updated_at);
  assert.equal((await store.getProject(project.id)).name, 'Billing v2');

  await store.deleteProject(project.id);
  assert.deepEqual(await store.listProjects(), []);
  await assert.rejects(store.getProject(project.id), (err) => err.code === 'PROJECT_NOT_FOUND' && err.status === 404);
});

test('nodes are placed and updated like the disk store does it', async () => {
  const { store } = fresh();
  const project = await store.createProject('P');
  const a = await store.addNode(project.id, { name: 'A', code: 'x' });
  const b = await store.addNode(project.id, { name: 'B' });
  assert.equal(a.status, 'sketch');
  assert.deepEqual({ x: a.x, y: a.y, width: a.width, height: a.height }, { x: 200, y: 160, width: 480, height: 360 });
  assert.equal(b.x, 200 + 480 + 80, 'the next sketch lands to the right of the first');
  assert.equal(b.y, 160);

  const moved = await store.updateNode(project.id, a.id, { status: 'built', builtFilePath: 'src/A.tsx' });
  assert.equal(moved.builtFilePath, 'src/A.tsx');
  const saved = await store.getProject(project.id);
  assert.equal(saved.nodes.find((n) => n.id === a.id).status, 'built');
  await assert.rejects(store.updateNode(project.id, 'nope', {}), (err) => err.code === 'NODE_NOT_FOUND');
});

test('the first write adds .klose/.gitignore with the per-machine files, and keeps what is there', async () => {
  const { fs, store } = fresh({ '.klose/.gitignore': 'projects/\n' });
  await store.createProject('P');
  const lines = fs.files.get('.klose/.gitignore').text.trim().split('\n');
  assert.deepEqual(lines, ['projects/', 'server.json', 'server.log', 'canvas.json', 'shares/']);
});

test('feedback lists open comments with their element, in the shape the CLI prints', async () => {
  const { store } = fresh();
  const project = await store.createProject('P');
  const node = await store.addNode(project.id, { name: 'Card' });
  await store.updateNode(project.id, node.id, {
    comments: [
      { id: 'c1', text: 'Bigger', createdAt: 1, element: { tagName: 'button', text: 'Go', classes: 'cta', path: 'div > button' } },
      { id: 'c2', text: 'Done', createdAt: 2, resolvedAt: 3 },
    ],
  });
  const open = await store.listFeedback({ projectId: project.id });
  assert.equal(open.length, 1);
  assert.equal(open[0].commentId, 'c1');
  assert.equal(open[0].status, 'new');
  assert.equal(open[0].element.tagName, 'button');
  assert.equal((await store.listFeedback({ projectId: project.id, includeResolved: true })).length, 2);
});

test('the stamp changes when a project file is written, added or removed, and not otherwise', async () => {
  const { store } = fresh();
  const p = await store.createProject('P');
  const s1 = await store.stamp();
  assert.equal(await store.stamp(), s1, 'reading does not change it');
  await store.addNode(p.id, { name: 'A' });
  const s2 = await store.stamp();
  assert.notEqual(s2, s1);
  const q = await store.createProject('Q');
  const s3 = await store.stamp();
  assert.notEqual(s3, s2);
  await store.deleteProject(q.id);
  assert.notEqual(await store.stamp(), s3);
});

test('files that are not projects are skipped, never deleted', async () => {
  const { fs, store } = fresh({ '.klose/projects/notes.json': '{"hello":1}', '.klose/projects/broken.json': '{' });
  assert.deepEqual(await store.listProjects(), []);
  assert.equal(fs.files.size, 2);
});

test('the canvas marker says the hosted canvas has the repo open, once the repo has a .klose/', async () => {
  const { fs, store } = fresh();
  assert.equal(await store.writeCanvasMarker({ url: 'https://example.test/klose/' }), false);
  assert.equal(fs.files.size, 0, 'opening a folder to look writes nothing into it');
  await store.createProject('P');
  assert.equal(await store.writeCanvasMarker({ url: 'https://example.test/klose/' }), true);
  const marker = JSON.parse(fs.files.get('.klose/canvas.json').text);
  assert.equal(marker.canvas, 'hosted');
  assert.equal(marker.url, 'https://example.test/klose/');
  assert.ok(Date.parse(marker.seenAt));
});

test('the demo project matches the one klose init seeds on disk', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-folder-store-test-'));
  try {
    const { store } = fresh();
    const mem = await store.seedDemoProject();
    const disk = await diskStore.seedDemoProject(dir);
    const strip = ({ id, createdAt, updatedAt, ...node }) => node;
    assert.equal(mem.project.name, disk.project.name);
    assert.deepEqual(strip(mem.node), strip(disk.node));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
