#!/usr/bin/env node
// Installs the package exactly as a user gets it — `npm pack`, then
// `npm install <tarball>` into an empty repo — and walks the first run:
// init, serve --detach, load the canvas and the preview sandbox, status, stop.
// Unit tests run against the source tree, so only this catches a file missing
// from `files`, an unbuilt web/dist, or a bin that can't find its modules.
//
//   npm run build && npm run smoke
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf-8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function check(condition, message) {
  if (!condition) throw new Error(`smoke: ${message}`);
  console.log(`  ✓ ${message}`);
}

if (!existsSync(path.join(repoRoot, 'web', 'dist', 'index.html'))) {
  console.error('smoke: web/dist is missing — run "npm run build" first.');
  process.exit(1);
}

const work = await mkdtemp(path.join(os.tmpdir(), 'klose-smoke-'));
const app = path.join(work, 'app');
const bin = path.join(app, 'node_modules', '.bin', process.platform === 'win32' ? 'klose.cmd' : 'klose');
try {
  const [{ filename }] = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', work], repoRoot));
  const tarball = path.join(work, filename);
  console.log(`Packed ${filename}`);

  await mkdir(path.join(app, '.git'), { recursive: true });
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'smoke-app', private: true }), 'utf-8');
  run(npm, ['install', '--no-audit', '--no-fund', '-D', tarball], app);
  check(existsSync(bin), 'installed klose exposes a bin');

  const init = run(bin, ['init'], app);
  check(existsSync(path.join(app, '.claude', 'skills', 'klose', 'SKILL.md')), 'init installs the /klose skill');
  check(/Next: in Claude Code/.test(init), 'init tells the user what to do next');

  run(bin, ['serve', '--detach', '--port=0'], app);
  const { port } = JSON.parse(await readFile(path.join(app, '.klose', 'server.json'), 'utf-8'));
  const base = `http://127.0.0.1:${port}`;
  try {
    const index = await fetch(base);
    const html = await index.text();
    check(index.ok && /<div id="root">/.test(html), 'the canvas page is served from the packed web/dist');
    const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    check(script && (await fetch(base + script)).ok, `the canvas script ${script} is served`);
    const preview = await fetch(`${base}/preview.html`);
    check(preview.ok && /Content-Security-Policy/.test(await preview.text()), 'the preview sandbox is served');
    const projects = await (await fetch(`${base}/api/projects`)).json();
    check(Array.isArray(projects) && projects.length === 1, 'the demo project is readable over the API');
    check(/running for this repo/.test(run(bin, ['status'], app)), 'status finds the running server');
  } finally {
    spawnSync(bin, ['stop'], { cwd: app, shell: process.platform === 'win32' });
  }
  check(!existsSync(path.join(app, '.klose', 'server.json')), 'stop shuts the server down');
  console.log('Smoke test passed.');
} finally {
  await rm(work, { recursive: true, force: true });
}
