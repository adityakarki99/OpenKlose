import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { displayUrl, probe } from './instance.js';
import { resolveRoot } from './root.js';
import { claudeHome, readLiveSessions, readRecentCwds } from './sessions.js';
import { listProjects } from './store.js';

/**
 * The hub: one Klose server for every repo on the machine, instead of one per
 * repo. It knows which repos exist from three places —
 *
 *   live      a coding agent has a session open there (server/sessions.js)
 *   recent    an agent was used there in the last couple of weeks
 *   known     the user pointed Klose at it (`klose hub add`, or running
 *             `klose status` / `klose serve` there while the hub is up)
 *
 * — and serves each one's `.klose/` through the same API a per-repo server
 * uses, under `/api/repos/<id>/…`. Sketches stay in the repo they belong to;
 * the hub keeps only its own bookkeeping, in `~/.klose/`.
 *
 * A repo is only ever addressed by id, and an id only resolves to a root that
 * came from one of those three sources, so a request can't point the hub at
 * an arbitrary folder.
 */

export function kloseHome() {
  return process.env.KLOSE_HOME || path.join(os.homedir(), '.klose');
}

export function defaultHubOptions() {
  return { claudeDir: claudeHome(), home: kloseHome() };
}

/** Short, stable, URL-safe id for a repo root. */
export function repoId(root) {
  return createHash('sha1').update(root).digest('hex').slice(0, 12);
}

// ------------------------------------------------------------ known repos

function knownPath(home) {
  return path.join(home, 'repos.json');
}

export async function readKnownRepos(home = kloseHome()) {
  try {
    const parsed = JSON.parse(await readFile(knownPath(home), 'utf-8'));
    return (Array.isArray(parsed.repos) ? parsed.repos : []).filter((r) => r && typeof r.root === 'string');
  } catch {
    return [];
  }
}

/** Adds `root` to the hub's list (a no-op if it's there). Returns whether it was added. */
export async function rememberRepo(root, home = kloseHome()) {
  const repos = await readKnownRepos(home);
  if (repos.some((r) => r.root === root)) return false;
  repos.push({ root, addedAt: new Date().toISOString() });
  await mkdir(home, { recursive: true });
  await writeFile(knownPath(home), JSON.stringify({ repos }, null, 2) + '\n', 'utf-8');
  return true;
}

// -------------------------------------------------------------- discovery

/**
 * The repo a session's cwd belongs to, or null when it isn't in one. A session
 * started in the home directory or a scratch folder has no repo to sketch for.
 */
function repoRootFor(cwd) {
  if (!existsSync(cwd)) return null;
  const root = resolveRoot(cwd);
  if (root === os.homedir()) return null;
  if (!existsSync(path.join(root, '.git')) && !existsSync(path.join(root, '.klose'))) return null;
  return root;
}

/** Every repo the hub may serve: Map of root -> { sessions, lastActive }. */
async function candidates({ claudeDir, home }) {
  const [sessions, recent, known] = await Promise.all([
    readLiveSessions(claudeDir),
    readRecentCwds(claudeDir),
    readKnownRepos(home),
  ]);
  const byRoot = new Map();
  const entry = (root) => {
    if (!byRoot.has(root)) byRoot.set(root, { sessions: [], lastActive: 0 });
    return byRoot.get(root);
  };
  for (const s of sessions) {
    const root = repoRootFor(s.cwd);
    if (!root) continue;
    const e = entry(root);
    e.sessions.push(s);
    e.lastActive = Math.max(e.lastActive, s.updatedAt);
  }
  for (const r of recent) {
    const root = repoRootFor(r.cwd);
    if (root) entry(root).lastActive = Math.max(entry(root).lastActive, r.at);
  }
  for (const k of known) {
    // Added on purpose, so it needn't be a git repo — but it must still exist.
    if (!existsSync(k.root) || k.root === os.homedir()) continue;
    entry(k.root).lastActive = Math.max(entry(k.root).lastActive, Date.parse(k.addedAt) || 0);
  }
  return byRoot;
}

function branchOf(root) {
  try {
    let gitDir = path.join(root, '.git');
    // In a worktree `.git` is a file pointing at the real git dir.
    const pointer = readFileSync(gitDir, { encoding: 'utf-8', flag: 'r' });
    const m = pointer.match(/^gitdir:\s*(.+)$/m);
    if (m) gitDir = path.resolve(root, m[1].trim());
    return headBranch(gitDir);
  } catch (err) {
    return err.code === 'EISDIR' ? headBranch(path.join(root, '.git')) : null;
  }
}

function headBranch(gitDir) {
  try {
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf-8');
    const m = head.match(/ref:\s*refs\/heads\/(.+)/);
    return m ? m[1].trim() : head.trim().slice(0, 12);
  } catch {
    return null;
  }
}

/** A linked git worktree has a `.git` file rather than a `.git` directory. */
function isWorktree(root) {
  try {
    return statSync(path.join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

function tildePath(root) {
  const home = os.homedir();
  return root === home || root.startsWith(home + path.sep) ? `~${root.slice(home.length)}` : root;
}

async function describe(root, { sessions, lastActive }) {
  let projects = [];
  try {
    projects = await listProjects(root);
  } catch {
    // An unreadable .klose/ shouldn't hide the repo.
  }
  const nodes = projects.flatMap((p) => p.nodes || []);
  const working = sessions.find((s) => s.status === 'working');
  const lead = working || sessions[0] || null;
  return {
    id: repoId(root),
    root,
    path: tildePath(root),
    name: path.basename(root),
    branch: branchOf(root),
    worktree: isWorktree(root),
    agent: working ? 'working' : sessions.length ? 'idle' : null,
    session: lead ? { name: lead.name, status: lead.status } : null,
    sessions: sessions.length,
    lastActive,
    hasKlose: existsSync(path.join(root, '.klose', 'projects')),
    files: projects.length,
    sketches: nodes.length,
    comments: nodes.reduce((sum, n) => sum + (n.comments?.length || 0), 0),
  };
}

const AGENT_ORDER = { working: 0, idle: 1 };

/** Every repo the hub serves, agents first (working, then idle), then most recently used. */
export async function listRepos(options = defaultHubOptions()) {
  const byRoot = await candidates(options);
  const repos = await Promise.all([...byRoot].map(([root, info]) => describe(root, info)));
  // Agents leave worktrees behind; one with no agent in it and nothing
  // sketched is just a stale copy of a repo that is already listed.
  return repos.filter((r) => !r.worktree || r.agent || r.files > 0).sort(
    (a, b) => (AGENT_ORDER[a.agent] ?? 2) - (AGENT_ORDER[b.agent] ?? 2) || b.lastActive - a.lastActive || a.name.localeCompare(b.name)
  );
}

/**
 * The whole machine in one glance — what the menu bar icon and its popover
 * show. `state` picks the icon's dot:
 *
 *   feedback  comments are waiting in a repo where no agent is busy: someone
 *             needs to hand them over
 *   working   an agent is busy somewhere (and nothing is waiting unattended)
 *   idle      agents are open but none is busy
 *   none      no agents at all
 */
export function trayState(repos) {
  const live = repos.filter((r) => r.agent);
  const working = live.filter((r) => r.agent === 'working').length;
  const comments = repos.reduce((sum, r) => sum + r.comments, 0);
  const unattended = repos.some((r) => r.comments > 0 && r.agent !== 'working');
  const state = unattended ? 'feedback' : working ? 'working' : live.length ? 'idle' : 'none';
  return { state, agents: live.length, working, comments, repos };
}

/**
 * Turns repo ids from requests back into roots. Lookups are cached; a miss
 * re-runs discovery once, so a repo that appeared since the last look is found.
 */
export function createRepoIndex(options = defaultHubOptions()) {
  const roots = new Map(); // id -> root
  const refresh = async () => {
    roots.clear();
    for (const root of (await candidates(options)).keys()) roots.set(repoId(root), root);
  };
  return {
    async resolve(id) {
      if (!roots.has(id)) await refresh();
      const root = roots.get(id);
      if (root && !existsSync(root)) {
        roots.delete(id);
        return null;
      }
      return root || null;
    },
    async describe(id) {
      const root = await this.resolve(id);
      if (!root) return null;
      const info = (await candidates(options)).get(root) || { sessions: [], lastActive: 0 };
      return describe(root, info);
    },
  };
}

// ------------------------------------------------------- is the hub running?

function hubInfoPath(home) {
  return path.join(home, 'hub.json');
}

export async function readHubInfo(home = kloseHome()) {
  try {
    return JSON.parse(await readFile(hubInfoPath(home), 'utf-8'));
  } catch {
    return null;
  }
}

export async function writeHubInfo(info, home = kloseHome()) {
  await mkdir(home, { recursive: true });
  await writeFile(hubInfoPath(home), JSON.stringify(info, null, 2) + '\n', 'utf-8');
}

/** Removes hub.json, but only if it still describes process `pid`. Sync: runs in an exit handler. */
export function removeHubInfoSync(pid, home = kloseHome()) {
  try {
    const info = JSON.parse(readFileSync(hubInfoPath(home), 'utf-8'));
    if (info.pid === pid) unlinkSync(hubInfoPath(home));
  } catch {
    // Already gone, or never written.
  }
}

export async function removeHubInfo(home = kloseHome()) {
  try {
    await unlink(hubInfoPath(home));
  } catch {
    // Already gone.
  }
}

/**
 * Looks for a running hub. Like a repo's server.json, hub.json alone isn't
 * trusted — the port it names must answer as a hub, from the recorded pid.
 * Resolves to { state: 'running', port, url, pid, version } or { state: 'stopped' }.
 */
export async function findHub(home = kloseHome()) {
  const info = await readHubInfo(home);
  if (!info || !Number.isInteger(info.port)) return { state: 'stopped' };
  const health = await probe(info.port);
  if (!health || !health.hub || health.pid !== info.pid) return { state: 'stopped' };
  return { state: 'running', port: info.port, url: displayUrl(info.port), pid: health.pid, version: health.version };
}

/** Where a repo's canvas lives on a hub. */
export function repoUrl(hubUrl, root) {
  return `${hubUrl}/r/${repoId(root)}/projects`;
}
