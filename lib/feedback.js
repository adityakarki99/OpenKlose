/**
 * Text helpers for sketch feedback: how a comment's element is described, and
 * the block of text "Copy feedback for agent" puts on the clipboard.
 *
 * Kept dependency-free so the wording the agent reads can be tested without a
 * browser.
 *
 * @typedef {{ tagName: string, text: string, classes: string, path: string, locator?: string }} ElementInfo
 * @typedef {{ id: string, text: string, createdAt: number, element?: ElementInfo, sentAt?: number, resolvedAt?: number, resolution?: string }} SketchComment
 * @typedef {{ id: string, name: string, comments?: SketchComment[] }} SketchNode
 */

/**
 * A short label for a comment's element, as shown on chips.
 * @param {ElementInfo} el
 * @returns {string}
 */
export function describeElement(el) {
  const label = el.text ? `"${el.text.slice(0, 40)}"` : el.path || el.tagName;
  return `<${el.tagName}> ${label}`;
}

/**
 * The full element description the agent gets.
 * @param {ElementInfo} el
 * @returns {string}
 */
export function elementDetailLine(el) {
  const bits = [`<${el.tagName}>`];
  if (el.text) bits.push(`text "${el.text}"`);
  if (el.path) bits.push(`path ${el.path}`);
  if (el.classes) bits.push(`classes "${el.classes}"`);
  return bits.join(', ');
}

/**
 * "6h ago" style age of a timestamp.
 * @param {number} ts
 * @param {number} [now]
 * @returns {string}
 */
export function timeAgo(ts, now = Date.now()) {
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Where a comment is in the loop with the agent:
 * 'new' = not handed to the agent yet, 'sent' = copied for the agent and
 * waiting on it, 'resolved' = the agent (or the user) marked it addressed.
 * @param {SketchComment} c
 * @returns {'new' | 'sent' | 'resolved'}
 */
export function commentStatus(c) {
  if (c.resolvedAt) return 'resolved';
  if (c.sentAt) return 'sent';
  return 'new';
}

/**
 * The comments still waiting on something (new or sent), in order. Pins, the
 * tray and the copied text all number comments by their place in this list.
 * @param {SketchComment[] | undefined} comments
 * @returns {SketchComment[]}
 */
export function openComments(comments) {
  return (comments || []).filter((c) => !c.resolvedAt);
}

/** @param {SketchComment[] | undefined} comments */
export function resolvedComments(comments) {
  return (comments || []).filter((c) => !!c.resolvedAt);
}

/**
 * How many open comments across these sketches the agent hasn't been given yet.
 * @param {SketchNode[]} nodes
 */
export function countNew(nodes) {
  return nodes.reduce((sum, n) => sum + openComments(n.comments).filter((c) => !c.sentAt).length, 0);
}

/** @param {SketchNode[]} nodes */
export function countOpen(nodes) {
  return nodes.reduce((sum, n) => sum + openComments(n.comments).length, 0);
}

/**
 * Stamps `sentAt` on the comments a copy just handed to the agent. Returns the
 * same node object when nothing on it changed, so callers can skip no-op saves.
 * @template {SketchNode} T
 * @param {T[]} nodes
 * @param {Set<string>} commentIds
 * @param {number} [now]
 * @returns {T[]}
 */
export function markSent(nodes, commentIds, now = Date.now()) {
  return nodes.map((n) => {
    if (!(n.comments || []).some((c) => commentIds.has(c.id) && !c.sentAt && !c.resolvedAt)) return n;
    return {
      ...n,
      comments: (n.comments || []).map((c) =>
        commentIds.has(c.id) && !c.sentAt && !c.resolvedAt ? { ...c, sentAt: now } : c
      ),
    };
  });
}

/**
 * Which comments a copy should carry. With any new comments it carries only
 * those (the agent already has the rest); with none, it re-sends everything
 * still open, so the button always does something useful.
 * @param {SketchNode[]} nodes
 * @returns {{ newOnly: boolean, ids: Set<string> }}
 */
export function commentsToSend(nodes) {
  const newOnly = countNew(nodes) > 0;
  const ids = new Set();
  for (const n of nodes) {
    for (const c of openComments(n.comments)) if (!newOnly || !c.sentAt) ids.add(c.id);
  }
  return { newOnly, ids };
}

const CLOSING_LINE =
  'Please address this feedback — use `npx klose project get <id>` to read the current sketch, `npx klose project update-node` to update it, and `npx klose resolve <projectId> <nodeId> <commentId...>` to mark each comment you addressed.';

/**
 * @param {SketchComment[]} comments every open comment on the sketch, for numbering
 * @param {(c: SketchComment) => boolean} include
 * @param {string[]} lines
 */
function pushComments(comments, include, lines) {
  comments.forEach((c, i) => {
    if (!include(c)) return;
    lines.push(`${i + 1}. ${c.text} [comment ${c.id}]`);
    if (c.element) lines.push(`   ↳ targets element: ${elementDetailLine(c.element)}`);
  });
}

/**
 * The clipboard text for one sketch, or for every sketch that has feedback.
 *
 * Comment numbers match the pins on the canvas: they count within a sketch,
 * so "2" in the text is the pin labelled 2 on that sketch's preview.
 *
 * Resolved comments are left out. `only`, when given, narrows the text to
 * those comment ids (a copy of just the new ones) while keeping each
 * comment's number, so it still matches its pin.
 *
 * @param {{ projectId: string, projectName: string, nodes: SketchNode[], only?: Set<string> }} input
 * @returns {string}
 */
export function buildFeedbackText({ projectId, projectName, nodes, only }) {
  const lines = [];
  // Resolved comments are done; they never go back to the agent.
  const include = (/** @type {SketchComment} */ c) => !c.resolvedAt && (!only || only.has(c.id));
  const withFeedback = nodes.filter((n) => openComments(n.comments).some(include));

  if (nodes.length === 1) {
    const node = nodes[0];
    lines.push(`Feedback on the "${node.name || 'Untitled sketch'}" sketch (project "${projectName}", id ${projectId}, node ${node.id}):`);
    lines.push('');
    if (withFeedback.length === 0) lines.push('(no comments left yet)');
    else pushComments(openComments(node.comments), include, lines);
  } else {
    lines.push(`Feedback on ${withFeedback.length} sketch${withFeedback.length === 1 ? '' : 'es'} (project "${projectName}", id ${projectId}):`);
    if (withFeedback.length === 0) {
      lines.push('');
      lines.push('(no comments left yet)');
    }
    for (const node of withFeedback) {
      lines.push('');
      lines.push(`## "${node.name || 'Untitled sketch'}" (node ${node.id})`);
      pushComments(openComments(node.comments), include, lines);
    }
  }

  lines.push('');
  lines.push(CLOSING_LINE);
  return lines.join('\n');
}
