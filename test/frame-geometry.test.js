import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveFrame, resizeFrame, snapTo } from '../lib/frameGeometry.js';

const limits = { canvasWidth: 1000, canvasHeight: 800, minWidth: 200, minHeight: 120, grid: 20 };
const frame = { x: 100, y: 100, width: 400, height: 300 };

test('a drag snaps to the grid and keeps the whole frame on the canvas', () => {
  assert.deepEqual(moveFrame(frame, { dx: 33, dy: 7, snap: true, limits }), { x: 140, y: 100 });
  // Alt-style free movement keeps the exact position.
  assert.deepEqual(moveFrame(frame, { dx: 33, dy: 7, snap: false, limits }), { x: 133, y: 107 });
  // Far past either edge, the frame stops with its far side on the border.
  assert.deepEqual(moveFrame(frame, { dx: -9999, dy: -9999, snap: true, limits }), { x: 0, y: 0 });
  assert.deepEqual(moveFrame(frame, { dx: 9999, dy: 9999, snap: true, limits }), { x: 600, y: 500 });
});

test('dragging one edge never moves the others', () => {
  const east = resizeFrame(frame, { handle: 'e', dx: 60, dy: 40, snap: false, limits });
  assert.deepEqual(east, { x: 100, y: 100, width: 460, height: 300 });

  const north = resizeFrame(frame, { handle: 'n', dx: 60, dy: -40, snap: false, limits });
  assert.deepEqual(north, { x: 100, y: 60, width: 400, height: 340 });
});

test('a west/north drag past the minimum pins the dragged edge and leaves the opposite one alone', () => {
  const west = resizeFrame(frame, { handle: 'w', dx: 9999, dy: 0, snap: false, limits });
  // The right edge started at 500 and must still be there.
  assert.equal(west.x + west.width, 500);
  assert.equal(west.width, limits.minWidth);

  const north = resizeFrame(frame, { handle: 'n', dx: 0, dy: 9999, snap: false, limits });
  assert.equal(north.y + north.height, 400);
  assert.equal(north.height, limits.minHeight);
});

test('resizing stays inside the canvas', () => {
  const east = resizeFrame(frame, { handle: 'se', dx: 9999, dy: 9999, snap: false, limits });
  assert.equal(east.x + east.width, limits.canvasWidth);
  assert.equal(east.y + east.height, limits.canvasHeight);

  const west = resizeFrame(frame, { handle: 'nw', dx: -9999, dy: -9999, snap: false, limits });
  assert.equal(west.x, 0);
  assert.equal(west.y, 0);
});

test('a resize snaps edges to the grid, not the drag distance', () => {
  const offGrid = { x: 107, y: 103, width: 400, height: 300 };
  const snapped = resizeFrame(offGrid, { handle: 'se', dx: 11, dy: 11, snap: true, limits });
  assert.equal((snapped.x + snapped.width) % limits.grid, 0);
  assert.equal((snapped.y + snapped.height) % limits.grid, 0);
  // The untouched edges keep their original off-grid position.
  assert.equal(snapped.x, 107);
  assert.equal(snapped.y, 103);
});

test('a corner drag with the ratio locked keeps the starting aspect ratio', () => {
  const locked = resizeFrame(frame, { handle: 'se', dx: 400, dy: 20, snap: false, keepRatio: true, limits });
  assert.equal(Math.round((locked.width / locked.height) * 100), Math.round((frame.width / frame.height) * 100));
  // The anchored corner does not move.
  assert.equal(locked.x, frame.x);
  assert.equal(locked.y, frame.y);

  // Anchored from the other side, the bottom-right corner is what stays put.
  const fromNw = resizeFrame(frame, { handle: 'nw', dx: -120, dy: -20, snap: false, keepRatio: true, limits });
  assert.equal(fromNw.x + fromNw.width, frame.x + frame.width);
  assert.equal(fromNw.y + fromNw.height, frame.y + frame.height);
  assert.equal(Math.round((fromNw.width / fromNw.height) * 100), Math.round((frame.width / frame.height) * 100));
});

test('snapTo rounds positions and can be turned off', () => {
  assert.equal(snapTo(107, 20, true), 100);
  assert.equal(snapTo(113, 20, true), 120);
  assert.equal(snapTo(113, 20, false), 113);
  assert.equal(snapTo(113, 0, true), 113);
});
