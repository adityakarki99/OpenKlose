/**
 * A shared canvas: one project at a link, so a coding agent that runs
 * somewhere the user can't reach (a cloud session, a container) can still
 * show its sketches and read the comments left on them.
 *
 * The link carries everything: `<host>/canvas/#/s/<id>/<key>`. The id names
 * an encrypted blob on the share host; the key, in the URL fragment, never
 * reaches that host. Both ends (the CLI in lib of the agent, the hosted
 * canvas in the browser) encrypt before sending and decrypt after fetching,
 * so the host only ever stores ciphertext it cannot read, like excalidraw's
 * shareable links.
 *
 * Both ends keep the same three things: the last version they synced (the
 * blob's ETag and the project as it was then), their own copy of the project,
 * and this file's `syncShare`, which pulls, merges three ways and pushes
 * back. No Node or DOM imports: this bundles into the canvas as it is and
 * runs on Node 18 with `globalThis.crypto` from node:crypto.
 */
import { mergeSketches } from '../lib/merge.js';

export const SHARE_VERSION = 1;
export const SHARE_ALG = 'A256GCM';

/** Where shares go unless the CLI is told otherwise: the Klose site, which hosts the canvas and the share API. */
export const DEFAULT_SHARE_HOST = 'https://www.klosegrid.com';

/** The largest payload a share host accepts: plenty for a project's sketches, not a dumping ground. */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

const ID_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

// ------------------------------------------------------------- encoding

const webcrypto = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto is not available here (Node 18+ or a modern browser is needed).');
  return c;
};

export function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const randomBytes = (n) => webcrypto().getRandomValues(new Uint8Array(n));

/** A fresh share id: 128 random bits, URL-safe. Knowing it is what lets a browser read the blob. */
export const newShareId = () => toBase64Url(randomBytes(ID_BYTES));

/** A fresh content key, as it appears in the link. */
export const newShareKey = () => toBase64Url(randomBytes(KEY_BYTES));

export const isShareId = (id) => typeof id === 'string' && ID_RE.test(id);
export const isShareKey = (key) => typeof key === 'string' && KEY_RE.test(key);

// --------------------------------------------------------------- crypto

async function importKey(key) {
  if (!isShareKey(key)) throw new Error('Not a share key.');
  return webcrypto().subtle.importKey('raw', fromBase64Url(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** The encrypted form of `bundle` (any JSON value): what the share host stores. */
export async function encryptBundle(key, bundle) {
  const iv = randomBytes(IV_BYTES);
  const plain = new TextEncoder().encode(JSON.stringify(bundle));
  const data = await webcrypto().subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), plain);
  return { v: SHARE_VERSION, alg: SHARE_ALG, iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(data)) };
}

/** The bundle inside a payload. Rejects anything not encrypted with `key` (AES-GCM authenticates). */
export async function decryptBundle(key, payload) {
  if (!isPayload(payload)) throw new Error('Not a share payload.');
  let plain;
  try {
    plain = await webcrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(payload.iv) }, await importKey(key), fromBase64Url(payload.data));
  } catch {
    throw new Error('This link cannot open the share: the key does not match.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/** What a share host checks before storing: the shape, never the content. */
export function isPayload(payload) {
  return (
    !!payload &&
    typeof payload === 'object' &&
    payload.v === SHARE_VERSION &&
    payload.alg === SHARE_ALG &&
    typeof payload.iv === 'string' &&
    /^[A-Za-z0-9_-]{16}$/.test(payload.iv) &&
    typeof payload.data === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(payload.data) &&
    payload.data.length <= MAX_PAYLOAD_BYTES
  );
}

// ---------------------------------------------------------------- links

const trimHost = (host) => host.replace(/\/+$/, '');

export const shareApi = (host) => `${trimHost(host)}/api/share`;

/** The link the user opens: the hosted canvas on `host`, with the id and the key after the hash. */
export const shareUrl = (host, id, key) => `${trimHost(host)}/canvas/#/s/${id}/${key}`;

/** The id and key in a share link, or null for any other URL. */
export function parseShareUrl(url) {
  const m = /#\/s\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]{43})(?:[/?].*)?$/.exec(String(url || ''));
  if (!m) return null;
  const host = String(url).slice(0, String(url).indexOf('/canvas/#'));
  return { host, id: m[1], key: m[2] };
}

// --------------------------------------------------------------- bundle

/**
 * What travels: the project, and what the canvas needs to render it as the
 * repo would (the design tokens as CSS, which only the CLI can read, and the
 * repo's name for the navbar).
 */
export function makeBundle(project, { themeCss = '', repoName = '' } = {}) {
  return { v: SHARE_VERSION, project, theme: { css: themeCss }, repo: { name: repoName } };
}

export function isBundle(bundle) {
  return !!bundle && typeof bundle === 'object' && bundle.v === SHARE_VERSION && !!bundle.project && typeof bundle.project.id === 'string';
}

// ---------------------------------------------------------------- merge

const commentKey = (c) => c.id;

/**
 * Two versions of one sketch's comments, both since the base: keep every
 * comment either side has. The same comment on both sides takes the copy with
 * more history (resolved beats sent beats new), so an agent resolving a
 * comment and a user editing the same sketch don't undo each other.
 */
function unionComments(a = [], b = []) {
  const rank = (c) => (c.resolvedAt ? 3 : c.sentAt ? 2 : 1);
  const out = new Map();
  for (const c of [...a, ...b]) {
    const have = out.get(commentKey(c));
    if (!have || rank(c) > rank(have) || (rank(c) === rank(have) && JSON.stringify(c).length > JSON.stringify(have).length)) out.set(commentKey(c), c);
  }
  return [...out.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
}

/**
 * Three-way merge of a shared project: `base` is the version both sides last
 * agreed on, `local` this side's copy, `incoming` the other side's. Sketches
 * follow lib/merge.js (a sketch changed here keeps the local version, the
 * rest take the incoming one, deletions stick), except that comments on a
 * sketch both sides touched are kept from both: the agent rewriting a
 * sketch's code must never drop the comment the user just left on it.
 * Project fields take the incoming value unless edited locally since base.
 */
export function mergeShared({ base, local, incoming }) {
  const baseNodes = base?.nodes || [];
  const localNodes = local?.nodes || [];
  const incomingNodes = incoming?.nodes || [];
  const { nodes, kept } = mergeSketches({ base: baseNodes, local: localNodes, incoming: incomingNodes });
  const incomingById = new Map(incomingNodes.map((n) => [n.id, n]));
  const baseById = new Map(baseNodes.map((n) => [n.id, n]));
  const merged = nodes.map((node) => {
    if (!kept.includes(node.id)) return node;
    const theirs = incomingById.get(node.id);
    if (!theirs) return node;
    const before = baseById.get(node.id);
    const theirsChangedComments = JSON.stringify(theirs.comments || []) !== JSON.stringify(before?.comments || []);
    if (!theirsChangedComments) return node;
    return { ...node, comments: unionComments(node.comments, theirs.comments), updatedAt: Math.max(node.updatedAt || 0, theirs.updatedAt || 0) };
  });

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const pick = (key) => (same(local?.[key], base?.[key]) ? incoming?.[key] : local?.[key]);
  const out = { ...(incoming || {}), ...(local || {}) };
  for (const key of ['name', 'description', 'designSystemPrompt', 'projectContext']) {
    const value = pick(key);
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  out.nodes = merged;
  const stamps = [local?.updated_at, incoming?.updated_at].filter(Boolean).sort();
  if (stamps.length) out.updated_at = stamps[stamps.length - 1];
  return out;
}

// ----------------------------------------------------------------- sync

export class ShareError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ShareError';
    this.status = status;
  }
}

/**
 * The share host's API, over `fetch`:
 *   POST <api>          { payload }        → 201 { id, etag }
 *   GET  <api>/<id>     If-None-Match      → 200 { id, etag, payload } | 304 | 404
 *   PUT  <api>/<id>     If-Match { payload } → 200 { etag } | 412 { etag, payload } | 404
 * The host never sees a key: payloads are ciphertext.
 */
export function shareClient(api, { fetch = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const base = api.replace(/\/+$/, '');
  // A share host that hangs must not hang `klose feedback` with it.
  const signal = () => (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined);
  const json = async (res) => {
    try {
      return await res.json();
    } catch {
      return {};
    }
  };
  const failed = async (res, what) => {
    const body = await json(res);
    return new ShareError(body.error || `${what} failed (${res.status})`, res.status);
  };
  return {
    api: base,
    async create(payload) {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }), signal: signal() });
      if (!res.ok) throw await failed(res, 'Creating the share');
      const { id, etag } = await json(res);
      return { id, etag };
    },
    /** The current blob, or null when `etag` is still current (304). Throws 404 as a ShareError. */
    async fetch(id, { etag } = {}) {
      const res = await fetch(`${base}/${id}`, { headers: etag ? { 'If-None-Match': etag } : {}, signal: signal() });
      if (res.status === 304) return null;
      if (!res.ok) throw await failed(res, 'Reading the share');
      const body = await json(res);
      return { etag: body.etag, payload: body.payload };
    },
    /** Replaces the blob if it is still at `ifMatch`; on 412 the result carries the current version instead. */
    async put(id, payload, { ifMatch } = {}) {
      const res = await fetch(`${base}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
        body: JSON.stringify({ payload }),
        signal: signal(),
      });
      if (res.status === 412) {
        const body = await json(res);
        return { conflict: true, etag: body.etag, payload: body.payload };
      }
      if (!res.ok) throw await failed(res, 'Writing the share');
      const body = await json(res);
      return { conflict: false, etag: body.etag };
    },
  };
}

const sameProject = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One round of keeping a side in step with the share.
 *
 * `synced` is what this side last saw on the host (`{ etag, project }`, or
 * null the first time), `local` its own copy of the project now. The result
 * is the project both sides should now hold, the new `synced` to remember,
 * and whether anything came in (`pulled`) or went out (`pushed`). When the
 * host moved under a push, the merge is redone on the version it returned,
 * a few times.
 */
export async function syncShare({ client, id, key, synced, local, bundleExtras = {}, attempts = 4 }) {
  let etag = synced?.etag || null;
  let base = synced?.project || null;
  let project = local;

  const current = await client.fetch(id, { etag });
  let remote = null;
  if (current) {
    remote = await decryptBundle(key, current.payload);
    if (!isBundle(remote)) throw new ShareError('The share does not hold a Klose project.', 422);
    etag = current.etag;
  }

  // Nothing new on the host and nothing new here: no write.
  if (!remote && base && sameProject(project, base)) return { project, synced, pulled: false, pushed: false, bundle: null };

  let pulled = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (remote) {
      const merged = mergeShared({ base, local: project, incoming: remote.project });
      pulled = pulled || !sameProject(merged, project);
      const changedRemote = !sameProject(merged, remote.project);
      project = merged;
      base = remote.project;
      if (!changedRemote) return { project, synced: { etag, project: remote.project }, pulled, pushed: false, bundle: remote };
    }
    const bundle = makeBundle(project, { ...(remote ? { themeCss: remote.theme?.css, repoName: remote.repo?.name } : {}), ...bundleExtras });
    const result = await client.put(id, await encryptBundle(key, bundle), { ifMatch: etag || undefined });
    if (!result.conflict) return { project, synced: { etag: result.etag, project }, pulled, pushed: true, bundle };
    remote = await decryptBundle(key, result.payload);
    etag = result.etag;
  }
  throw new ShareError('The share keeps changing under this write; try again.', 409);
}
