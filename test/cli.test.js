import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../server/store.js';

test('klose feedback prints stable JSON without clipboard handoff', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-cli-test-'));
  try {
    const project = await store.createProject(cwd, 'CLI');
    await store.addNode(cwd, project.id, {
      name: 'Button',
      comments: [{ id: 'feedback-1', text: 'Increase contrast', createdAt: 1 }],
    });
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');
    const result = spawnSync(process.execPath, [cli, 'feedback', `--project=${project.id}`], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.count, 1);
    assert.equal(output.feedback[0].commentId, 'feedback-1');
    assert.equal(output.feedback[0].text, 'Increase contrast');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('klose resolve marks comments addressed and feedback stops listing them', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-cli-test-'));
  try {
    const project = await store.createProject(cwd, 'CLI');
    const node = await store.addNode(cwd, project.id, {
      name: 'Button',
      comments: [
        { id: 'c1', text: 'Increase contrast', createdAt: 1 },
        { id: 'c2', text: 'Rounder', createdAt: 1 },
      ],
    });
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8' });

    const resolved = run('resolve', project.id, node.id, 'c1', '--note=Raised contrast');
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.deepEqual(JSON.parse(resolved.stdout), { resolved: ['c1'], open: 1 });

    const open = JSON.parse(run('feedback', `--project=${project.id}`).stdout);
    assert.deepEqual(open.feedback.map((f) => f.commentId), ['c2']);
    const all = JSON.parse(run('feedback', `--project=${project.id}`, '--all').stdout);
    assert.equal(all.feedback.find((f) => f.commentId === 'c1').resolution, 'Raised contrast');

    const missing = run('resolve', project.id);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /project id and a node id/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

// Every CLI run gets an empty hub home and no Claude sessions, so a hub the
// developer happens to be running can't answer for these repos.
const isolated = path.join(os.tmpdir(), `klose-cli-isolated-${process.pid}`);
const cliEnv = { ...process.env, KLOSE_HOME: path.join(isolated, 'klose'), CLAUDE_CONFIG_DIR: path.join(isolated, 'claude') };

function klose(cwd, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf-8', timeout: 20000, env: cliEnv });
}

async function withTempRepo(fn) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-cli-test-')));
  await mkdir(path.join(dir, '.git'));
  try {
    await fn(dir);
  } finally {
    // Never leave a background server behind, even when an assertion fails.
    klose(dir, 'stop');
    await rm(dir, { recursive: true, force: true });
  }
}

test('help: bare, --help and "help <command>" succeed; unknown commands fail', () => {
  const cwd = os.tmpdir();
  for (const args of [[], ['--help'], ['help'], ['help', 'serve'], ['serve', '--help']]) {
    const result = klose(cwd, ...args);
    assert.equal(result.status, 0, `klose ${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stdout, /Usage: klose/);
  }
  assert.match(klose(cwd, 'help', 'serve').stdout, /--detach/);
  const unknown = klose(cwd, 'nope');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown command "nope"/);
});

test('klose lint audits real files against the repo tokens, with lines, and needs a path', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-cli-test-'));
  try {
    await mkdir(path.join(cwd, 'src', 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'app', 'globals.css'), '@theme { --color-brand-500: #2563eb; }');
    await writeFile(path.join(cwd, 'src', 'app', 'page.tsx'), 'export default () => (\n  <div className="bg-indigo-600 p-4">hi</div>\n);');
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, TYPESAFE_API_KEY: '' } });

    const json = run('lint', 'src', '--json');
    assert.equal(json.status, 0, json.stderr);
    const result = JSON.parse(json.stdout);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].file, path.join('src', 'app', 'page.tsx'));
    assert.deepEqual(result.files[0].findings.map((f) => [f.class, f.lines]), [['bg-indigo-600', [2]]]);

    const text = run('lint', 'src/app/page.tsx');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /page\.tsx: 1 literal value in 2 classes/);
    assert.match(text.stdout, /bg-indigo-600\s+line 2\s+stock palette, 1 color token available/);
    assert.match(text.stdout, /1 file, 1 literal value in 1 file/);

    const missing = run('lint', 'nowhere', '--json');
    assert.equal(missing.status, 0);
    assert.match(missing.stderr, /no file or folder at nowhere/);
    assert.deepEqual(JSON.parse(missing.stdout).files, []);

    const none = run('lint');
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /lint needs a file or folder/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('init from a subfolder installs at the repo root and reports what it found', async () => {
  await withTempRepo(async (dir) => {
    await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'components', 'Button.tsx'), 'export function Button() {\n  return <button />;\n}\n');
    await writeFile(path.join(dir, 'src', 'app.css'), ':root { --brand: #f36; }\n');

    const result = klose(path.join(dir, 'src', 'components'), 'init');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /using repo root/);
    assert.ok(existsSync(path.join(dir, '.claude', 'skills', 'klose', 'SKILL.md')));
    assert.ok(existsSync(path.join(dir, '.klose', 'projects')));
    assert.ok(!existsSync(path.join(dir, 'src', 'components', '.klose')));
    assert.match(result.stdout, /CSS tokens\s+src[/\\]app\.css \(1 token\)/);
    assert.match(result.stdout, /1 exported component/);
    assert.match(result.stdout, /\/klose audit every page against our design system/);
    assert.match(await readFile(path.join(dir, '.klose', '.gitignore'), 'utf-8'), /server\.json/);
  });
});

test('init --ignore-projects keeps sketches out of git', async () => {
  await withTempRepo(async (dir) => {
    const result = klose(dir, 'init', '--ignore-projects', '--no-demo');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(dir, '.klose', '.gitignore'), 'utf-8'), /^projects\/$/m);
  });
});

test('serve --detach, a second serve, status and stop', async () => {
  await withTempRepo(async (dir) => {
    const started = klose(dir, 'serve', '--detach', '--port=0');
    assert.equal(started.status, 0, started.stderr);
    const { port } = JSON.parse(await readFile(path.join(dir, '.klose', 'server.json'), 'utf-8'));
    assert.match(started.stdout, new RegExp(`running at http://localhost:${port}`));

    const again = klose(dir, 'serve');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already running for this repo/);

    const status = JSON.parse(klose(dir, 'status', '--json').stdout);
    assert.equal(status.running, true);
    assert.equal(status.port, port);

    // A different repo must not mistake this server for its own.
    await withTempRepo(async (other) => {
      const otherStatus = klose(other, 'status', `--port=${port}`);
      assert.equal(otherStatus.status, 1);
      assert.match(otherStatus.stdout, /serving a different repo/);
      const clash = klose(other, 'serve', `--port=${port}`);
      assert.equal(clash.status, 1);
      assert.match(clash.stderr, /used by the Klose canvas for/);
    });

    const stopped = klose(dir, 'stop');
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.ok(!existsSync(path.join(dir, '.klose', 'server.json')));
    assert.equal(klose(dir, 'status').status, 1);
  });
});
