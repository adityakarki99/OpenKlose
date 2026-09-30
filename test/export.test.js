import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../server/store.js';
import { exportProject, repoState, slugify } from '../server/export.js';
import { scanComponents } from '../server/scanner.js';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

test('slugify makes safe, stable file names', () => {
  assert.equal(slugify('Hub home — every repo, one canvas'), 'hub-home-every-repo-one-canvas');
  assert.equal(slugify('  Ünïcode / Sketch #2 '), 'unicode-sketch-2');
  assert.equal(slugify(''), 'untitled');
});

test('exportProject writes one .tsx per sketch plus a README planning doc', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-test-'));
  try {
    const project = await store.createProject(cwd, 'Hub + desktop shell');
    await store.updateProject(cwd, project.id, {
      description: 'Visual exploration.',
      projectContext: { targetAudience: 'Devs using Claude Code' },
    });
    await store.addNode(cwd, project.id, {
      name: 'Tray popover',
      description: 'Menubar popover',
      notes: 'Primary click toggles it.',
      code: 'export default function Tray() { return <div>tray</div>; }',
      comments: [{ id: 'c1', text: 'Dot should be amber', createdAt: 1, element: { tagName: 'span', text: '' } }],
    });
    await store.addNode(cwd, project.id, { name: 'Tray popover', code: 'export default function T2() { return null; }' });
    await store.addNode(cwd, project.id, { name: 'Built one', status: 'built', builtFilePath: 'src/X.tsx', code: '' });

    const out = path.join(cwd, 'docs', 'klose', 'hub');
    const result = await exportProject(cwd, project.id, out);
    assert.deepEqual(result.files, ['README.md', 'tray-popover.tsx', 'tray-popover-2.tsx', 'built-one.tsx']);

    const tsx = await readFile(path.join(out, 'tray-popover.tsx'), 'utf-8');
    assert.match(tsx, /^\/\/ @ts-nocheck\n\/\* eslint-disable \*\/\n\/\*\n \* Klose sketch — "Tray popover" \(sketch\)/);
    assert.match(tsx, /export default function Tray\(\)/);

    const readme = await readFile(path.join(out, 'README.md'), 'utf-8');
    assert.match(readme, /^# Hub \+ desktop shell\n\nVisual exploration\./);
    assert.match(readme, /3 sketches, 1 built/);
    assert.match(readme, /\*\*Audience:\*\* Devs using Claude Code/);
    assert.match(readme, /\[`tray-popover\.tsx`\]\(\.\/tray-popover\.tsx\)/);
    assert.match(readme, /### Notes\n\nPrimary click toggles it\./);
    assert.match(readme, /\*\*Pending feedback\*\*\n\n1\. Dot should be amber _\(on `span`\)_/);
    assert.match(readme, /\*\*Built as:\*\* `src\/X\.tsx`/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('klose project export defaults to docs/klose/<slug> and honours --out', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-cli-'));
  try {
    const project = await store.createProject(cwd, 'Hub + desktop shell');
    await store.addNode(cwd, project.id, { name: 'A', code: 'export default () => null' });

    const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf-8' });

    const byDefault = run('project', 'export', project.id);
    assert.equal(byDefault.status, 0, byDefault.stderr);
    assert.match(byDefault.stdout, /Exported 1 sketch to docs\/klose\/hub-desktop-shell/);
    await readFile(path.join(cwd, 'docs', 'klose', 'hub-desktop-shell', 'a.tsx'), 'utf-8');

    const custom = run('project', 'export', project.id, '--out=plans/hub', '--json');
    assert.equal(custom.status, 0, custom.stderr);
    const parsed = JSON.parse(custom.stdout);
    assert.equal(parsed.dir, 'plans/hub');
    await readFile(path.join(cwd, 'plans', 'hub', 'README.md'), 'utf-8');

    const missing = run('project', 'export');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /usage: klose project export/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('repoState: canvas until saved, then saved, then changed when content moves on', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-state-'));
  try {
    const project = await store.createProject(cwd, 'Pricing');
    const node = await store.addNode(cwd, project.id, { name: 'Card', code: 'export default () => null', x: 0, y: 0 });
    const state = async () => repoState(cwd, await store.getProject(cwd, project.id));

    assert.deepEqual(await state(), { state: 'canvas', dir: null, savedAt: null, files: 0 });

    const before = (await store.getProject(cwd, project.id)).updated_at;
    const result = await exportProject(cwd, project.id);
    assert.equal(result.repo.state, 'saved');
    assert.equal(result.repo.dir, 'docs/klose/pricing');
    assert.equal(result.repo.files, 2);
    // Saving is not an edit.
    assert.equal((await store.getProject(cwd, project.id)).updated_at, before);

    // Dragging a sketch changes nothing a save would write.
    await store.updateNode(cwd, project.id, node.id, { x: 400, y: 120 });
    assert.equal((await state()).state, 'saved');

    await store.updateNode(cwd, project.id, node.id, { notes: 'Needs an annual toggle.' });
    assert.equal((await state()).state, 'changed');

    // A client sending a stale record back can't undo the bookkeeping.
    await store.updateProject(cwd, project.id, { name: 'Pricing', savedToRepo: { dir: 'elsewhere', digest: 'x' } });
    assert.equal((await store.getProject(cwd, project.id)).savedToRepo.dir, 'docs/klose/pricing');

    // Deleting the folder puts the file back to "not in the repo".
    await rm(path.join(cwd, 'docs'), { recursive: true, force: true });
    assert.equal((await state()).state, 'canvas');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('re-saving removes files for sketches that are gone, and nothing else', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-stale-'));
  try {
    const project = await store.createProject(cwd, 'Nav');
    const keep = await store.addNode(cwd, project.id, { name: 'Keep', code: 'export default () => null' });
    await store.addNode(cwd, project.id, { name: 'Drop', code: 'export default () => null' });
    const { dir } = await exportProject(cwd, project.id);
    await writeFile(path.join(dir, 'mine.md'), 'hand-written', 'utf-8');

    await store.updateProject(cwd, project.id, { nodes: [keep] });
    const again = await exportProject(cwd, project.id);
    assert.deepEqual(again.files, ['README.md', 'keep.tsx']);
    assert.ok(!existsSync(path.join(dir, 'drop.tsx')));
    assert.ok(existsSync(path.join(dir, 'mine.md')));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('two projects with the same name save to different folders, and keep them', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-dirs-'));
  try {
    const a = await store.createProject(cwd, 'Billing');
    const b = await store.createProject(cwd, 'Billing');
    assert.equal((await exportProject(cwd, a.id)).repo.dir, 'docs/klose/billing');
    assert.equal((await exportProject(cwd, b.id)).repo.dir, 'docs/klose/billing-2');
    // Renaming doesn't move a file that is already in the repo.
    await store.updateProject(cwd, a.id, { name: 'Invoices' });
    assert.equal((await exportProject(cwd, a.id)).repo.dir, 'docs/klose/billing');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('saved sketches are not indexed as repo components', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-export-scan-'));
  try {
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'Real.tsx'), 'export function Real() {\n  return <div />;\n}\n', 'utf-8');
    const project = await store.createProject(cwd, 'Plan');
    await store.addNode(cwd, project.id, { name: 'Ghost', code: 'export default function Ghost() {\n  return <div />;\n}' });
    await exportProject(cwd, project.id);
    const { components } = await scanComponents(cwd, { force: true });
    assert.deepEqual(components.map((c) => c.name), ['Real']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
