/**
 * The postMessage protocol between the canvas and `klose-bridge.js`, a small
 * script a live page (a dev server framed by a `url` card) loads so the canvas
 * can see into it. It mirrors what preview.html does for sketch code, minus the
 * sandbox: the page is the user's own, on their own machine.
 *
 * The TypeScript shapes are in bridgeProtocol.d.ts; this file is the guards,
 * kept plain JS so the node tests can import them.
 *
 * Handshake
 *   canvas -> page   { klose:'canvas', type:'klose:hello', nonce }   (nonce is random, per frame load)
 *   page -> canvas   { klose:'bridge', type:'klose:ready', nonce, version }
 * From then on every message, in both directions, must carry that nonce, come
 * from the other window (`event.source`) and from the origin recorded at the
 * handshake (`event.origin`). Anything else is ignored.
 *
 * Canvas -> page:  setInspecting { value } · locate { targets } · capture { id, scale }
 * Page -> canvas:  elementSelected { info } · pins { pins } · captured { id, dataUrl | message } · contentSize { width, height }
 */
import { isAllowedLiveUrl } from '../server/storeCore.js';

export const BRIDGE_VERSION = 1;

export const CANVAS_TYPES = ['klose:hello', 'setInspecting', 'locate', 'capture'];
export const BRIDGE_TYPES = ['klose:ready', 'elementSelected', 'pins', 'captured', 'contentSize'];

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

/** A fresh unguessable nonce for one frame load. */
export function createNonce() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * True for an origin the bridge will talk to: the canvas itself, which is
 * served from this machine. A page that frames a bridged dev server from
 * anywhere else gets nothing, because a screenshot or an element list is the
 * page's content.
 *
 * @param {unknown} origin
 */
export function isTrustedCanvasOrigin(origin) {
  return typeof origin === 'string' && origin !== 'null' && isAllowedLiveUrl(origin);
}

/**
 * The page's side: what to make of a message event.
 *
 * `state` is the binding made at the handshake ({ origin, nonce }, both null
 * before it). Returns the message when it should be acted on, else null. A
 * hello is accepted from the parent window even when already bound, because
 * the canvas asks again whenever the frame reloads.
 *
 * @param {{ data: unknown, source: unknown, origin: string }} event
 * @param {{ origin: string | null, nonce: string | null }} state
 * @param {unknown} parentWindow
 * @returns {Record<string, any> | null}
 */
export function acceptFromCanvas(event, state, parentWindow) {
  const data = /** @type {any} */ (event.data);
  if (!data || typeof data !== 'object' || data.klose !== 'canvas') return null;
  if (!CANVAS_TYPES.includes(data.type)) return null;
  if (!parentWindow || event.source !== parentWindow) return null;
  if (typeof data.nonce !== 'string' || !NONCE.test(data.nonce)) return null;
  if (data.type === 'klose:hello') return isTrustedCanvasOrigin(event.origin) ? data : null;
  if (!state.nonce || data.nonce !== state.nonce || event.origin !== state.origin) return null;
  return data;
}

/**
 * The canvas's side: `binding` is { frameWindow, origin, nonce } for the frame
 * it is talking to. `klose:ready` is the reply to the hello, so it must echo
 * the nonce like everything else.
 *
 * @param {{ data: unknown, source: unknown, origin: string }} event
 * @param {{ frameWindow: unknown, origin: string, nonce: string }} binding
 * @returns {Record<string, any> | null}
 */
export function acceptFromBridge(event, binding) {
  const data = /** @type {any} */ (event.data);
  if (!data || typeof data !== 'object' || data.klose !== 'bridge') return null;
  if (!BRIDGE_TYPES.includes(data.type)) return null;
  if (!binding.frameWindow || event.source !== binding.frameWindow) return null;
  if (event.origin !== binding.origin) return null;
  if (data.nonce !== binding.nonce) return null;
  return data;
}
