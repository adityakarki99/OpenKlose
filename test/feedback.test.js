import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackText, commentStatus, commentsToSend, countNew, describeElement, markSent, openComments, timeAgo } from '../lib/feedback.js';

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
  assert.equal(lines[2], '1. Make it full width [comment a]');
  assert.equal(lines[3], '   ↳ targets element: <button>, text "Subscribe", path div > button, classes "rounded-xl"');
  assert.equal(lines[4], '2. Show the saving [comment b]');
  assert.match(lines.at(-1), /npx klose project get/);
  assert.match(lines.at(-1), /npx klose resolve/);
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
  assert.match(text, /## "Pricing card" \(node n1\)\n1\. One \[comment a\]/);
  assert.doesNotMatch(text, /Empty state/);
  // Numbers restart per sketch, matching the pins drawn on each preview.
  assert.match(text, /## "Untitled sketch" \(node n3\)\n1\. Two \[comment b\]\n2\. Three \[comment c\]/);
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

test('a comment is new, then sent once copied, then resolved', () => {
  assert.equal(commentStatus({ id: 'a', text: '', createdAt: 0 }), 'new');
  assert.equal(commentStatus({ id: 'a', text: '', createdAt: 0, sentAt: 1 }), 'sent');
  assert.equal(commentStatus({ id: 'a', text: '', createdAt: 0, sentAt: 1, resolvedAt: 2 }), 'resolved');
});

const lifecycle = [
  { id: 'n1', name: 'Card', comments: [
    { id: 'done', text: 'Old', createdAt: 0, sentAt: 1, resolvedAt: 2 },
    { id: 'waiting', text: 'Sent earlier', createdAt: 0, sentAt: 1 },
    { id: 'fresh', text: 'Brand new', createdAt: 0 },
  ] },
];

test('resolved comments are left out of the text, and numbers skip them to match the pins', () => {
  const text = buildFeedbackText({ projectId: 'p', projectName: 'X', nodes: lifecycle });
  assert.doesNotMatch(text, /Old/);
  assert.match(text, /1\. Sent earlier \[comment waiting\]\n2\. Brand new \[comment fresh\]/);
  assert.deepEqual(openComments(lifecycle[0].comments).map((c) => c.id), ['waiting', 'fresh']);
});

test('a copy carries only new comments when there are any, keeping their numbers', () => {
  const plan = commentsToSend(lifecycle);
  assert.equal(plan.newOnly, true);
  assert.deepEqual([...plan.ids], ['fresh']);
  const text = buildFeedbackText({ projectId: 'p', projectName: 'X', nodes: lifecycle, only: plan.ids });
  assert.doesNotMatch(text, /Sent earlier/);
  assert.match(text, /\n2\. Brand new/);
});

test('with nothing new, a copy re-sends everything still open', () => {
  const sent = markSent(lifecycle, new Set(['fresh']), 5);
  assert.equal(countNew(sent), 0);
  assert.equal(sent[0].comments[2].sentAt, 5);
  // Already-sent and resolved comments keep their original stamps.
  assert.equal(sent[0].comments[1].sentAt, 1);
  const plan = commentsToSend(sent);
  assert.equal(plan.newOnly, false);
  assert.deepEqual([...plan.ids], ['waiting', 'fresh']);
});

test('marking sent leaves untouched sketches as the same object', () => {
  const other = { id: 'n2', name: 'Other', comments: [] };
  const out = markSent([lifecycle[0], other], new Set(['fresh']));
  assert.equal(out[1], other);
  assert.notEqual(out[0], lifecycle[0]);
});
