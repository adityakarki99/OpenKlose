import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locallyChanged, mergeSketches } from '../lib/merge.js';

const a = { id: 'a', name: 'A', code: 'v1', x: 0 };
const b = { id: 'b', name: 'B', code: 'v1', x: 500 };

test('with no local edits, the incoming version wins wholesale', () => {
  const incoming = [{ ...a, code: 'v2' }, b];
  assert.deepEqual(mergeSketches({ base: [a, b], local: [a, b], incoming }), { nodes: incoming, kept: [] });
});

test('a sketch edited here keeps the local version; the others take the incoming one', () => {
  const local = [{ ...a, x: 40 }, b];
  const incoming = [{ ...a, code: 'v2' }, { ...b, code: 'v2' }];
  const { nodes, kept } = mergeSketches({ base: [a, b], local, incoming });
  assert.deepEqual(nodes, [{ ...a, x: 40 }, { ...b, code: 'v2' }]);
  assert.deepEqual(kept, ['a']);
});

test('a sketch added here and not saved yet survives', () => {
  const c = { id: 'c', name: 'C' };
  const { nodes } = mergeSketches({ base: [a], local: [a, c], incoming: [{ ...a, code: 'v2' }] });
  assert.deepEqual(nodes.map((n) => n.id), ['a', 'c']);
  assert.equal(nodes[0].code, 'v2');
});

test('a sketch deleted here stays deleted even if the agent touched it', () => {
  const { nodes } = mergeSketches({ base: [a, b], local: [b], incoming: [{ ...a, code: 'v2' }, b] });
  assert.deepEqual(nodes.map((n) => n.id), ['b']);
});

test('sketches the agent added appear; ones it deleted go, unless edited here', () => {
  const c = { id: 'c', name: 'C' };
  const untouched = mergeSketches({ base: [a, b], local: [a, b], incoming: [b, c] });
  assert.deepEqual(untouched.nodes.map((n) => n.id), ['b', 'c']);
  const edited = mergeSketches({ base: [a, b], local: [{ ...a, name: 'A!' }, b], incoming: [b, c] });
  assert.deepEqual(edited.nodes.map((n) => n.id), ['b', 'c', 'a']);
  assert.deepEqual(edited.kept, ['a']);
});

test('locallyChanged spots edits, additions and deletions', () => {
  assert.deepEqual([...locallyChanged([a, b], [{ ...a, x: 1 }, { id: 'c' }])].sort(), ['a', 'b', 'c']);
  assert.equal(locallyChanged([a], [a]).size, 0);
});
