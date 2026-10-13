/**
 * Merging a version of the sketches read from disk (usually written by the
 * agent) into what's on screen, without losing edits this tab hasn't saved yet.
 *
 * Three versions are involved:
 * - `base`: what this tab last knew to be on disk (its last load, save or merge);
 * - `local`: what's on screen now;
 * - `incoming`: what's on disk now.
 *
 * A sketch the user changed since `base` keeps the local version; every other
 * sketch takes the incoming one. Kept dependency-free so it can be tested
 * without a browser.
 *
 * @typedef {{ id: string }} Node
 */

/** @param {Node[]} nodes */
const byId = (nodes) => new Map(nodes.map((n) => [n.id, JSON.stringify(n)]));

/**
 * The ids of sketches the user added, changed or deleted since `base`.
 * @param {Node[]} base
 * @param {Node[]} local
 * @returns {Set<string>}
 */
export function locallyChanged(base, local) {
  const before = byId(base);
  const now = byId(local);
  const changed = new Set();
  for (const [id, json] of now) if (before.get(id) !== json) changed.add(id);
  for (const id of before.keys()) if (!now.has(id)) changed.add(id);
  return changed;
}

/**
 * @template {Node} T
 * @param {{ base: T[], local: T[], incoming: T[] }} versions
 * @returns {{ nodes: T[], kept: string[] }} the merged sketches, and the ids
 *   where the local version won over a different incoming one
 */
export function mergeSketches({ base, local, incoming }) {
  const changed = locallyChanged(base, local);
  const localById = new Map(local.map((n) => [n.id, n]));
  const baseIds = new Set(base.map((n) => n.id));
  const incomingIds = new Set(incoming.map((n) => n.id));
  const kept = [];
  const nodes = [];

  for (const node of incoming) {
    if (!changed.has(node.id)) {
      nodes.push(node);
      continue;
    }
    const mine = localById.get(node.id);
    // Deleted here since the last save: stays deleted.
    if (!mine) continue;
    if (JSON.stringify(mine) !== JSON.stringify(node)) kept.push(node.id);
    nodes.push(mine);
  }

  for (const node of local) {
    if (incomingIds.has(node.id)) continue;
    // Added here and not saved yet: keep it.
    if (!baseIds.has(node.id)) nodes.push(node);
    // Deleted on disk but edited here since: the edit wins.
    else if (changed.has(node.id)) {
      kept.push(node.id);
      nodes.push(node);
    }
  }

  return { nodes, kept };
}
