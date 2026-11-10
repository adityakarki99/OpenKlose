import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../server/store.js';
import { createFolderStore, memoryFolder } from '../lib/folderStore.js';
import { flowStatus, planNodes, planProblems } from '../server/flow.js';
import { DEFAULT_NODE, FIRST_NODE_AT, NODE_GAP, flowNodeProblem, liveNodeProblem, settleApproval } from '../server/storeCore.js';
import { mergeShared } from '../server/shareCore.js';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

async function withTempRepo(fn) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-flow-test-'));
  try {
    await fn(cwd, (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8' }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const PLAN = {
  description: 'Sign up with email.',
  steps: [
    {
      name: 'Enter email',
      description: 'Email field and continue.',
      states: [
        { state: 'default', code: 'export default () => <form />' },
        { state: 'error', notes: 'Already registered.', code: 'export default () => <p>taken</p>' },
        { state: 'loading', name: 'Sending…', code: 'export default () => <p>…</p>', height: 200 },
      ],
    },
    { name: 'Check your inbox', states: [{ state: 'default', code: 'export default () => <p>sent</p>', width: 600 }] },
    { name: 'Done', states: [{ state: 'default', code: 'export default () => <p>done</p>' }] },
  ],
};

let n = 0;
const ids = () => `node-${++n}`;

// ── plan validation ─────────────────────────────────────────────────────────

test('planProblems accepts a well-formed plan', () => {
  assert.deepEqual(planProblems(PLAN), []);
});

test('planProblems reports every problem at once, each with where it is', () => {
  const problems = planProblems({
    description: 7,
    steps: [
      { name: '', states: [{ state: 'default', code: 'x' }, { state: 'Default', code: 'y' }, { state: 'a\nb', code: 'z' }] },
      { name: 'No states', states: [] },
      { name: 'Bad state', states: [{ state: 'default' }, { state: 'big', code: 'x', width: 5, notes: 3 }] },
      'not a step',
    ],
  });
  const has = (text) => assert.ok(problems.some((p) => p.includes(text)), `expected a problem mentioning ${JSON.stringify(text)} in:\n${problems.join('\n')}`);
  has('description must be a string');
  has('steps[0].name is required');
  has('steps[0].states[1].state "Default" is listed twice');
  has('steps[0].states[2].state must be a short one-line label');
  has('steps[1].states must be a non-empty list');
  has('steps[2].states[0].code is required');
  has('steps[2].states[1].width must be a number');
  has('steps[2].states[1].notes must be a string');
  has('steps[3] must be an object');
  assert.equal(problems.length, 9);
});

test('planProblems rejects a plan that is not an object, or has no steps', () => {
  assert.equal(planProblems(null).length, 1);
  assert.equal(planProblems([]).length, 1);
  assert.deepEqual(planProblems({ steps: [] }), ['steps must be a non-empty list']);
});

// ── layout ──────────────────────────────────────────────────────────────────

test('planNodes runs steps left to right and stacks a step\'s states top to bottom', () => {
  const nodes = planNodes(PLAN, { newId: ids, now: 5 });
  assert.equal(nodes.length, 5);
  const [a, b, c, inbox, done] = nodes;

  assert.deepEqual([a.step, b.step, c.step, inbox.step, done.step], [1, 1, 1, 2, 3]);
  assert.deepEqual([a.state, b.state, c.state], ['default', 'error', 'loading']);

  // A step's states share a column and stack with the standard gap.
  assert.deepEqual([a.x, b.x, c.x], [FIRST_NODE_AT.x, FIRST_NODE_AT.x, FIRST_NODE_AT.x]);
  assert.equal(a.y, FIRST_NODE_AT.y);
  assert.equal(b.y, a.y + DEFAULT_NODE.height + NODE_GAP);
  assert.equal(c.y, b.y + DEFAULT_NODE.height + NODE_GAP);
  assert.equal(c.height, 200);

  // Each step starts a new column to the right, top-aligned; a column is as wide as its widest state.
  assert.equal(inbox.x, a.x + DEFAULT_NODE.width + NODE_GAP);
  assert.equal(inbox.y, FIRST_NODE_AT.y);
  assert.equal(inbox.width, 600);
  assert.equal(done.x, inbox.x + 600 + NODE_GAP);

  // Names, descriptions and notes come from the state, else the step.
  assert.equal(a.name, 'Enter email · default');
  assert.equal(c.name, 'Sending…');
  assert.equal(a.description, 'Email field and continue.');
  assert.equal(b.notes, 'Already registered.');
  assert.ok(!('notes' in a));
  assert.ok(nodes.every((node) => node.status === 'sketch' && node.createdAt === 5 && !node.approval));
  assert.equal(new Set(nodes.map((node) => node.id)).size, 5);
});

// ── fields and approval through the write paths ─────────────────────────────

test('flow fields are checked (step and approval by flowNodeProblem, state with the map fields), and only when present', () => {
  assert.equal(flowNodeProblem({ name: 'x' }), null);
  assert.equal(flowNodeProblem({ step: 2, state: 'error', approval: { status: 'approved', at: 1 } }), null);
  assert.equal(flowNodeProblem({ approval: null }), null);
  assert.match(flowNodeProblem({ step: 0 }), /step must be/);
  assert.match(flowNodeProblem({ step: 1.5 }), /step must be/);
  assert.match(liveNodeProblem({ step: 1, state: '' }), /state must be/);
  assert.match(liveNodeProblem({ step: 1, state: 'x'.repeat(41) }), /state must be/);
  assert.match(flowNodeProblem({ approval: { status: 'yes', at: 1 } }), /approval must be/);
  assert.match(flowNodeProblem({ approval: { status: 'approved' } }), /approval must be/);
});

test('the store refuses bad flow fields and keeps good ones through every write', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Flow');
    await assert.rejects(() => store.addNode(cwd, project.id, { name: 'x', step: -1 }), /step must be/);
    const node = await store.addNode(cwd, project.id, { name: 'Email', step: 1, state: 'default', code: 'a' });
    assert.equal(node.step, 1);
    assert.equal(node.state, 'default');
    await assert.rejects(() => store.updateNode(cwd, project.id, node.id, { approval: { status: 'maybe', at: 1 } }), /approval must be/);

    const approval = { status: 'approved', at: 10 };
    await store.updateNode(cwd, project.id, node.id, { approval });
    // An unrelated update, and a whole-project save from the canvas, leave them alone.
    await store.updateNode(cwd, project.id, node.id, { notes: 'n', x: 900 });
    const read = await store.getProject(cwd, project.id);
    await store.updateProject(cwd, project.id, { name: 'Renamed', nodes: read.nodes.map((nd) => ({ ...nd, width: 500 })) });
    const [kept] = (await store.getProject(cwd, project.id)).nodes;
    assert.deepEqual({ step: kept.step, state: kept.state, approval: kept.approval }, { step: 1, state: 'default', approval });
    await assert.rejects(
      () => store.updateProject(cwd, project.id, { nodes: [{ ...kept, state: 'two\nlines' }] }),
      /state must be/
    );
  });
});

test('changing a frame\'s code clears its approval, from updateNode and from a project save', async () => {
  await withTempRepo(async (cwd) => {
    const project = await store.createProject(cwd, 'Flow');
    const a = await store.addNode(cwd, project.id, { name: 'A', step: 1, state: 'default', code: 'a', approval: { status: 'approved', at: 1 } });
    const b = await store.addNode(cwd, project.id, { name: 'B', step: 2, state: 'default', code: 'b', approval: { status: 'approved', at: 1 } });

    // The agent rewrites A (the CLI's update-node path).
    const updated = await store.updateNode(cwd, project.id, a.id, { code: 'a2' });
    assert.ok(!('approval' in updated));

    // The canvas saves the whole project with B's code edited and its old approval still attached.
    const read = await store.getProject(cwd, project.id);
    await store.updateProject(cwd, project.id, { nodes: read.nodes.map((nd) => (nd.id === b.id ? { ...nd, code: 'b2' } : nd)) });
    const after = await store.getProject(cwd, project.id);
    assert.ok(after.nodes.every((nd) => !nd.approval), 'neither frame is still approved');

    // The same code written again is not a change; a write carrying a fresh verdict keeps it.
    await store.updateNode(cwd, project.id, a.id, { approval: { status: 'approved', at: 2 } });
    assert.deepEqual((await store.updateNode(cwd, project.id, a.id, { code: 'a2' })).approval, { status: 'approved', at: 2 });
    assert.deepEqual((await store.updateNode(cwd, project.id, a.id, { code: 'a3', approval: { status: 'approved', at: 3 } })).approval, { status: 'approved', at: 3 });
  });
});

test('the folder store (hosted canvas) settles approvals the same way', async () => {
  const folder = createFolderStore(memoryFolder());
  const project = await folder.createProject('Flow');
  const node = await folder.addNode(project.id, { name: 'A', step: 1, state: 'default', code: 'a', approval: { status: 'approved', at: 1 } });
  await assert.rejects(() => folder.updateNode(project.id, node.id, { step: 'one' }), /step must be/);
  assert.ok(!('approval' in (await folder.updateNode(project.id, node.id, { code: 'a2' }))));
  const again = await folder.updateNode(project.id, node.id, { approval: { status: 'changes', at: 2 } });
  await folder.updateProject(project.id, { nodes: [{ ...again, code: 'a3' }] });
  assert.ok(!(await folder.getProject(project.id)).nodes[0].approval);
});

test('settleApproval leaves a frame alone when there is nothing to settle', () => {
  const approved = { id: 'n', code: 'a', approval: { status: 'approved', at: 1 } };
  assert.equal(settleApproval(undefined, approved), approved);
  assert.equal(settleApproval({ id: 'n', code: 'a' }, approved), approved);
  const moved = { ...approved, x: 5 };
  assert.equal(settleApproval(approved, moved), moved);
  assert.ok(!('approval' in settleApproval(approved, { ...approved, code: 'b' })));
});

test('a shared-canvas merge drops an approval of code the merge replaced', () => {
  const base = { id: 'p', nodes: [{ id: 'n', name: 'A', step: 1, code: 'a', updatedAt: 1 }] };
  // The user approved the old code on the shared canvas while the agent rewrote it here.
  const incoming = { id: 'p', nodes: [{ ...base.nodes[0], approval: { status: 'approved', at: 5 }, updatedAt: 2 }] };
  const local = { id: 'p', nodes: [{ ...base.nodes[0], code: 'a2', updatedAt: 3 }] };
  const merged = mergeShared({ base, local, incoming });
  assert.equal(merged.nodes[0].code, 'a2');
  assert.ok(!merged.nodes[0].approval);

  // Approved there, only moved here: the approval stands.
  const movedHere = { id: 'p', nodes: [{ ...base.nodes[0], x: 40, updatedAt: 3 }] };
  assert.deepEqual(mergeShared({ base, local: movedHere, incoming }).nodes[0].approval, { status: 'approved', at: 5 });
});

// ── status ──────────────────────────────────────────────────────────────────

test('flowStatus sorts frames into ready and blocked, with reasons', () => {
  const open = [{ id: 'c1', text: 'tighter', createdAt: 1 }];
  const done = [{ id: 'c2', text: 'ok', createdAt: 1, resolvedAt: 2 }];
  const approved = { status: 'approved', at: 1 };
  const status = flowStatus({
    id: 'p',
    name: 'Sign-up',
    nodes: [
      { id: 'error', name: 'Email error', step: 1, state: 'error', y: 600, code: 'x', approval: approved, comments: open },
      { id: 'email', name: 'Email', step: 1, state: 'default', y: 160, code: 'x', approval: approved, comments: done },
      { id: 'inbox', name: 'Inbox', step: 2, state: 'default', y: 160, code: 'x' },
      { id: 'expired', name: 'Expired', step: 2, state: 'expired-link', y: 600, code: 'x', approval: { status: 'changes', at: 1 } },
      { id: 'done', name: 'Done', step: 3, y: 160, status: 'built', builtFilePath: 'src/Done.tsx', approval: approved },
      { id: 'loose', name: 'Not part of the flow', code: 'x' },
    ],
  });

  assert.equal(status.isFlow, true);
  assert.equal(status.complete, false);
  assert.deepEqual(status.steps.map((s) => [s.step, s.built, s.states.map((f) => f.nodeId)]), [
    [1, false, ['email', 'error']],
    [2, false, ['inbox', 'expired']],
    [3, true, ['done']],
  ]);
  assert.deepEqual(status.ready, [{ nodeId: 'email', name: 'Email', step: 1, state: 'default' }]);
  assert.deepEqual(status.blocked.map((b) => [b.nodeId, b.reason]), [
    ['error', '1 open comment'],
    ['inbox', 'not approved yet'],
    ['expired', 'changes requested'],
  ]);
  assert.deepEqual(status.totals, { steps: 3, frames: 5, approved: 3, changesRequested: 1, built: 1, ready: 1, blocked: 3, pendingComments: 1 });
  const built = status.steps[2].states[0];
  assert.deepEqual([built.state, built.status, built.builtFilePath], ['default', 'built', 'src/Done.tsx']);
});

test('flowStatus of a project with no flow frames, and of a finished flow', () => {
  const none = flowStatus({ id: 'p', name: 'Plain', nodes: [{ id: 'a', name: 'A' }] });
  assert.deepEqual([none.isFlow, none.complete, none.totals.frames], [false, false, 0]);
  const finished = flowStatus({ id: 'p', name: 'F', nodes: [{ id: 'a', name: 'A', step: 1, status: 'built', builtFilePath: 'a.tsx' }] });
  assert.deepEqual([finished.complete, finished.ready, finished.blocked], [true, [], []]);
});

// ── CLI ─────────────────────────────────────────────────────────────────────

test('klose flow create rejects a bad plan with every problem, and creates nothing', async () => {
  await withTempRepo(async (cwd, run) => {
    await writeFile(path.join(cwd, 'plan.json'), JSON.stringify({ steps: [{ name: '', states: [{ state: 'default' }] }] }));
    const result = run('flow', 'create', 'Broken', '@plan.json');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /2 problems/);
    assert.match(result.stderr, /steps\[0\]\.name is required/);
    assert.match(result.stderr, /steps\[0\]\.states\[0\]\.code is required/);
    assert.deepEqual(await store.listProjects(cwd), []);
  });
});

test('klose flow create, status, approve and unapprove, end to end', async () => {
  await withTempRepo(async (cwd, run) => {
    await writeFile(path.join(cwd, 'plan.json'), JSON.stringify(PLAN));
    const created = run('flow', 'create', 'Sign-up flow', '@plan.json', '--json');
    assert.equal(created.status, 0, created.stderr);
    const flow = JSON.parse(created.stdout);
    assert.deepEqual([flow.name, flow.steps, flow.frames], ['Sign-up flow', 3, 5]);

    const project = await store.getProject(cwd, flow.projectId);
    assert.equal(project.description, 'Sign up with email.');
    assert.deepEqual(project.nodes.map((nd) => `${nd.step}:${nd.state}`), ['1:default', '1:error', '1:loading', '2:default', '3:default']);

    const status = () => JSON.parse(run('flow', 'status', 'sign-up FLOW', '--json').stdout);
    assert.deepEqual([status().totals.ready, status().totals.blocked], [0, 5]);

    // By node id and by step:state.
    const approved = JSON.parse(run('flow', 'approve', flow.projectId, flow.nodes[0].nodeId, '2:default', '--json').stdout);
    assert.deepEqual(approved.approved.map((f) => `${f.step}:${f.state}`), ['1:default', '2:default']);
    assert.deepEqual(status().ready.map((f) => `${f.step}:${f.state}`), ['1:default', '2:default']);

    // A comment blocks an approved frame; a code change takes the approval back.
    await store.updateNode(cwd, flow.projectId, flow.nodes[0].nodeId, { comments: [{ id: 'c', text: 'Bigger', createdAt: 1 }] });
    await store.updateNode(cwd, flow.projectId, flow.nodes[3].nodeId, { code: 'export default () => <p>changed</p>' });
    const blocked = status();
    assert.deepEqual(blocked.ready, []);
    assert.equal(blocked.blocked.find((b) => b.step === 1 && b.state === 'default').reason, '1 open comment');
    assert.equal(blocked.blocked.find((b) => b.step === 2).reason, 'not approved yet');

    // --all approves what isn't yet, and says how many already were.
    const all = JSON.parse(run('flow', 'approve', flow.projectId, '--all', '--json').stdout);
    assert.deepEqual([all.approved.length, all.unchanged], [4, 1]);
    assert.equal(status().totals.approved, 5);

    const cleared = JSON.parse(run('flow', 'unapprove', flow.projectId, '1:error', '--json').stdout);
    assert.deepEqual(cleared.unapproved.map((f) => f.state), ['error']);
    assert.equal(status().totals.approved, 4);

    // Building a frame is the ordinary update-node; the flow then counts it as built.
    run('project', 'update-node', flow.projectId, flow.nodes[4].nodeId, '{"status":"built","builtFilePath":"src/Done.tsx"}');
    const text = run('flow', 'status', flow.projectId);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /3 steps, 5 frames/);
    assert.match(text.stdout, /built → src\/Done\.tsx/);

    const missing = run('flow', 'approve', flow.projectId, '9:default');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no flow frame "9:default"/);
    assert.equal(run('flow', 'status', 'No such flow').status, 1);
  });
});
