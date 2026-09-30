/**
 * Finding the element a comment points at, so its pin can be drawn on it.
 *
 * Comments made from now on carry a `locator` (an nth-child path from the
 * preview root), which pins the exact element. Older comments only have the
 * tag, a short tag breadcrumb, the classes and the visible text, so for those
 * the sandbox collects every element with the same tag and asks this module
 * which one matches best. Pure, so the matching rules can be tested without a
 * DOM.
 *
 * @typedef {{ tagName: string, text: string, classes: string, path: string, locator?: string }} ElementInfo
 * @typedef {{ path: string, text: string, classes: string }} Candidate
 */

/**
 * The nth-child path of an element below a root, e.g. "1>3>2".
 * Each step is a 1-based child index, so it survives class and text edits but
 * not reordering.
 *
 * @param {{ parentElement: any, children?: any }} element
 * @param {any} root
 * @returns {string}
 */
export function locatorFor(element, root) {
  const steps = [];
  let current = element;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return '';
    steps.unshift(Array.prototype.indexOf.call(parent.children, current) + 1);
    current = parent;
  }
  return current === root ? steps.join('>') : '';
}

/**
 * Walks a locator back down from the root. Returns null if any step is gone.
 *
 * @param {any} root
 * @param {string} locator
 * @returns {any}
 */
export function resolveLocator(root, locator) {
  if (!locator) return null;
  let current = root;
  for (const step of locator.split('>')) {
    const index = Number.parseInt(step, 10);
    if (!current || !Number.isInteger(index) || index < 1) return null;
    current = current.children[index - 1] || null;
  }
  return current;
}

/**
 * How well a candidate element matches the saved element info. Text and
 * classes are what the reviewer actually saw, so they count most.
 *
 * @param {Candidate} candidate
 * @param {ElementInfo} info
 * @returns {number}
 */
export function matchScore(candidate, info) {
  let score = 0;
  if (info.text && candidate.text === info.text) score += 3;
  else if (info.text && candidate.text && candidate.text.startsWith(info.text.slice(0, 20))) score += 1;
  if (info.classes && candidate.classes === info.classes) score += 3;
  if (info.path && candidate.path === info.path) score += 2;
  return score;
}

/**
 * Index of the best matching candidate, or -1 when nothing matches well enough
 * to put a pin on it. A pin on the wrong element is worse than no pin, so a
 * breadcrumb match alone is not enough.
 *
 * @param {Candidate[]} candidates
 * @param {ElementInfo} info
 * @returns {number}
 */
export function pickBestCandidate(candidates, info) {
  let best = -1;
  let bestScore = 2;
  candidates.forEach((candidate, i) => {
    const score = matchScore(candidate, info);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
