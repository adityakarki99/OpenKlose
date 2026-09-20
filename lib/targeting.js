/**
 * Which sketch is accepting element picks right now, and why.
 *
 * Targeting used to be a mode you switched on from a button buried in the
 * inspector. It is now reachable two ways — a toggle on the frame itself, and
 * simply focusing the comment box — so the rule for "is this frame targetable"
 * is shared, and kept here where it can be tested.
 *
 * @typedef {Object} TargetingInput
 * @property {string|null} pinnedNodeId Node whose frame toggle is switched on.
 * @property {string|null} composerNodeId Node whose comment composer has focus.
 * @property {string|null} selectedNodeId Node currently selected on the canvas.
 */

/**
 * The node that should accept a pick, or null when nothing is targetable.
 *
 * The frame toggle wins: it is an explicit request, and it survives the
 * composer losing focus. Composer focus only targets the selected sketch —
 * the panel always describes that one, so attaching its comment to a different
 * sketch's preview would be a lie.
 *
 * @param {TargetingInput} input
 * @returns {string|null}
 */
export function targetedNodeId({ pinnedNodeId, composerNodeId, selectedNodeId }) {
  if (pinnedNodeId) return pinnedNodeId;
  if (composerNodeId && composerNodeId === selectedNodeId) return composerNodeId;
  return null;
}

/**
 * Why that node is targetable — the frame banner says something different for
 * a deliberate toggle than for "you are simply typing a comment".
 *
 * @param {TargetingInput} input
 * @returns {'pinned' | 'composer' | null}
 */
export function targetingReason({ pinnedNodeId, composerNodeId, selectedNodeId }) {
  if (pinnedNodeId) return 'pinned';
  if (composerNodeId && composerNodeId === selectedNodeId) return 'composer';
  return null;
}

/**
 * True when a blur handed focus to a sketch preview rather than away from the
 * canvas.
 *
 * Clicking inside the preview moves focus into its iframe, which blurs the
 * composer a moment before the sandbox reports the picked element. Without
 * this check that blur would switch targeting off and the click would land on
 * nothing.
 *
 * @param {{ tagName?: string, closest?: (selector: string) => unknown } | null} element
 * @returns {boolean}
 */
export function focusMovedIntoPreview(element) {
  if (!element || element.tagName !== 'IFRAME') return false;
  if (typeof element.closest !== 'function') return false;
  return !!element.closest('[data-node-id]');
}
