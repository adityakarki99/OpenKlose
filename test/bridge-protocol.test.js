import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { acceptFromBridge, acceptFromCanvas, createNonce, isTrustedCanvasOrigin } from '../lib/bridgeProtocol.js';

if (!globalThis.crypto?.getRandomValues) globalThis.crypto = webcrypto;

const NONCE = 'a'.repeat(32);
const PARENT = { name: 'parent' };
const FRAME = { name: 'frame' };
const CANVAS = 'http://127.0.0.1:5171';
const bound = { origin: CANVAS, nonce: NONCE };
const unbound = { origin: null, nonce: null };
const canvasMsg = (extra = {}) => ({ klose: 'canvas', nonce: NONCE, type: 'setInspecting', value: true, ...extra });
const bridgeMsg = (extra = {}) => ({ klose: 'bridge', nonce: NONCE, type: 'pins', pins: [], ...extra });

test('createNonce makes distinct, well-formed nonces', () => {
  const a = createNonce();
  assert.match(a, /^[0-9a-f]{36}$/);
  assert.notEqual(a, createNonce());
});

test('only local origins may talk to the bridge', () => {
  for (const ok of ['http://localhost:5171', 'http://127.0.0.1:1', 'http://[::1]:2', 'http://app.localhost:3']) {
    assert.equal(isTrustedCanvasOrigin(ok), true, ok);
  }
  for (const bad of ['https://evil.example', 'null', '', undefined, 'http://localhost.evil.example', 'file://']) {
    assert.equal(isTrustedCanvasOrigin(bad), false, String(bad));
  }
});

test('page side: a hello from the parent on a local origin is accepted', () => {
  const hello = { klose: 'canvas', nonce: NONCE, type: 'klose:hello' };
  assert.ok(acceptFromCanvas({ data: hello, source: PARENT, origin: CANVAS }, unbound, PARENT));
  // ...even when already bound: the canvas asks again after a reload.
  assert.ok(acceptFromCanvas({ data: hello, source: PARENT, origin: CANVAS }, bound, PARENT));
});

test('page side: a hello from the wrong source or a non-local origin is ignored', () => {
  const hello = { klose: 'canvas', nonce: NONCE, type: 'klose:hello' };
  assert.equal(acceptFromCanvas({ data: hello, source: FRAME, origin: CANVAS }, unbound, PARENT), null);
  assert.equal(acceptFromCanvas({ data: hello, source: PARENT, origin: 'https://evil.example' }, unbound, PARENT), null);
  assert.equal(acceptFromCanvas({ data: hello, source: PARENT, origin: 'null' }, unbound, PARENT), null);
});

test('page side: nothing but a hello counts before the handshake', () => {
  assert.equal(acceptFromCanvas({ data: canvasMsg(), source: PARENT, origin: CANVAS }, unbound, PARENT), null);
});

test('page side: after the handshake the right nonce, source and origin pass', () => {
  assert.ok(acceptFromCanvas({ data: canvasMsg(), source: PARENT, origin: CANVAS }, bound, PARENT));
});

test('page side: wrong nonce, wrong source, wrong origin and unknown type are all ignored', () => {
  const accept = (data, source = PARENT, origin = CANVAS) => acceptFromCanvas({ data, source, origin }, bound, PARENT);
  assert.equal(accept(canvasMsg({ nonce: 'b'.repeat(32) })), null);
  assert.equal(accept(canvasMsg({ nonce: 'short' })), null);
  assert.equal(accept(canvasMsg({ nonce: undefined })), null);
  assert.equal(accept(canvasMsg(), FRAME), null);
  assert.equal(accept(canvasMsg(), PARENT, 'http://127.0.0.1:9999'), null);
  assert.equal(accept(canvasMsg({ type: 'eval' })), null);
  assert.equal(accept(canvasMsg({ klose: 'bridge' })), null);
  for (const junk of [null, undefined, 'x', 5, [], {}]) assert.equal(accept(junk), null);
});

test('canvas side: the right nonce, window and origin pass', () => {
  const binding = { frameWindow: FRAME, origin: 'http://localhost:8081', nonce: NONCE };
  assert.ok(acceptFromBridge({ data: bridgeMsg(), source: FRAME, origin: 'http://localhost:8081' }, binding));
  assert.ok(acceptFromBridge({ data: bridgeMsg({ type: 'klose:ready', version: 1 }), source: FRAME, origin: 'http://localhost:8081' }, binding));
});

test('canvas side: wrong nonce, window, origin or type are ignored', () => {
  const binding = { frameWindow: FRAME, origin: 'http://localhost:8081', nonce: NONCE };
  const accept = (data, source = FRAME, origin = 'http://localhost:8081') => acceptFromBridge({ data, source, origin }, binding);
  assert.equal(accept(bridgeMsg({ nonce: 'b'.repeat(32) })), null);
  assert.equal(accept(bridgeMsg({ nonce: undefined })), null);
  assert.equal(accept(bridgeMsg(), PARENT), null);
  assert.equal(accept(bridgeMsg(), FRAME, 'http://localhost:9999'), null);
  assert.equal(accept(bridgeMsg({ type: 'setInspecting' })), null);
  assert.equal(accept(bridgeMsg({ klose: 'canvas' })), null);
  assert.equal(acceptFromBridge({ data: bridgeMsg(), source: null, origin: 'http://localhost:8081' }, { ...binding, frameWindow: null }), null);
});
