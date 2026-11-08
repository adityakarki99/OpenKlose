/**
 * Describing and finding elements inside a preview, shared by the sandbox
 * (preview-runtime.tsx) and the bridge a live page loads (preview/bridge.ts),
 * so a comment made in one is pinned the same way as in the other.
 *
 * Both run in a DOM; `root` is the element a locator is measured from (the
 * sandbox's #root, or the live page's <body>).
 */
import { locatorFor, pickBestCandidate, resolveLocator } from './pins.js';

/**
 * A short ancestor breadcrumb of tag names, e.g. "div > div > button".
 *
 * @param {Element} element
 * @param {Element} root
 * @returns {string}
 */
export function describePath(element, root) {
  const parts = [];
  let current = element;
  while (current?.tagName && current !== root && parts.length < 5) {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(' > ');
}

/**
 * What a comment stores about the element it points at (`SelectedElementInfo`).
 *
 * @param {HTMLElement} element
 * @param {Element} root
 */
export function elementInfo(element, root) {
  return {
    tagName: (element.tagName || '').toLowerCase(),
    text: (element.innerText || element.textContent || '').trim().slice(0, 100),
    classes: (typeof element.className === 'string' ? element.className : '').trim().slice(0, 200),
    path: describePath(element, root),
    locator: locatorFor(element, root),
  };
}

/**
 * The element a saved `SelectedElementInfo` points at, or null when it is gone.
 *
 * @param {Element} root
 * @param {ReturnType<typeof elementInfo>} info
 * @returns {Element | null}
 */
export function findElement(root, info) {
  const byLocator = /** @type {Element | null} */ (resolveLocator(root, info.locator || ''));
  if (byLocator && byLocator.tagName.toLowerCase() === info.tagName) return byLocator;
  if (!info.tagName || !/^[a-z][a-z0-9-]*$/.test(info.tagName)) return null;
  const elements = /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(info.tagName)));
  const index = pickBestCandidate(
    elements.map((el) => elementInfo(el, root)),
    info
  );
  return index >= 0 ? elements[index] : null;
}

/**
 * Where each commented element is, in the frame's own pixels (`PinPosition[]`).
 *
 * @param {Element} root
 * @param {Array<{ id: string, element: ReturnType<typeof elementInfo> }>} targets
 */
export function measurePins(root, targets) {
  return targets.map(({ id, element }) => {
    const el = findElement(root, element);
    if (!el) return { id, found: false };
    const rect = el.getBoundingClientRect();
    return { id, found: true, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}
