import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackText, describeElement, timeAgo } from '../lib/feedback.js';

const button = { tagName: 'button', text: 'Subscribe', classes: 'rounded-xl', path: 'div > button' };

test('one sketch reads as a numbered list, with element details under the comment', () => {
  const text = buildFeedbackText({
    projectId: 'p1',
    projectName: 'Billing',
    nodes: [{ id: 'n1', name: 'Pricing card', comments: [
      { id: 'a', text: 'Make it full width', createdAt: 0, element: button },
      { id: 'b', text: 'Show the saving', createdAt: 0 },
    ] }],
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Feedback on the "Pricing card" sketch (project "Billing", id p1, node n1):');
  assert.equal(lines[2], '1. Make it full width');
  assert.equal(lines[3], '   ↳ targets element: <button>, text "Subscribe", path div > button, classes "rounded-xl"');
  assert.equal(lines[4], '2. Show the saving');
  assert.match(lines.at(-1), /npx klose project get/);
});

test('several sketches get a section each, and sketches without feedback are left out', () => {
  const text = buildFeedbackText({
    projectId: 'p1',
    projectName: 'Billing',
    nodes: [
      { id: 'n1', name: 'Pricing card', comments: [{ id: 'a', text: 'One', createdAt: 0 }] },
      { id: 'n2', name: 'Empty state', comments: [] },
      { id: 'n3', name: '', comments: [{ id: 'b', text: 'Two', createdAt: 0 }, { id: 'c', text: 'Three', createdAt: 0 }] },
    ],
  });
  assert.match(text, /^Feedback on 2 sketches \(project "Billing", id p1\):/);
  assert.match(text, /## "Pricing card" \(node n1\)\n1\. One/);
  assert.doesNotMatch(text, /Empty state/);
  // Numbers restart per sketch, matching the pins drawn on each preview.
  assert.match(text, /## "Untitled sketch" \(node n3\)\n1\. Two\n2\. Three/);
});

test('nothing to send still produces a message rather than an empty clipboard', () => {
  assert.match(buildFeedbackText({ projectId: 'p', projectName: 'X', nodes: [{ id: 'n', name: 'A', comments: [] }] }), /\(no comments left yet\)/);
  assert.match(buildFeedbackText({ projectId: 'p', projectName: 'X', nodes: [] }), /\(no comments left yet\)/);
});

test('element chips prefer visible text and fall back to the breadcrumb', () => {
  assert.equal(describeElement(button), '<button> "Subscribe"');
  assert.equal(describeElement({ ...button, text: '' }), '<button> div > button');
});

test('ages round down to the largest whole unit', () => {
  const now = 10 * 86400000;
  assert.equal(timeAgo(now - 30000, now), 'just now');
  assert.equal(timeAgo(now - 5 * 60000, now), '5m ago');
  assert.equal(timeAgo(now - 6 * 3600000, now), '6h ago');
  assert.equal(timeAgo(now - 3 * 86400000, now), '3d ago');
});
