import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import { addRepoFolder, finishSetup, readSetupSettings, resetSetup, setupState } from '../server/setup.js';
import { installSkills, skillStatus } from '../server/skills.js';
import { launchAgentPath, launchAgentPlist, setStartAtLogin } from '../server/tray.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageRoot, 'bin', 'klose.js');

// A machine with nothing on it: no Claude Code state, no ~/.klose, an empty
// home for skills. `cli` is left out, so setup never starts a process.
async function emptyMachine(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-setup-test-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const userHome = path.join(base, 'home');
  await mkdir(userHome, { recursive: true });
  return {
    base,
    options: { claudeDir: path.join(base, 'claude'), home: path.join(base, 'klose'), userHome, packageRoot, version: '0.0.0-test' },
  };
}

test('skillStatus tells missing, current, outdated and edited apart', async (t) => {
  const { options } = await emptyMachine(t);
  const states = async () => Object.fromEntries((await skillStatus(packageRoot, options.userHome)).map((s) => [s.name, s.state]));

  assert.equal((await states()).klose, 'missing');

  await installSkills(packageRoot, options.userHome);
  assert.ok(Object.values(await states()).every((s) => s === 'current'));

  const file = path.join(options.userHome, '.claude', 'skills', 'klose', 'SKILL.md');
  await writeFile(file, 'my own version\n', 'utf-8');
  assert.equal((await states()).klose, 'edited');

  // No recorded hash (installed before the manifest existed): Klose's own old copy.
  await rm(path.join(options.userHome, '.klose', 'skills.json'));
  assert.equal((await states()).klose, 'outdated');
});

test('setupState on an empty machine, then after the skills are installed', async (t) => {
  const { options } = await emptyMachine(t);
  const before = await setupState(options);
  assert.equal(before.claudeCode.found, false);
  assert.deepEqual(before.repos, []);
  assert.equal(before.skills.installed, false);
  assert.ok(before.skills.list.some((s) => s.name === 'klose' && s.state === 'missing'));
  assert.equal(before.onboarding.completed, false);
  assert.equal(before.menuBar.supported, process.platform === 'darwin');

  await mkdir(path.join(options.claudeDir, 'sessions'), { recursive: true });
  await installSkills(packageRoot, options.userHome);
  const after = await setupState(options);
  assert.equal(after.claudeCode.found, true);
  assert.equal(after.skills.installed, true);
});

test('addRepoFolder lists a real folder, expands ~, and refuses the rest', async (t) => {
  const { options } = await emptyMachine(t);
  const repo = path.join(options.userHome, 'code', 'shop');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });

  // A subfolder resolves to its repo.
  const added = await addRepoFolder(options, path.join(repo, 'src'));
  assert.deepEqual(added, { root: repo, added: true });
  assert.deepEqual(await addRepoFolder(options, repo), { root: repo, added: false });
  assert.deepEqual((await setupState(options)).repos.map((r) => r.root), [repo]);

  const fails = async (input, code) => assert.rejects(addRepoFolder(options, input), (err) => err.status === 400 && err.code === code);
  await fails('', 'PATH_REQUIRED');
  await fails('code/shop', 'PATH_NOT_ABSOLUTE');
  await fails('~/nope', 'PATH_NOT_FOUND');
  await fails(path.join(repo, '.git', 'missing'), 'PATH_NOT_FOUND');
  await fails('~', 'PATH_IS_HOME');
});

test('finishSetup marks setup done; resetSetup forgets it and nothing else', async (t) => {
  const { options } = await emptyMachine(t);
  const { state, warnings } = await finishSetup(options, {});
  assert.deepEqual(warnings, []);
  assert.equal(state.onboarding.completed, true);
  assert.ok((await readSetupSettings(options.home)).onboardingCompletedAt);

  await writeFile(path.join(options.home, 'settings.json'), JSON.stringify({ onboardingCompletedAt: 'x', other: 1 }), 'utf-8');
  const reset = await resetSetup(options);
  assert.equal(reset.onboarding.completed, false);
  assert.deepEqual(await readSetupSettings(options.home), { other: 1 });
});

test('the login item runs the menu bar app with the hub arguments', () => {
  const plist = launchAgentPlist({ binary: '/k/klose-tray', home: '/u/.klose', node: '/bin/node', cli: '/a&b/klose.js' });
  assert.match(plist, /<string>dev\.klose\.tray<\/string>/);
  assert.match(plist, /<string>\/k\/klose-tray<\/string>\s*<string>--home<\/string>\s*<string>\/u\/\.klose<\/string>/);
  assert.match(plist, /<string>\/a&amp;b\/klose\.js<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.doesNotMatch(launchAgentPlist({ binary: '/k', home: '/h' }), /--node/);
  assert.equal(launchAgentPath('/u'), path.join('/u', 'Library', 'LaunchAgents', 'dev.klose.tray.plist'));
});

test('turning start at login off removes the login item', async (t) => {
  const { options } = await emptyMachine(t);
  const file = launchAgentPath(options.userHome);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'old', 'utf-8');
  assert.equal(await setStartAtLogin(false, options), false);
  assert.equal(existsSync(file), false);
  // Already off is fine.
  assert.equal(await setStartAtLogin(false, options), false);
});

test('/api/setup on a hub: read, install skills, add a repo, finish, reset', async (t) => {
  const { options } = await emptyMachine(t);
  const server = createKloseServer({ hub: options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/setup`;
  const post = (sub, body = {}) =>
    fetch(`${url}/${sub}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const first = await (await fetch(url)).json();
  assert.equal(first.onboarding.completed, false);
  assert.equal(first.skills.installed, false);

  const skills = await (await post('skills')).json();
  assert.ok(skills.report.installed.includes('klose'));
  assert.equal(skills.state.skills.installed, true);
  assert.ok(existsSync(path.join(options.userHome, '.claude', 'skills', 'klose', 'SKILL.md')));

  const repo = path.join(options.userHome, 'app');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  const added = await (await post('repos', { path: '~/app' })).json();
  assert.equal(added.root, repo);
  assert.equal(added.state.repos.length, 1);

  const bad = await post('repos', { path: 'relative' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'PATH_NOT_ABSOLUTE');

  const finished = await (await post('finish')).json();
  assert.equal(finished.state.onboarding.completed, true);
  assert.equal((await (await post('reset')).json()).onboarding.completed, false);

  assert.equal((await post('nope')).status, 404);
  // Writes still need JSON, like every other API route.
  assert.equal((await fetch(`${url}/finish`, { method: 'POST', body: 'x' })).status, 415);
});

test('a per-repo server has no setup', async (t) => {
  const { base } = await emptyMachine(t);
  const server = createKloseServer({ cwd: base });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/setup`)).status, 404);
});

test('klose setup installs the skills, starts the hub and points at /welcome', async (t) => {
  const { base, options } = await emptyMachine(t);
  const env = { ...process.env, HOME: options.userHome, KLOSE_HOME: options.home, CLAUDE_CONFIG_DIR: options.claudeDir };
  const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: base, encoding: 'utf-8', timeout: 30000, env });
  t.after(() => run('hub', 'stop'));

  const result = run('setup', '--no-open', '--no-tray', '--port=0');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Claude Code {2}not found/);
  assert.match(result.stdout, /✓ Skills {7}\/klose/);
  assert.match(result.stdout, /✓ Hub {10}running at http:\/\/localhost:\d+/);
  assert.match(result.stdout, /http:\/\/localhost:\d+\/welcome/);
  assert.ok(existsSync(path.join(options.userHome, '.claude', 'skills', 'klose', 'SKILL.md')));

  const hub = JSON.parse(await readFile(path.join(options.home, 'hub.json'), 'utf-8'));
  const state = await (await fetch(`http://127.0.0.1:${hub.port}/api/setup`)).json();
  assert.equal(state.skills.installed, true);

  // Again: nothing to do, and it says so.
  const again = run('setup', '--no-open', '--no-tray');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already up to date/);
  assert.match(again.stdout, /Hub {10}already running/);
});
