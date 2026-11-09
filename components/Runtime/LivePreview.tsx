import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertTriangle, PlugZap } from 'lucide-react';
import { STATIC } from '../../lib/mode';
import { currentShare } from '../../lib/shareSession';
import { isAllowedLiveUrl } from '../../server/storeCore.js';
import { acceptFromBridge, createNonce } from '../../lib/bridgeProtocol.js';
import type { PinPosition, SelectedElementInfo } from '../../types';
import type { PreviewHandle } from './Preview';

/**
 * A card that shows a page running on this machine (a dev server) as a frame
 * in the canvas, instead of agent-written `code` in the sandbox.
 *
 * Trust: unlike <Preview>, this frame has `allow-same-origin`, so the page runs
 * with its own origin and can reach its own dev server. That is fine for the
 * user's own code on their own machine, which is why the address is held to
 * localhost (`isAllowedLiveUrl`), checked when the card is saved and again here.
 *
 * Cookie caution: browsers don't separate cookies by port, so a framed app on
 * `localhost:8081` can read every cookie set for `localhost`, including any set
 * by Klose or another local tool. Klose must never keep anything sensitive in a
 * `localhost` cookie.
 *
 * Bridge: if the page loads `klose-bridge.js` (served by Klose at
 * /klose-bridge.js), it answers a handshake and the card becomes "bridged": the
 * same element picking, comment pins, content size and screenshots as a sketch
 * card, over postMessage (lib/bridgeProtocol.js). Every message carries a nonce
 * from this frame load and must come from this frame's window and origin. A page
 * without the bridge keeps working as a plain frame.
 *
 * The strict sandbox for agent-written code (components/Runtime/Preview.tsx and
 * preview.html) is not touched by this.
 */

/** How long a page may take to fire `load` before it counts as unreachable. */
const LOAD_TIMEOUT_MS = 10_000;

/** Hello is repeated until the page answers: the bridge script may load after `load` fires. */
const HELLO_INTERVAL_MS = 400;
const HELLO_ATTEMPTS = 15;
const CAPTURE_TIMEOUT_MS = 20000;

interface LivePreviewProps {
  url: string;
  /** PNG data URL shown when the page can't be reached (or can't be drawn). */
  snapshot?: string;
  /** Drawn when the page is down and there is no snapshot, before the "dev server not running" placeholder. */
  fallback?: React.ReactNode;
  /** Handle of the preview drawn as `fallback`: screenshots are taken from it while the page is down. */
  fallbackHandle?: React.RefObject<PreviewHandle | null>;
  /** Same rule as <Preview>: take mouse input only when the card is selected and the canvas is idle. */
  interactive?: boolean;
  title?: string;
  /** Bridged cards only, like the matching <Preview> props: */
  isInspecting?: boolean;
  onElementSelect?: (info: SelectedElementInfo) => void;
  onContentSize?: (size: { width: number; height: number }) => void;
  pinTargets?: Array<{ id: string; element: SelectedElementInfo }>;
  onPins?: (pins: PinPosition[]) => void;
  /** True once the page has answered the handshake (and false again when it is gone). */
  onBridgeChange?: (bridged: boolean) => void;
  /** Fired once per page load, when the bridge has answered: a good moment to refresh the snapshot. */
  onBridgeReady?: () => void;
}

type Phase = 'probing' | 'loading' | 'live' | 'down';

interface PendingCapture {
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

const LivePreview = forwardRef<PreviewHandle, LivePreviewProps>(function LivePreview(
  { url, snapshot, fallback, fallbackHandle, interactive = false, title, isInspecting = false, onElementSelect, onContentSize, pinTargets, onPins, onBridgeChange, onBridgeReady },
  ref
) {
  const allowed = isAllowedLiveUrl(url);
  // The hosted canvas and a shared canvas never reach the author's machine,
  // and a stranger's project must not make this browser fetch localhost.
  const mayDraw = allowed && !STATIC && !currentShare();
  const [phase, setPhase] = useState<Phase>('probing');
  const [bridged, setBridged] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef<string | null>(null);
  const helloTimerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(new Map<string, PendingCapture>());
  const bridgedRef = useRef(false);
  bridgedRef.current = bridged;
  const handlers = useRef({ onElementSelect, onContentSize, onPins, onBridgeChange, onBridgeReady });
  handlers.current = { onElementSelect, onContentSize, onPins, onBridgeChange, onBridgeReady };

  // The origin messages must come from. A page that navigates the frame
  // elsewhere stops matching, so it is simply not bridged.
  const origin = (() => {
    try {
      return allowed ? new URL(url).origin : null;
    } catch {
      return null;
    }
  })();

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || !origin || !nonceRef.current) return;
      target.postMessage({ klose: 'canvas', nonce: nonceRef.current, ...message }, origin);
    },
    [origin]
  );

  const setBridge = useCallback((value: boolean) => {
    setBridged((current) => {
      if (current !== value) handlers.current.onBridgeChange?.(value);
      return value;
    });
  }, []);

  const stopHello = useCallback(() => {
    window.clearInterval(helloTimerRef.current);
    helloTimerRef.current = undefined;
  }, []);

  // A new page load is a new handshake: fresh nonce, bridge not yet known.
  const startHandshake = useCallback(() => {
    stopHello();
    setBridge(false);
    nonceRef.current = createNonce();
    let attempts = 0;
    const hello = () => {
      if (++attempts > HELLO_ATTEMPTS) return stopHello();
      postToFrame({ type: 'klose:hello' });
    };
    hello();
    helloTimerRef.current = window.setInterval(hello, HELLO_INTERVAL_MS);
  }, [postToFrame, setBridge, stopHello]);

  useEffect(() => stopHello, [stopHello]);

  useImperativeHandle(
    ref,
    () => ({
      capture: (options) =>
        new Promise<string>((resolve, reject) => {
          if (!bridgedRef.current && fallbackHandle?.current) {
            fallbackHandle.current.capture(options).then(resolve, reject);
            return;
          }
          if (!bridgedRef.current) {
            reject(new Error('This page does not load klose-bridge.js, so it cannot be captured.'));
            return;
          }
          const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const timer = window.setTimeout(() => {
            pendingRef.current.delete(id);
            reject(new Error('The page took too long to produce a screenshot.'));
          }, CAPTURE_TIMEOUT_MS);
          pendingRef.current.set(id, { resolve, reject, timer });
          postToFrame({ type: 'capture', id, scale: options?.scale ?? 2 });
        }),
    }),
    [postToFrame, fallbackHandle]
  );

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      pending.forEach((entry) => {
        window.clearTimeout(entry.timer);
        entry.reject(new Error('The card was closed before the screenshot finished.'));
      });
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || !origin || !nonceRef.current) return;
      const message = acceptFromBridge(event, { frameWindow: frame.contentWindow, origin, nonce: nonceRef.current });
      if (!message) return;
      if (message.type === 'klose:ready') {
        stopHello();
        setBridge(true);
        handlers.current.onBridgeReady?.();
        return;
      }
      if (!bridgedRef.current) return; // nothing but ready counts before the handshake
      switch (message.type) {
        case 'elementSelected':
          if (message.info && typeof message.info === 'object') handlers.current.onElementSelect?.(message.info);
          break;
        case 'pins':
          if (Array.isArray(message.pins)) handlers.current.onPins?.(message.pins);
          break;
        case 'contentSize':
          if (typeof message.width === 'number' && typeof message.height === 'number') {
            handlers.current.onContentSize?.({ width: message.width, height: message.height });
          }
          break;
        case 'captured': {
          const pending = typeof message.id === 'string' ? pendingRef.current.get(message.id) : undefined;
          if (!pending) break;
          pendingRef.current.delete(message.id);
          window.clearTimeout(pending.timer);
          if (typeof message.dataUrl === 'string') pending.resolve(message.dataUrl);
          else pending.reject(new Error(typeof message.message === 'string' ? message.message : 'Screenshot failed'));
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [origin, setBridge, stopHello]);

  // Sent as a string key so a new array with the same targets doesn't re-post.
  const pinTargetsKey = JSON.stringify(pinTargets ?? []);
  useEffect(() => {
    if (bridged) postToFrame({ type: 'locate', targets: JSON.parse(pinTargetsKey) });
  }, [bridged, pinTargetsKey, postToFrame]);

  useEffect(() => {
    if (bridged) postToFrame({ type: 'setInspecting', value: isInspecting });
  }, [bridged, isInspecting, postToFrame]);

  useEffect(() => {
    if (!mayDraw) return;
    let cancelled = false;
    setPhase('probing');
    const controller = new AbortController();
    // A no-cors request resolves (opaquely) for any answer, and rejects only
    // when nothing is listening: that is all we need to know.
    fetch(url, { mode: 'no-cors', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(() => !cancelled && setPhase('loading'))
      .catch(() => !cancelled && setPhase('down'));
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, mayDraw]);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setTimeout(() => setPhase('down'), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // No frame, no bridge.
  useEffect(() => {
    if (phase === 'live') return;
    stopHello();
    setBridge(false);
  }, [phase, setBridge, stopHello]);

  if (!allowed) {
    return (
      <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-1 p-4 text-center text-xs text-red-400" data-live-state="refused">
        <AlertTriangle size={20} />
        <p className="font-semibold">This address can't be shown</p>
        <p className="max-w-full break-all opacity-75">Live cards only show pages on localhost.</p>
      </div>
    );
  }

  if (!mayDraw || phase === 'down') {
    if (snapshot) {
      return <img src={snapshot} alt={title ? `${title} (last snapshot)` : 'Last snapshot'} className="h-full w-full object-contain object-top" data-live-state="snapshot" draggable={false} />;
    }
    if (fallback) return <div className="h-full w-full" data-live-state="fallback">{fallback}</div>;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-4 text-center text-xs text-app-secondary" data-live-state="placeholder">
        <PlugZap size={20} />
        <p className="font-semibold">Dev server not running</p>
        <p className="max-w-full break-all font-mono opacity-75">{url}</p>
      </div>
    );
  }

  if (phase === 'probing') return <div className="h-full w-full" data-live-state="probing" />;

  return (
    <iframe
      ref={iframeRef}
      title={title ? `${title} (live)` : 'Live component'}
      src={url}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      onLoad={() => {
        setPhase('live');
        startHandshake();
      }}
      className="block h-full w-full border-0 bg-white"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      data-live-state={phase}
    />
  );
});

export default LivePreview;
