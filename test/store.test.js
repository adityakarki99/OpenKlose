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

test('listFeedback flattens element-scoped comments for agent consumption', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Review');
    const node = await store.addNode(cwd, project.id, {
      name: 'Checkout',
      builtFilePath: 'src/Checkout.tsx',
      comments: [{
        id: 'comment-1',
        text: 'Make this clearer',
        createdAt: 123,
        element: { tagName: 'button', text: 'Pay', classes: 'px-4', path: 'div > button' },
      }],
    });

    assert.deepEqual(await store.listFeedback(cwd, { projectId: project.id }), [{
      projectId: project.id,
      projectName: 'Review',
      nodeId: node.id,
      nodeName: 'Checkout',
      builtFilePath: 'src/Checkout.tsx',
      commentId: 'comment-1',
      text: 'Make this clearer',
      createdAt: 123,
      element: { tagName: 'button', text: 'Pay', classes: 'px-4', path: 'div > button' },
      status: 'new',
    }]);
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

test('seedDemoProject creates a project with one sketch node', async () => {
  await withTempRepo(async (cwd) => {
    const { project, node } = await store.seedDemoProject(cwd);
    assert.equal(project.name, 'Klose demo');
    assert.equal(node.status, 'sketch');
    assert.match(node.code, /export default function/);

    const list = await store.listProjects(cwd);
    assert.equal(list.length, 1);
  });
});

test('cleanup dry run reports built nodes and empty projects without changing anything', async () => {
  await withTempRepo(async (cwd) => {
    const withBuilt = await store.createProject(cwd, 'Has a built sketch');
    const builtNode = await store.addNode(cwd, withBuilt.id, { name: 'Done', status: 'built' });
    await store.addNode(cwd, withBuilt.id, { name: 'Still sketching' });

    const empty = await store.createProject(cwd, 'Never used');

    const report = await store.cleanup(cwd, { apply: false });
    assert.equal(report.removedNodes.length, 1);
    assert.equal(report.removedNodes[0].nodeId, builtNode.id);
    assert.deepEqual(
      report.removedProjects.map((p) => p.projectId).sort(),
      [empty.id].sort()
    );

    // Dry run — nothing on disk actually changed.
    const stillThere = await store.getProject(cwd, withBuilt.id);
    assert.equal(stillThere.nodes.length, 2);
    const stillEmpty = await store.getProject(cwd, empty.id);
    assert.equal(stillEmpty.id, empty.id);
  });
});

test('cleanup --yes actually removes built nodes and empty projects', async () => {
  await withTempRepo(async (cwd) => {
    const withBuilt = await store.createProject(cwd, 'Has a built sketch');
    await store.addNode(cwd, withBuilt.id, { name: 'Done', status: 'built' });
    const keeper = await store.addNode(cwd, withBuilt.id, { name: 'Still sketching' });

    const empty = await store.createProject(cwd, 'Never used');

    await store.cleanup(cwd, { apply: true });

    const remaining = await store.getProject(cwd, withBuilt.id);
    assert.deepEqual(
      remaining.nodes.map((n) => n.id),
      [keeper.id]
    );

    await assert.rejects(() => store.getProject(cwd, empty.id));
  });
});

test('cleanup with only --built leaves an all-built project on the canvas', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'All built');
    await store.addNode(cwd, project.id, { name: 'Done', status: 'built' });

    await store.cleanup(cwd, { built: true, emptyProjects: false, apply: true });

    const remaining = await store.getProject(cwd, project.id);
    assert.equal(remaining.nodes.length, 0);
  });
});

test('resolveComments stamps open comments and listFeedback drops them', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Resolve');
    const node = await store.addNode(cwd, project.id, {
      name: 'Card',
      comments: [
        { id: 'a', text: 'One', createdAt: 1 },
        { id: 'b', text: 'Two', createdAt: 1, sentAt: 2 },
      ],
    });

    let feedback = await store.listFeedback(cwd, { projectId: project.id });
    assert.deepEqual(feedback.map((f) => [f.commentId, f.status]), [['a', 'new'], ['b', 'sent']]);

    const result = await store.resolveComments(cwd, project.id, node.id, ['b'], { note: 'Fixed', now: 10 });
    assert.deepEqual(result, { resolved: ['b'], open: 1 });

    feedback = await store.listFeedback(cwd, { projectId: project.id });
    assert.deepEqual(feedback.map((f) => f.commentId), ['a']);
    const all = await store.listFeedback(cwd, { projectId: project.id, includeResolved: true });
    const b = all.find((f) => f.commentId === 'b');
    assert.equal(b.status, 'resolved');
    assert.equal(b.resolution, 'Fixed');

    // No ids resolves the rest; resolving again is a no-op.
    assert.deepEqual(await store.resolveComments(cwd, project.id, node.id), { resolved: ['a'], open: 0 });
    assert.deepEqual(await store.resolveComments(cwd, project.id, node.id), { resolved: [], open: 0 });

    const saved = await store.getProject(cwd, project.id);
    assert.equal(saved.nodes[0].comments.length, 2, 'resolved comments stay on the node');
  });
});

test('resolveComments rejects unknown comment ids without writing anything', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Resolve');
    const node = await store.addNode(cwd, project.id, { name: 'Card', comments: [{ id: 'a', text: 'One', createdAt: 1 }] });
    await assert.rejects(store.resolveComments(cwd, project.id, node.id, ['a', 'nope']), /nope/);
    const saved = await store.getProject(cwd, project.id);
    assert.equal(saved.nodes[0].comments[0].resolvedAt, undefined);
  });
});

test('addNode places a sketch without a position to the right of the others', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Place');
    const first = await store.addNode(cwd, project.id, { name: 'A' });
    assert.deepEqual([first.x, first.y, first.width, first.height], [200, 160, 480, 360]);
    assert.ok(first.createdAt > 0);
    const second = await store.addNode(cwd, project.id, { name: 'B', width: 300 });
    assert.deepEqual([second.x, second.y, second.width], [200 + 480 + 80, 160, 300]);
    const pinned = await store.addNode(cwd, project.id, { name: 'C', x: 10, y: 20 });
    assert.deepEqual([pinned.x, pinned.y], [10, 20]);
  });
});

test('a project file is never read half-written, and a write leaves no temp file behind', async () => {
  await withTempRepo(async (cwd) => {
    const created = await store.createProject(cwd, 'Busy');
    // Large enough that a non-atomic write would be caught mid-way.
    const code = 'x'.repeat(200 * 1024);
    const node = await store.addNode(cwd, created.id, { name: 'Big', code });

    // Read as fast as possible while writes keep landing.
    let reads = 0;
    let stop = false;
    const reader = (async () => {
      while (!stop) {
        const project = await store.getProject(cwd, created.id); // throws on a truncated file
        assert.equal(project.nodes[0].code.length, code.length);
        reads++;
      }
    })();
    for (let i = 0; i < 50; i++) {
      await store.updateNode(cwd, created.id, node.id, { notes: `round ${i}` });
    }
    stop = true;
    await reader;
    assert.ok(reads > 0);

    const names = await readdir(path.join(cwd, '.klose', 'projects'));
    assert.deepEqual(names, [`${created.id}.json`]);
  });
});
