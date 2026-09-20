import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusMovedIntoPreview, targetedNodeId, targetingReason } from '../lib/targeting.js';

const iframeIn = (matches) => ({ tagName: 'IFRAME', closest: () => (matches ? {} : null) });

test('the frame toggle targets its own sketch, selected or not', () => {
  const input = { pinnedNodeId: 'a', composerNodeId: null, selectedNodeId: 'b' };
  assert.equal(targetedNodeId(input), 'a');
  assert.equal(targetingReason(input), 'pinned');
});

test('focusing the composer targets the selected sketch, with no mode switch', () => {
  const input = { pinnedNodeId: null, composerNodeId: 'a', selectedNodeId: 'a' };
  assert.equal(targetedNodeId(input), 'a');
  assert.equal(targetingReason(input), 'composer');
});

test('a composer left focused on a sketch that is no longer selected targets nothing', () => {
  // The panel always describes the selected sketch, so a comment must never be
  // attached to a different sketch's preview.
  const input = { pinnedNodeId: null, composerNodeId: 'a', selectedNodeId: 'b' };
  assert.equal(targetedNodeId(input), null);
  assert.equal(targetingReason(input), null);
});

test('the frame toggle wins over composer focus', () => {
  const input = { pinnedNodeId: 'a', composerNodeId: 'b', selectedNodeId: 'b' };
  assert.equal(targetedNodeId(input), 'a');
  assert.equal(targetingReason(input), 'pinned');
});

test('nothing is targetable when neither is on', () => {
  const input = { pinnedNodeId: null, composerNodeId: null, selectedNodeId: 'a' };
  assert.equal(targetedNodeId(input), null);
  assert.equal(targetingReason(input), null);
});

test('a blur into a preview iframe keeps targeting alive, any other blur ends it', () => {
  assert.equal(focusMovedIntoPreview(iframeIn(true)), true);
  // An iframe outside a sketch frame, e.g. some other embed on the page.
  assert.equal(focusMovedIntoPreview(iframeIn(false)), false);
  assert.equal(focusMovedIntoPreview({ tagName: 'BUTTON', closest: () => ({}) }), false);
  assert.equal(focusMovedIntoPreview(null), false);
  // document.activeElement can be a bare <body> with no closest() in older DOMs.
  assert.equal(focusMovedIntoPreview({ tagName: 'IFRAME' }), false);
});
