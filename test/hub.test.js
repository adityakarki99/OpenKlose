import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';
import { createRepoIndex, listRepos, rememberRepo, repoId } from '../server/hub.js';
import { readLiveSessions, readRecentCwds } from '../server/sessions.js';
import * as store from '../server/store.js';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

// A machine in miniature: a fake ~/.claude, a fake ~/.klose, and a few repos.
//   live      has a session whose process is running (this test's own pid)
//   recent    only a transcript, no session
//   known     added by hand, never touched by an agent
//   gone      its session's process has exited
//   scratch   a session in a folder that isn't a repo
let base;
let hub; // { claudeDir, home }
let repos;

async function makeRepo(name) {
  const dir = path.join(base, name);
  await mkdir(path.join(dir, '.git'), { recursive: true });
  await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
  return dir;
}

async function writeSession(pid, fields) {
  await writeFile(
    path.join(hub.claudeDir, 'sessions', `${pid}.json`),
    JSON.stringify({ pid, sessionId: `session-${pid}`, updatedAt: Date.now(), ...fields }),
    'utf-8'
  );
}

before(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-hub-test-')));
  hub = { claudeDir: path.join(base, 'claude'), home: path.join(base, 'klose-home') };
  await mkdir(path.join(hub.claudeDir, 'sessions'), { recursive: true });

  repos = {
    live: await makeRepo('live'),
    recent: await makeRepo('recent'),
    known: await makeRepo('known'),
    gone: await makeRepo('gone'),
  };
  const scratch = path.join(base, 'scratch');
  await mkdir(scratch);
  await mkdir(path.join(repos.live, 'src'));

  const exited = spawnSync(process.execPath, ['-e', '']).pid;
  // Started in a subfolder: the hub should list the repo, not the subfolder.
  await writeSession(process.pid, { cwd: path.join(repos.live, 'src'), status: 'busy', name: 'Pricing page' });
  await writeSession(exited, { cwd: repos.gone, status: 'busy', name: 'Crashed' });
  await writeFile(path.join(hub.claudeDir, 'sessions', 'junk.json'), '{not json', 'utf-8');
  // A session outside any repo gets a pid of its own so it doesn't overwrite the live one.
  await writeFile(
    path.join(hub.claudeDir, 'sessions', 'scratch.json'),
    JSON.stringify({ pid: process.ppid, sessionId: 'scratch', cwd: scratch, status: 'idle' }),
    'utf-8'
  );

  const transcripts = path.join(hub.claudeDir, 'projects', '-somewhere-recent');
  await mkdir(transcripts, { recursive: true });
  await writeFile(
    path.join(transcripts, 'abc.jsonl'),
    `{"type":"queue-operation"}\n${JSON.stringify({ type: 'user', cwd: repos.recent, gitBranch: 'main' })}\n`,
    'utf-8'
  );

  await rememberRepo(repos.known, hub.home);
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

test('live sessions: only running processes, busy means working', async () => {
  const sessions = await readLiveSessions(hub.claudeDir);
  const live = sessions.find((s) => s.pid === process.pid);
  assert.equal(live.status, 'working');
  assert.equal(live.name, 'Pricing page');
  assert.ok(!sessions.some((s) => s.name === 'Crashed'), 'a session whose process exited is not live');
  assert.deepEqual(await readLiveSessions(path.join(base, 'nope')), []);
});

test('recent folders come from the transcript, not its lossy folder name', async () => {
  const recent = await readRecentCwds(hub.claudeDir, { force: true });
  assert.deepEqual(recent.map((r) => r.cwd), [repos.recent]);
});

test('listRepos merges live, recent and known repos — and writes nothing into them', async () => {
  const list = await listRepos(hub);
  assert.deepEqual(new Set(list.map((r) => r.name)), new Set(['live', 'recent', 'known']));

  const live = list[0];
  assert.equal(live.name, 'live');
  assert.equal(live.root, repos.live);
  assert.equal(live.id, repoId(repos.live));
  assert.equal(live.agent, 'working');
  assert.deepEqual(live.session, { name: 'Pricing page', status: 'working' });
  assert.equal(live.branch, 'main');
  assert.equal(live.hasKlose, false);
  assert.equal(list.find((r) => r.name === 'recent').agent, null);

  for (const dir of Object.values(repos)) {
    assert.ok(!existsSync(path.join(dir, '.klose')), `listing must not create .klose in ${dir}`);
  }
});

test('a stale worktree is hidden until it has an agent or sketches', async () => {
  const tree = path.join(base, 'tree');
  await mkdir(tree);
  await writeFile(path.join(tree, '.git'), `gitdir: ${path.join(repos.known, '.git')}\n`, 'utf-8');
  await rememberRepo(tree, hub.home);

  assert.ok(!(await listRepos(hub)).some((r) => r.name === 'tree'));
  // Still addressable: a link to it keeps working.
  assert.equal(await createRepoIndex(hub).resolve(repoId(tree)), tree);

  const project = await store.createProject(tree, 'In a worktree');
  const listed = (await listRepos(hub)).find((r) => r.name === 'tree');
  assert.equal(listed.worktree, true);
  assert.equal(listed.branch, 'main');
  assert.equal(listed.files, 1);
  await store.deleteProject(tree, project.id);
});

// ------------------------------------------------------------------- HTTP

let server;
let baseUrl;

async function request(method, url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('hub server: one API, every repo', async (t) => {
  server = createKloseServer({ hub, version: '9.9.9' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const health = await request('GET', '/api/health');
  assert.deepEqual(health.body, { ok: true, root: null, version: '9.9.9', pid: process.pid, hub: true });

  const list = await request('GET', '/api/repos');
  assert.equal(list.body.repos[0].name, 'live');
  const liveId = repoId(repos.live);
  const recentId = repoId(repos.recent);

  // Without a repo there is nothing to act on.
  const bare = await request('GET', '/api/projects');
  assert.equal(bare.status, 400);
  assert.equal(bare.body.code, 'REPO_REQUIRED');

  // An id the hub never discovered can't be used to reach a folder.
  const unknown = await request('GET', `/api/repos/${repoId(path.join(base, 'scratch'))}/projects`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'REPO_NOT_FOUND');

  // Reading a repo leaves it untouched; sketching in it creates its .klose/.
  assert.deepEqual((await request('GET', `/api/repos/${recentId}/projects`)).body, []);
  assert.ok(!existsSync(path.join(repos.recent, '.klose')));

  const created = await request('POST', `/api/repos/${liveId}/projects`, { name: 'Billing' });
  assert.equal(created.status, 201);
  assert.ok(existsSync(path.join(repos.live, '.klose', 'projects', `${created.body.id}.json`)));
  assert.ok(!existsSync(path.join(repos.recent, '.klose')), 'a write to one repo must not touch another');

  await request('POST', `/api/repos/${liveId}/projects/${created.body.id}/nodes`, {
    name: 'Card',
    code: 'export default () => null',
    comments: [{ id: 'c1', text: 'Tighter', createdAt: 1 }],
  });
  const one = await request('GET', `/api/repos/${liveId}`);
  assert.equal(one.body.files, 1);
  assert.equal(one.body.sketches, 1);
  assert.equal(one.body.comments, 1);
  assert.equal(one.body.hasKlose, true);

  // Saving to the repo lands in that repo.
  const saved = await request('POST', `/api/repos/${liveId}/projects/${created.body.id}/export`, {});
  assert.equal(saved.body.dir, 'docs/klose/billing');
  assert.ok(existsSync(path.join(repos.live, 'docs', 'klose', 'billing', 'card.tsx')));

  const theme = await request('GET', `/api/repos/${liveId}/theme`);
  assert.equal(theme.status, 200);
});

test('a repo\'s canvas hears about its first sketch, written before .klose/ existed', async (t) => {
  const srv = createKloseServer({ hub });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { srv.closeAllConnections(); srv.close(resolve); }));
  const url = `http://127.0.0.1:${srv.address().port}/api/repos/${repoId(repos.known)}/events`;

  assert.ok(!existsSync(path.join(repos.known, '.klose')));
  const gotUpdate = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no update event within 6s')), 6000);
    http.get(url, (res) => {
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        if (chunk.includes('event: update')) {
          clearTimeout(timer);
          res.destroy();
          resolve();
        }
      });
    }).on('error', () => {});
  });
  await new Promise((r) => setTimeout(r, 200));
  // What the agent's CLI does: write straight to disk, not through the server.
  await store.createProject(repos.known, 'First sketch');
  await gotUpdate;
});

// -------------------------------------------------------------------- CLI

function klose(cwd, env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf-8', timeout: 20000, env: { ...process.env, ...env } });
}

test('klose hub: start, status, per-repo status and serve defer to it, stop', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-hub-cli-')));
  const env = { KLOSE_HOME: path.join(dir, 'home'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), HOME: path.join(dir, 'user') };
  const repo = path.join(dir, 'app');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(env.HOME, { recursive: true });
  try {
    const before = klose(repo, env, 'hub', 'status');
    assert.equal(before.status, 1);
    assert.match(before.stdout, /not running/);

    const started = klose(repo, env, 'hub', '--detach', '--port=0');
    assert.equal(started.status, 0, started.stderr);
    const url = started.stdout.match(/running at (http:\/\/localhost:\d+)/)[1];

    assert.match(klose(repo, env, 'hub').stdout, /already running/);

    const status = JSON.parse(klose(repo, env, 'hub', 'status', '--json').stdout);
    assert.equal(status.running, true);
    assert.equal(status.url, url);
    // Started from inside a repo, so that repo is listed without any agent.
    assert.deepEqual(status.repos.map((r) => r.name), ['app']);
    assert.equal(status.repos[0].url, `${url}/r/${repoId(repo)}/projects`);

    // In the repo: no server of its own, but the canvas is reachable.
    const repoStatus = klose(repo, env, 'status', '--json');
    assert.equal(repoStatus.status, 0);
    assert.deepEqual(JSON.parse(repoStatus.stdout), { running: true, hub: true, url: `${url}/r/${repoId(repo)}/projects`, root: repo });

    const serve = klose(repo, env, 'serve', '--detach');
    assert.equal(serve.status, 0, serve.stderr);
    assert.match(serve.stdout, /hub is running/);
    assert.ok(!existsSync(path.join(repo, '.klose', 'server.json')), 'serve must not start a second server');

    // Another repo joins the hub just by being asked about.
    const other = path.join(dir, 'site');
    await mkdir(path.join(other, '.git'), { recursive: true });
    assert.match(klose(other, env, 'hub', 'add').stdout, /Added .*site to the hub/);
    assert.equal(JSON.parse(klose(repo, env, 'hub', 'status', '--json').stdout).repos.length, 2);

    assert.match(klose(repo, env, 'hub', 'stop').stdout, /Stopped the Klose hub/);
    assert.equal(klose(repo, env, 'status').status, 1);
  } finally {
    klose(repo, env, 'hub', 'stop');
    await rm(dir, { recursive: true, force: true });
  }
});

test('klose init --global installs the skills for every repo and touches no repo', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-global-init-')));
  const env = { KLOSE_HOME: path.join(dir, 'home'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), HOME: path.join(dir, 'user') };
  const repo = path.join(dir, 'app');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(env.HOME, { recursive: true });
  try {
    const result = klose(repo, env, 'init', '--global');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installed for every repo/);
    assert.ok(existsSync(path.join(env.HOME, '.claude', 'skills', 'klose', 'SKILL.md')));
    assert.ok(!existsSync(path.join(repo, '.klose')));
    assert.ok(!existsSync(path.join(repo, '.claude')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
