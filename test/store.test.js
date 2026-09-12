import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as store from '../server/store.js';

async function withTempRepo(fn) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-store-test-'));
  try {
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('createProject / getProject / listProjects round-trip', async () => {
  await withTempRepo(async (cwd) => {
    const created = await store.createProject(cwd, 'My Project');
    assert.equal(created.name, 'My Project');
    assert.equal(created.nodes.length, 0);

    const fetched = await store.getProject(cwd, created.id);
    assert.deepEqual(fetched, created);

    const list = await store.listProjects(cwd);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('updateProject merges fields and bumps updated_at', async () => {
  await withTempRepo(async (cwd) => {
    const created = await store.createProject(cwd, 'Original');
    const updated = await store.updateProject(cwd, created.id, { name: 'Renamed' });
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.id, created.id);
    assert.notEqual(updated.updated_at, created.updated_at);
  });
});

test('addNode / updateNode round-trip', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'P');
    const node = await store.addNode(cwd, project.id, { name: 'Sketch', code: 'x' });
    assert.equal(node.status, 'sketch');

    const updatedNode = await store.updateNode(cwd, project.id, node.id, { status: 'built' });
    assert.equal(updatedNode.status, 'built');

    const fresh = await store.getProject(cwd, project.id);
    assert.equal(fresh.nodes[0].status, 'built');
  });
});

test('updateNode rejects an id that does not exist on the project', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'P');
    await assert.rejects(
      () => store.updateNode(cwd, project.id, 'not-a-real-node-id', { status: 'built' }),
      /not found/
    );
  });
});

test('deleteProject removes the project file', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'P');
    await store.deleteProject(cwd, project.id);
    const list = await store.listProjects(cwd);
    assert.equal(list.length, 0);
  });
});

// Project ids are always server-generated UUIDs. Anything else reaching the
// filesystem layer (e.g. a path-traversal payload smuggled in a route param)
// must be rejected before it can turn into a file path.
test('malformed ids are rejected instead of touching the filesystem', async () => {
  await withTempRepo(async (cwd) => {
    const malformedIds = ['../../../../etc/passwd', '..', 'not-a-uuid', '', '   ', '{}'];

    for (const id of malformedIds) {
      await assert.rejects(() => store.getProject(cwd, id), /Invalid project id/, `getProject(${JSON.stringify(id)})`);
      await assert.rejects(() => store.deleteProject(cwd, id), /Invalid project id/, `deleteProject(${JSON.stringify(id)})`);
      await assert.rejects(
        () => store.updateProject(cwd, id, { name: 'x' }),
        /Invalid project id/,
        `updateProject(${JSON.stringify(id)})`
      );
      await assert.rejects(
        () => store.addNode(cwd, id, { name: 'x' }),
        /Invalid project id/,
        `addNode(${JSON.stringify(id)})`
      );
    }

    // No stray files should have been created anywhere under cwd (e.g. no
    // "..json" or escaped paths), and .klose/projects should either not
    // exist yet or be empty.
    let entries = [];
    try {
      entries = await readdir(path.join(cwd, '.klose', 'projects'));
    } catch {
      // directory not created — also fine.
    }
    assert.deepEqual(entries, []);
  });
});
