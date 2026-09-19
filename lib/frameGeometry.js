/**
 * Geometry for moving and resizing sketch frames on the canvas.
 *
 * Kept as a dependency-free module (rather than inline in the canvas
 * component) because this is the part of the interaction that is easy to get
 * subtly wrong — a clamped edge dragging its opposite edge along with it, a
 * frame escaping the canvas, a snap applied to a delta instead of to a
 * position — and easy to test once it is pure.
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Frame
 * @typedef {'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'} Handle
 * @typedef {Object} FrameLimits
 * @property {number} canvasWidth
 * @property {number} canvasHeight
 * @property {number} minWidth
 * @property {number} minHeight
 * @property {number} grid
 */

/** @returns {number} */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Snaps a *position* (never a delta) to the grid, so a frame lands on grid
 * lines regardless of where the gesture started.
 *
 * @param {number} value
 * @param {number} grid
 * @param {boolean} enabled
 * @returns {number}
 */
export function snapTo(value, grid, enabled) {
  if (!enabled || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/**
 * Where a frame ends up after being dragged by (dx, dy) in canvas units.
 *
 * @param {Frame} frame Frame as it was when the gesture started.
 * @param {{ dx: number, dy: number, snap: boolean, limits: FrameLimits }} gesture
 * @returns {{ x: number, y: number }}
 */
export function moveFrame(frame, { dx, dy, snap, limits }) {
  return {
    x: clamp(snapTo(frame.x + dx, limits.grid, snap), 0, Math.max(0, limits.canvasWidth - frame.width)),
    y: clamp(snapTo(frame.y + dy, limits.grid, snap), 0, Math.max(0, limits.canvasHeight - frame.height)),
  };
}

/**
 * Where a frame ends up after one of its handles is dragged by (dx, dy).
 *
 * Works on edges rather than on width/height deltas: an edge the handle does
 * not touch never moves, and the dragged edge is always derived from the frame
 * the gesture *started* with, so hitting the minimum size or the canvas border
 * cannot drift the opposite edge.
 *
 * @param {Frame} frame Frame as it was when the gesture started.
 * @param {{ handle: Handle, dx: number, dy: number, snap: boolean, keepRatio?: boolean, limits: FrameLimits }} gesture
 * @returns {Frame}
 */
export function resizeFrame(frame, { handle, dx, dy, snap, keepRatio = false, limits }) {
  const { minWidth, minHeight, canvasWidth, canvasHeight, grid } = limits;

  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;

  if (handle.includes('e')) right = clamp(snapTo(right + dx, grid, snap), left + minWidth, canvasWidth);
  if (handle.includes('w')) left = clamp(snapTo(left + dx, grid, snap), 0, right - minWidth);
  if (handle.includes('s')) bottom = clamp(snapTo(bottom + dy, grid, snap), top + minHeight, canvasHeight);
  if (handle.includes('n')) top = clamp(snapTo(top + dy, grid, snap), 0, bottom - minHeight);

  // A corner drag with the ratio locked: shrink the axis that has run ahead, so
  // the result always stays inside what the pointer asked for.
  if (keepRatio && handle.length === 2 && frame.width > 0 && frame.height > 0) {
    const ratio = frame.width / frame.height;
    let width = right - left;
    let height = bottom - top;
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
    width = clamp(width, minWidth, canvasWidth);
    height = clamp(height, minHeight, canvasHeight);

    if (handle.includes('w')) left = clamp(right - width, 0, right - minWidth);
    else right = clamp(left + width, left + minWidth, canvasWidth);
    if (handle.includes('n')) top = clamp(bottom - height, 0, bottom - minHeight);
    else bottom = clamp(top + height, top + minHeight, canvasHeight);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
