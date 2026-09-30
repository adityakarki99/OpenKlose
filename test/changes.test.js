import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeBadge, diffSketches, summarizeChanges } from '../lib/changes.js';

const card = { id: 'a', name: 'Card', code: 'v1', x: 0, y: 0, comments: [{ id: 'c1' }, { id: 'c2' }] };

test('moves and resizes are not reported as agent changes', () => {
  assert.deepEqual(diffSketches([card], [{ ...card, x: 400, y: 20 }]), []);
});

test('new code and resolved comments are reported together', () => {
  const after = { ...card, code: 'v2', comments: [{ id: 'c1', resolvedAt: 5 }, { id: 'c2', resolvedAt: 5 }] };
  const changes = diffSketches([card], [after]);
  assert.deepEqual(changes, [{ id: 'a', name: 'Card', kind: 'updated', resolved: 2 }]);
  assert.equal(summarizeChanges(changes), 'Agent updated "Card" · resolved 2 comments');
  assert.equal(changeBadge(changes[0]), 'Agent resolved 2');
});

test('a comment resolved before this read is not counted again', () => {
  const before = { ...card, comments: [{ id: 'c1', resolvedAt: 1 }, { id: 'c2' }] };
  const after = { ...card, comments: [{ id: 'c1', resolvedAt: 1 }, { id: 'c2', resolvedAt: 9 }] };
  assert.equal(diffSketches([before], [after])[0].resolved, 1);
});

test('new sketches and builds get their own wording', () => {
  const changes = diffSketches([card], [{ ...card, status: 'built', builtFilePath: 'src/Card.tsx' }, { id: 'b', name: '' }]);
  assert.deepEqual(changes.map((c) => c.kind), ['built', 'added']);
  assert.equal(changes[1].name, 'Untitled sketch');
  assert.equal(summarizeChanges(changes), 'Agent changed 2 sketches');
  assert.equal(summarizeChanges([changes[1]]), 'Agent added "Untitled sketch"');
  assert.equal(changeBadge(changes[0]), 'Built by agent');
});

test('nothing changed, nothing to say', () => {
  assert.equal(summarizeChanges([]), '');
});
