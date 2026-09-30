/**
 * Viewport math for the canvas: zoom steps, zooming around a point, and
 * fitting frames into view. The canvas is a scrollable element whose content
 * is scaled by `zoom`, so a viewport is { zoom, scrollLeft, scrollTop } plus
 * the visible size in screen pixels.
 *
 * Kept dependency-free so it can be tested without a browser.
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ zoom: number, scrollLeft: number, scrollTop: number }} View
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;

/** Where the +/- buttons and ⌘+ / ⌘- stop. */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/** @param {number} zoom */
export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The next preset zoom in the given direction, so stepping from an odd zoom
 * (after a pinch or a fit) lands on a round number.
 * @param {number} zoom
 * @param {1 | -1} direction
 */
export function stepZoom(zoom, direction) {
  const eps = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - eps) ?? MIN_ZOOM;
}

/**
 * Changes zoom while keeping the canvas point under `anchor` (screen pixels,
 * relative to the viewport's top-left) where it is.
 * @param {View} view
 * @param {number} nextZoom
 * @param {{ x: number, y: number }} anchor
 * @returns {View}
 */
export function zoomAround(view, nextZoom, anchor) {
  const zoom = clampZoom(nextZoom);
  const canvasX = (view.scrollLeft + anchor.x) / view.zoom;
  const canvasY = (view.scrollTop + anchor.y) / view.zoom;
  return {
    zoom,
    scrollLeft: Math.max(0, canvasX * zoom - anchor.x),
    scrollTop: Math.max(0, canvasY * zoom - anchor.y),
  };
}

/**
 * The smallest rectangle containing every frame, or null for none.
 * @param {Rect[]} rects
 * @returns {Rect | null}
 */
export function boundsOf(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The view that shows `rect` whole and centred, with `padding` screen pixels
 * around it. Never zooms past 100%: fitting one small frame shouldn't blow it up.
 * @param {Rect} rect
 * @param {{ width: number, height: number }} viewport
 * @param {{ padding?: number, maxZoom?: number }} [options]
 * @returns {View}
 */
export function fitView(rect, viewport, { padding = 64, maxZoom = 1 } = {}) {
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, availW / Math.max(1, rect.width), availH / Math.max(1, rect.height)));
  const centerX = (rect.x + rect.width / 2) * zoom;
  const centerY = (rect.y + rect.height / 2) * zoom;
  return {
    zoom,
    scrollLeft: Math.max(0, centerX - viewport.width / 2),
    scrollTop: Math.max(0, centerY - viewport.height / 2),
  };
}

/**
 * Whether a key event came from somewhere the user is typing, so canvas
 * shortcuts (Delete, arrows, letters) must leave it alone. Duck-typed so it
 * works on any EventTarget-like object.
 * @param {any} target
 */
export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  if (tag === 'textarea' || tag === 'select' || tag === 'iframe') return true;
  if (tag === 'input') {
    const type = String(target.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(type);
  }
  return false;
}
