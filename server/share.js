/**
 * The CLI's side of a shared canvas (see server/shareCore.js): which projects
 * are shared, kept in .klose/shares/<projectId>.json with the link's key and
 * the last synced version, and the sync itself over the disk store.
 *
 * The shares folder is per machine (.klose/.gitignore lists it): a link is a
 * capability, and a public repo must not publish one. `klose share` prints
 * the link; `klose share join <url>` attaches one on another checkout.
 */
import { webcrypto } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { loadTheme } from './theme.js';
import { KLOSE_GITIGNORE } from './storeCore.js';
import {
  DEFAULT_SHARE_HOST,
  ShareError,
  decryptBundle,
  encryptBundle,
  isBundle,
  isShareId,
  isShareKey,
  makeBundle,
  newShareKey,
  parseShareUrl,
  shareApi,
  shareClient,
  shareUrl,
  syncShare,
} from './shareCore.js';

// Node 18 has Web Crypto, but not on globalThis.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

export { DEFAULT_SHARE_HOST, ShareError, parseShareUrl, shareUrl };

const SHARES_DIR = ['.klose', 'shares'];

const sharesDir = (cwd) => path.join(cwd, ...SHARES_DIR);
const shareFile = (cwd, projectId) => path.join(sharesDir(cwd), `${projectId}.json`);

/** The share host the CLI talks to: --host, then KLOSE_SHARE_HOST, then the Klose site. */
export function shareHostFromEnv(env = process.env) {
  return (env.KLOSE_SHARE_HOST || DEFAULT_SHARE_HOST).replace(/\/+$/, '');
}

/** The share record for a project, or null when it isn't shared from this checkout. */
export async function readShare(cwd, projectId) {
  try {
    const record = JSON.parse(await readFile(shareFile(cwd, projectId), 'utf-8'));
    if (!isShareId(record.id) || !isShareKey(record.key) || typeof record.host !== 'string') return null;
    return record;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// The key is a capability: the shares folder must stay out of git, whether
// or not this repo ever ran `klose init`.
async function ensureGitignore(cwd) {
  const file = path.join(cwd, '.klose', '.gitignore');
  let lines = [];
  try {
    lines = (await readFile(file, 'utf-8')).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    // Not there yet.
  }
  const missing = KLOSE_GITIGNORE.filter((l) => !lines.includes(l));
  if (missing.length) await writeFile(file, [...lines, ...missing].join('\n') + '\n', 'utf-8');
}

async function writeShare(cwd, projectId, record) {
  await mkdir(sharesDir(cwd), { recursive: true });
  await ensureGitignore(cwd);
  await writeFile(shareFile(cwd, projectId), JSON.stringify(record, null, 2) + '\n');
}

/** Every shared project of this checkout, as `{ projectId, id, host, url, sharedAt, syncedAt }`. */
export async function listShares(cwd) {
  let names = [];
  try {
    names = await readdir(sharesDir(cwd));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const projectId = name.slice(0, -'.json'.length);
    const record = await readShare(cwd, projectId);
    if (record) out.push(describe(projectId, record));
  }
  return out.sort((a, b) => (a.sharedAt < b.sharedAt ? 1 : -1));
}

function describe(projectId, record) {
  return {
    projectId,
    id: record.id,
    host: record.host,
    url: shareUrl(record.host, record.id, record.key),
    sharedAt: record.sharedAt,
    syncedAt: record.synced?.at || null,
  };
}

async function extras(cwd) {
  let themeCss = '';
  try {
    themeCss = (await loadTheme(cwd)).css || '';
    if (!themeCss) themeCss = await readFile(path.join(cwd, '.klose', 'source-theme.css'), 'utf8').catch(() => '');
  } catch {
    // No tokens is fine: the canvas renders with stock Tailwind, as it would locally.
  }
  return { themeCss, repoName: path.basename(cwd) };
}

/**
 * Shares a project: a new id and key, the project (with the repo's design
 * tokens) encrypted and uploaded, the record written. Sharing an already
 * shared project just syncs it and returns the same link.
 */
export async function createShare(cwd, projectId, { host = shareHostFromEnv(), fetch, now = () => Date.now(), themeCss, repoName } = {}) {
  const existing = await readShare(cwd, projectId);
  if (existing) {
    try {
      const result = await syncProject(cwd, projectId, { fetch, now });
      return { ...describe(projectId, existing), created: false, ...result };
    } catch (error) {
      // Expired links cannot be revived. Retain the local project and issue
      // a new capability; transient outages must never create duplicate shares.
      if (!(error instanceof ShareError) || error.status !== 404) throw error;
    }
  }
  const project = await store.getProject(cwd, projectId);
  const key = newShareKey();
  const client = shareClient(shareApi(host), fetch ? { fetch } : {});
  const bundle = makeBundle(project, { ...await extras(cwd), ...(themeCss !== undefined ? { themeCss } : {}), ...(repoName ? { repoName } : {}) });
  const { id, etag } = await client.create(await encryptBundle(key, bundle));
  const record = { id, key, host, sharedAt: new Date(now()).toISOString(), synced: { etag, project, at: new Date(now()).toISOString() } };
  await writeShare(cwd, projectId, record);
  return { ...describe(projectId, record), created: true, pulled: false, pushed: true };
}

/**
 * Attaches a share link made elsewhere to this checkout: the project in the
 * share is written to .klose/projects/ (merged into it if it already exists)
 * and kept in sync from now on.
 */
export async function joinShare(cwd, url, { fetch, now = () => Date.now() } = {}) {
  const parsed = parseShareUrl(url);
  if (!parsed) throw new ShareError('Not a Klose share link (expected <host>/canvas/#/s/<id>/<key>).', 400);
  const { host, id, key } = parsed;
  const client = shareClient(shareApi(host), fetch ? { fetch } : {});
  const current = await client.fetch(id);
  const bundle = await decryptBundle(key, current.payload);
  if (!isBundle(bundle)) throw new ShareError('The share does not hold a Klose project.', 422);
  const projectId = bundle.project.id;
  const record = { id, key, host, sharedAt: new Date(now()).toISOString(), synced: null };
  await writeShare(cwd, projectId, record);
  const result = await syncProject(cwd, projectId, { fetch, now });
  return { ...describe(projectId, await readShare(cwd, projectId)), ...result };
}

/** Forgets the link on this checkout. The blob stays until the host expires it; the project stays on disk. */
export async function leaveShare(cwd, projectId) {
  try {
    await unlink(shareFile(cwd, projectId));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * One sync round for a shared project: what the user did on the shared canvas
 * comes into .klose/projects/, what the agent wrote goes out. Returns what
 * moved; throws when the project isn't shared.
 */
export async function syncProject(cwd, projectId, { fetch, now = () => Date.now() } = {}) {
  const record = await readShare(cwd, projectId);
  if (!record) throw new ShareError(`Project ${projectId} is not shared from this checkout.`, 404);
  let local = null;
  try {
    local = await store.getProject(cwd, projectId);
  } catch (err) {
    if (err.code !== 'PROJECT_NOT_FOUND') throw err;
  }
  const client = shareClient(shareApi(record.host), fetch ? { fetch } : {});
  const result = await syncShare({
    client,
    id: record.id,
    key: record.key,
    synced: record.synced,
    local: local || record.synced?.project || null,
    bundleExtras: await extras(cwd),
  });
  if (!local || result.pulled) await store.putProject(cwd, result.project);
  record.synced = { ...result.synced, at: new Date(now()).toISOString() };
  await writeShare(cwd, projectId, record);
  return { pulled: result.pulled, pushed: result.pushed, url: shareUrl(record.host, record.id, record.key) };
}

/**
 * Syncs every shared project. Best effort, for the commands that read or
 * write projects: a share host that can't be reached must not break
 * `klose feedback`. Returns what happened per project, errors included.
 */
export async function syncAll(cwd, { projectId, fetch } = {}) {
  const shares = (await listShares(cwd)).filter((s) => !projectId || s.projectId === projectId);
  const results = [];
  for (const share of shares) {
    try {
      results.push({ projectId: share.projectId, ...(await syncProject(cwd, share.projectId, { fetch })) });
    } catch (err) {
      results.push({ projectId: share.projectId, error: err.message, url: share.url });
    }
  }
  return results;
}
