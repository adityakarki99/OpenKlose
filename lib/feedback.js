/**
 * Text helpers for sketch feedback: how a comment's element is described, and
 * the block of text "Copy feedback for agent" puts on the clipboard.
 *
 * Kept dependency-free so the wording the agent reads can be tested without a
 * browser.
 *
 * @typedef {{ tagName: string, text: string, classes: string, path: string, locator?: string }} ElementInfo
 * @typedef {{ id: string, text: string, createdAt: number, element?: ElementInfo }} SketchComment
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

const CLOSING_LINE =
  'Please address this feedback — use `npx klose project get <id>` to read the current sketch, and `npx klose project update-node` to update it.';

/** @param {SketchComment[]} comments @param {string[]} lines */
function pushComments(comments, lines) {
  comments.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.text}`);
    if (c.element) lines.push(`   ↳ targets element: ${elementDetailLine(c.element)}`);
  });
}

/**
 * The clipboard text for one sketch, or for every sketch that has feedback.
 *
 * Comment numbers match the pins on the canvas: they count within a sketch,
 * so "2" in the text is the pin labelled 2 on that sketch's preview.
 *
 * @param {{ projectId: string, projectName: string, nodes: SketchNode[] }} input
 * @returns {string}
 */
export function buildFeedbackText({ projectId, projectName, nodes }) {
  const lines = [];
  const withFeedback = nodes.filter((n) => (n.comments || []).length > 0);

  if (nodes.length === 1) {
    const node = nodes[0];
    lines.push(`Feedback on the "${node.name || 'Untitled sketch'}" sketch (project "${projectName}", id ${projectId}, node ${node.id}):`);
    lines.push('');
    if (withFeedback.length === 0) lines.push('(no comments left yet)');
    else pushComments(node.comments || [], lines);
  } else {
    lines.push(`Feedback on ${withFeedback.length} sketch${withFeedback.length === 1 ? '' : 'es'} (project "${projectName}", id ${projectId}):`);
    if (withFeedback.length === 0) {
      lines.push('');
      lines.push('(no comments left yet)');
    }
    for (const node of withFeedback) {
      lines.push('');
      lines.push(`## "${node.name || 'Untitled sketch'}" (node ${node.id})`);
      pushComments(node.comments || [], lines);
    }
  }

  lines.push('');
  lines.push(CLOSING_LINE);
  return lines.join('\n');
}
