// Which sketch code this machine may hand to the repo's own bundler.
//
// A sketch drawn in the sandbox can do no harm: an opaque origin, no network.
// A sketch written into the repo and rendered through the dev server runs in
// the app's origin, with everything the app can reach. So Klose only writes a
// sketch into the repo ("materialises" it, server/harness.js) when its code
// was written on this machine: by the agent through the CLI, or on the local
// canvas. Code that arrived any other way (a shared canvas being synced, an
// online workspace, a project file pulled with git) stays in the sandbox until
// a person accepts it with `klose harness accept`.
//
// The record of what was written here is kept outside the repo, in
// ~/.klose/sketch-trust/<hash of the repo path>.json, because anything inside
// the repo (a field on the node, a file under .klose/) is something a peer
// could have put there.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HARNESS_CONFIG_FILE } from './harnessCore.js';

/** How many refused versions of one sketch are remembered. */
const MAX_FOREIGN = 20;

export const codeHash = (code) => createHash('sha256').update(String(code)).digest('hex').slice(0, 32);

// Same place as kloseHome() in server/hub.js, which this file can't import
// (the hub imports the store, and the store imports this).
const home = () => process.env.KLOSE_HOME || path.join(os.homedir(), '.klose');

/** Where this repo's record lives. */
export function trustFile(root) {
  let real = path.resolve(root);
  try {
    real = realpathSync(real);
  } catch {
    // Not there yet: the resolved path is as good a name as any.
  }
  return path.join(home(), 'sketch-trust', `${createHash('sha1').update(real).digest('hex').slice(0, 20)}.json`);
}

/** `{ nodes: { [nodeId]: { ok?: hash, foreign?: hash[] } } }` */
export async function readTrust(root) {
  try {
    const raw = JSON.parse(await readFile(trustFile(root), 'utf-8'));
    if (raw && typeof raw === 'object' && raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes)) return { nodes: raw.nodes };
  } catch {
    // Missing or unreadable: nothing is trusted.
  }
  return { nodes: {} };
}

async function writeTrust(root, trust) {
  const file = trustFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ version: 1, root: path.resolve(root), nodes: trust.nodes }, null, 2) + '\n');
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

const hasCode = (node) => !!node && typeof node.id === 'string' && typeof node.code === 'string' && !!node.code.trim();

/** True when `node`'s code, exactly as it is now, was written or accepted on this machine. */
export function isTrusted(trust, node) {
  return hasCode(node) && trust?.nodes?.[node.id]?.ok === codeHash(node.code);
}

// Nothing is recorded in a repo without a harness: no sketch is materialised
// there, and a record made later starts from the first local write after it.
const inUse = (root) => existsSync(path.join(root, HARNESS_CONFIG_FILE));

/**
 * A local write (the CLI, the local canvas) took a project's sketches from
 * `before` to `after`. Code that this write changed or added becomes trusted,
 * unless that exact code was seen arriving from elsewhere: a canvas tab can
 * hold a synced version in memory and save it back later, and that is still
 * not something written here.
 */
export async function noteLocalWrite(root, before, after) {
  if (!inUse(root)) return;
  const was = new Map((before || []).filter(Boolean).map((n) => [n.id, n]));
  const trust = await readTrust(root);
  let changed = false;
  for (const node of after || []) {
    if (!hasCode(node)) continue;
    const prev = was.get(node.id);
    if (prev && prev.code === node.code) continue;
    const hash = codeHash(node.code);
    const entry = trust.nodes[node.id] || {};
    if (entry.ok === hash || (entry.foreign || []).includes(hash)) continue;
    trust.nodes[node.id] = { ...entry, ok: hash };
    changed = true;
  }
  if (changed) await writeTrust(root, trust);
}

/**
 * A project arrived from somewhere else (share sync, an online workspace).
 * Code in it that isn't already trusted is remembered as foreign, so no later
 * local save of the same text can make it trusted by accident.
 */
export async function noteForeignWrite(root, nodes) {
  if (!inUse(root)) return;
  const trust = await readTrust(root);
  let changed = false;
  for (const node of nodes || []) {
    if (!hasCode(node)) continue;
    const hash = codeHash(node.code);
    const entry = trust.nodes[node.id] || {};
    if (entry.ok === hash || (entry.foreign || []).includes(hash)) continue;
    trust.nodes[node.id] = { ...entry, foreign: [...(entry.foreign || []), hash].slice(-MAX_FOREIGN) };
    changed = true;
  }
  if (changed) await writeTrust(root, trust);
}

/** A person said these sketches may run in the app, as they are now. Returns the ids accepted. */
export async function acceptSketches(root, nodes) {
  const trust = await readTrust(root);
  const accepted = [];
  for (const node of nodes || []) {
    if (!hasCode(node)) continue;
    const hash = codeHash(node.code);
    const entry = trust.nodes[node.id] || {};
    accepted.push(node.id);
    if (entry.ok === hash) continue;
    trust.nodes[node.id] = { ok: hash, foreign: (entry.foreign || []).filter((h) => h !== hash) };
  }
  if (accepted.length) await writeTrust(root, trust);
  return accepted;
}
