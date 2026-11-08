import type { PinPosition, SelectedElementInfo } from '../types';

export const BRIDGE_VERSION: number;
export const CANVAS_TYPES: readonly string[];
export const BRIDGE_TYPES: readonly string[];
export function createNonce(): string;
export function isTrustedCanvasOrigin(origin: unknown): boolean;

export interface PinTarget {
  id: string;
  element: SelectedElementInfo;
}

/** Canvas -> page. Every message carries the handshake nonce. */
export type CanvasMessage =
  | { klose: 'canvas'; nonce: string; type: 'klose:hello' }
  | { klose: 'canvas'; nonce: string; type: 'setInspecting'; value: boolean }
  | { klose: 'canvas'; nonce: string; type: 'locate'; targets: PinTarget[] }
  | { klose: 'canvas'; nonce: string; type: 'capture'; id: string; scale?: number };

/** Page -> canvas. */
export type BridgeMessage =
  | { klose: 'bridge'; nonce: string; type: 'klose:ready'; version: number }
  | { klose: 'bridge'; nonce: string; type: 'elementSelected'; info: SelectedElementInfo }
  | { klose: 'bridge'; nonce: string; type: 'pins'; pins: PinPosition[] }
  | { klose: 'bridge'; nonce: string; type: 'captured'; id: string; dataUrl?: string; message?: string }
  | { klose: 'bridge'; nonce: string; type: 'contentSize'; width: number; height: number };

export interface MessageLike {
  data: unknown;
  source: unknown;
  origin: string;
}

export function acceptFromCanvas(
  event: MessageLike,
  state: { origin: string | null; nonce: string | null },
  parentWindow: unknown
): CanvasMessage | null;

export function acceptFromBridge(
  event: MessageLike,
  binding: { frameWindow: unknown; origin: string; nonce: string }
): BridgeMessage | null;
