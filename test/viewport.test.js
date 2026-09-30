import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, clampZoom, fitView, isEditableTarget, stepZoom, zoomAround, MAX_ZOOM, MIN_ZOOM } from '../lib/viewport.js';

test('zoom is clamped to the supported range', () => {
  assert.equal(clampZoom(10), MAX_ZOOM);
  assert.equal(clampZoom(0), MIN_ZOOM);
  assert.equal(clampZoom(0.8), 0.8);
});

test('stepping from an odd zoom lands on the next preset', () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(0.8, 1), 1);
  assert.equal(stepZoom(0.8, -1), 0.75);
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM);
});

test('zooming around a point keeps that canvas point under it', () => {
  const view = { zoom: 1, scrollLeft: 100, scrollTop: 50 };
  const anchor = { x: 200, y: 100 };
  const next = zoomAround(view, 2, anchor);
  assert.equal(next.zoom, 2);
  // Canvas point (300, 150) was under the anchor; at 2x it sits at 600, 300.
  assert.equal(next.scrollLeft, 600 - 200);
  assert.equal(next.scrollTop, 300 - 100);
});

test('bounds cover every frame, and there are none for an empty canvas', () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(
    boundsOf([{ x: 100, y: 100, width: 200, height: 100 }, { x: 400, y: 50, width: 100, height: 400 }]),
    { x: 100, y: 50, width: 400, height: 400 },
  );
});

test('fit centres the rect and never zooms past 100%', () => {
  const small = fitView({ x: 1000, y: 1000, width: 200, height: 100 }, { width: 1000, height: 800 });
  assert.equal(small.zoom, 1);
  assert.equal(small.scrollLeft, 1100 - 500);
  assert.equal(small.scrollTop, 1050 - 400);

  const big = fitView({ x: 0, y: 0, width: 4000, height: 1000 }, { width: 1000, height: 800 }, { padding: 0 });
  assert.equal(big.zoom, 0.25);
});

test('typing targets are recognised so shortcuts leave them alone', () => {
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditableTarget({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'IFRAME' }), true);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget(null), false);
});
