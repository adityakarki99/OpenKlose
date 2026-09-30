import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locatorFor, matchScore, pickBestCandidate, resolveLocator } from '../lib/pins.js';

/** A minimal element tree: just parentElement and children, like the DOM. */
function tree(shape, parent = null) {
  const node = { parentElement: parent, children: [] };
  node.children = shape.map((child) => tree(child, node));
  return node;
}

test('a locator round-trips to the same element', () => {
  const root = tree([[], [[], [], [[]]]]);
  const target = root.children[1].children[2].children[0];
  const locator = locatorFor(target, root);
  assert.equal(locator, '2>3>1');
  assert.equal(resolveLocator(root, locator), target);
});

test('a locator whose element is gone resolves to nothing', () => {
  const root = tree([[], []]);
  assert.equal(resolveLocator(root, '2>1'), null);
  assert.equal(resolveLocator(root, '5'), null);
  assert.equal(resolveLocator(root, ''), null);
  assert.equal(resolveLocator(root, 'x'), null);
});

test('an element outside the root has no locator', () => {
  const root = tree([[]]);
  const stranger = tree([]);
  assert.equal(locatorFor(stranger, root), '');
});

const info = { tagName: 'div', text: 'variant size isLoading', classes: 'flex gap-1.5', path: 'div > div > div' };

test('text and classes outweigh the breadcrumb', () => {
  assert.equal(matchScore({ path: 'div > div > div', text: 'other', classes: 'grid' }, info), 2);
  assert.equal(matchScore({ path: 'div > span', text: 'variant size isLoading', classes: 'flex gap-1.5' }, info), 6);
});

test('the best scoring candidate wins', () => {
  const candidates = [
    { path: 'div > div > div', text: 'Button', classes: 'p-4' },
    { path: 'div > div > div', text: 'variant size isLoading', classes: 'flex gap-1.5' },
    { path: 'div > div > div', text: 'variant size isLoading leftIcon', classes: 'flex' },
  ];
  assert.equal(pickBestCandidate(candidates, info), 1);
});

test('a breadcrumb match alone is not enough to place a pin', () => {
  // A pin on the wrong element is worse than no pin at all.
  assert.equal(pickBestCandidate([{ path: 'div > div > div', text: 'Hello', classes: 'p-2' }], info), -1);
  assert.equal(pickBestCandidate([], info), -1);
});
