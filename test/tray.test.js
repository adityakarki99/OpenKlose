import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import { trayState } from '../server/hub.js';
import { buildTray, findTray, hasClang } from '../server/tray.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageRoot, 'bin', 'klose.js');

const repo = (name, agent, comments = 0) => ({ name, agent, comments });

test('trayState: the dot says what needs attention', () => {
  assert.equal(trayState([]).state, 'none');
  assert.equal(trayState([repo('a', null)]).state, 'none');
  assert.equal(trayState([repo('a', 'idle')]).state, 'idle');
  assert.equal(trayState([repo('a', 'idle'), repo('b', 'working')]).state, 'working');

  // Comments in a repo whose agent is busy are being dealt with…
  assert.equal(trayState([repo('a', 'working', 3)]).state, 'working');
  // …but in a repo with an idle agent, or none, someone has to hand them over.
  assert.equal(trayState([repo('a', 'idle', 1)]).state, 'feedback');
  assert.equal(trayState([repo('a', null, 2)]).state, 'feedback');
  assert.equal(trayState([repo('a', 'working', 3), repo('b', 'idle', 1)]).state, 'feedback');

  const all = trayState([repo('a', 'working', 3), repo('b', 'idle', 1), repo('c', null)]);
  assert.deepEqual({ agents: all.agents, working: all.working, comments: all.comments }, { agents: 2, working: 1, comments: 4 });
  assert.equal(all.repos.length, 3);
});

test('GET /api/tray on a hub; a per-repo server has no tray', async (t) => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-tray-http-')));
  t.after(() => rm(base, { recursive: true, force: true }));

  const start = async (options) => {
    const server = createKloseServer(options);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };

  const hub = await start({ hub: { claudeDir: path.join(base, 'claude'), home: path.join(base, 'home') } });
  const res = await fetch(`${hub}/api/tray`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: 'none', agents: 0, working: 0, comments: 0, repos: [] });

  const single = await start({ cwd: base });
  assert.equal((await fetch(`${single}/api/tray`)).status, 404);
});

function klose(env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: os.tmpdir(), encoding: 'utf-8', timeout: 20000, env: { ...process.env, ...env } });
}

test('klose tray status and stop when nothing is running', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-tray-cli-')));
  const env = { KLOSE_HOME: path.join(dir, 'home'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
  try {
    const status = klose(env, 'tray', 'status');
    assert.equal(status.status, 1);
    assert.match(status.stdout, /menu bar app is not running/);
    assert.deepEqual(JSON.parse(klose(env, 'tray', 'status', '--json').stdout), { running: false, hub: { running: false } });
    assert.match(klose(env, 'tray', 'stop').stdout, /not running/);
    assert.deepEqual(await findTray(env.KLOSE_HOME), { state: 'stopped' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('klose tray off macOS explains itself instead of failing to build', { skip: process.platform === 'darwin' }, () => {
  const result = klose({ KLOSE_HOME: path.join(os.tmpdir(), `klose-tray-none-${process.pid}`) }, 'tray');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /macOS-only for now/);
});

// Compiles the real app, so it only runs where that is possible. Nothing is
// launched: --check exits before the app touches the menu bar.
test('the menu bar app compiles and links', { skip: !hasClang() && 'needs macOS with the command line tools' }, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-tray-build-')));
  try {
    const first = await buildTray(packageRoot, '0.0.0-test', home);
    assert.equal(first.built, true);
    assert.ok(existsSync(first.binary));
    assert.match(path.basename(first.binary), /^klose-tray-0\.0\.0-test-[0-9a-f]{8}$/);

    const check = spawnSync(first.binary, ['--check'], { encoding: 'utf-8', timeout: 10000 });
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stdout.trim(), 'klose-tray ok');

    // Same version and source: reused, not rebuilt.
    assert.deepEqual(await buildTray(packageRoot, '0.0.0-test', home), { binary: first.binary, built: false });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
