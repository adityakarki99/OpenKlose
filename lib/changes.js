/**
 * What changed between the sketches on screen and a copy just read from disk,
 * when something other than this tab (usually the /klose agent) wrote it.
 *
 * Only changes an agent makes are reported (a new sketch; new preview code,
 * notes, description, name, status or built path; comments resolved). Moves
 * and resizes are left out: they are layout, not news.
 *
 * @typedef {{ id: string, name?: string, code?: string, notes?: string, description?: string, status?: string, builtFilePath?: string, comments?: { id: string, resolvedAt?: number }[] }} Node
 * @typedef {{ id: string, name: string, kind: 'added' | 'updated' | 'built', resolved: number }} NodeChange
 */

const WATCHED = /** @type {const} */ (['code', 'notes', 'description', 'name', 'status', 'builtFilePath']);

/** @param {Node} node */
const nameOf = (node) => node.name || 'Untitled sketch';

/**
 * @param {Node[]} before
 * @param {Node[]} after
 * @returns {NodeChange[]}
 */
export function diffSketches(before, after) {
  const prev = new Map(before.map((n) => [n.id, n]));
  /** @type {NodeChange[]} */
  const changes = [];
  for (const node of after) {
    const old = prev.get(node.id);
    if (!old) {
      changes.push({ id: node.id, name: nameOf(node), kind: 'added', resolved: 0 });
      continue;
    }
    const wasResolved = new Set((old.comments || []).filter((c) => c.resolvedAt).map((c) => c.id));
    const resolved = (node.comments || []).filter((c) => c.resolvedAt && !wasResolved.has(c.id)).length;
    const edited = WATCHED.some((key) => (old[key] ?? '') !== (node[key] ?? ''));
    if (!edited && !resolved) continue;
    const kind = node.status === 'built' && old.status !== 'built' ? 'built' : 'updated';
    changes.push({ id: node.id, name: nameOf(node), kind, resolved });
  }
  return changes;
}

/**
 * One line for the toast, e.g. `Agent updated "Pricing card" · resolved 2 comments`.
 * @param {NodeChange[]} changes
 * @returns {string}
 */
export function summarizeChanges(changes) {
  if (!changes.length) return '';
  const resolved = changes.reduce((sum, c) => sum + c.resolved, 0);
  const tail = resolved ? ` · resolved ${resolved} comment${resolved === 1 ? '' : 's'}` : '';
  if (changes.length === 1) {
    const [c] = changes;
    const verb = c.kind === 'added' ? 'added' : c.kind === 'built' ? 'built' : 'updated';
    return `Agent ${verb} "${c.name}"${tail}`;
  }
  return `Agent changed ${changes.length} sketches${tail}`;
}

/**
 * The badge a changed sketch wears for a few seconds.
 * @param {NodeChange} change
 */
export function changeBadge(change) {
  if (change.kind === 'added') return 'New from agent';
  if (change.kind === 'built') return 'Built by agent';
  return change.resolved ? `Agent resolved ${change.resolved}` : 'Updated by agent';
}
