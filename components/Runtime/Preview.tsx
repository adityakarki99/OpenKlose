import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as LucideReact from 'lucide-react';
import type { SelectedElementInfo } from '../../types';

interface PreviewProps {
  code: string;
  /**
   * Optional name of the export to render. Used when previewing a real repo
   * component whose file may export several things (or use a named
   * forwardRef/memo export rather than a default). Sketches omit this and get
   * the default / first renderable export.
   */
  exportName?: string;
  /**
   * Whether the live component should receive pointer events. When false, the
   * iframe ignores pointer events so clicks fall through to the canvas (e.g.
   * to select or drag the node). The canvas also turns this off for the
   * duration of a drag/resize/pan: an iframe that still accepts pointer events
   * swallows every move once the cursor crosses it, which used to stall a
   * resize the moment it passed over the preview.
   */
  interactive?: boolean;
  /** When true, hovering highlights elements and a click reports the element instead of interacting with it. */
  isInspecting?: boolean;
  /** Called with the clicked element's info while inspecting. */
  onElementSelect?: (info: SelectedElementInfo) => void;
  /** Called with the rendered component's own size, so the frame can be fitted to it. */
  onContentSize?: (size: { width: number; height: number }) => void;
}

export interface PreviewHandle {
  /** Rasterizes the live preview and resolves with a PNG data URL. */
  capture: (options?: { scale?: number }) => Promise<string>;
}

interface PendingCapture {
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

const CAPTURE_TIMEOUT_MS = 20000;

/**
 * Renders a sketch's preview code inside a sandboxed, cross-origin iframe.
 *
 * SECURITY: this code comes from the coding agent, not Klose itself, so it's
 * treated as untrusted. It runs in an opaque-origin iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`) so it cannot read the
 * parent app's cookies, localStorage, or DOM, and its CSP blocks network
 * access. All communication is mediated through postMessage — including
 * screenshots, which the sandbox has to take of itself because the parent
 * cannot read a cross-origin frame's pixels.
 */
const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  { code, exportName, interactive = true, isInspecting = false, onElementSelect, onContentSize },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;
  const onContentSizeRef = useRef(onContentSize);
  onContentSizeRef.current = onContentSize;
  const pendingCapturesRef = useRef(new Map<string, PendingCapture>());
  const readyRef = useRef(false);
  readyRef.current = ready;

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (!frame || !frame.contentWindow) return;
    // Sandbox runs in an opaque origin, so the target origin must be '*'.
    frame.contentWindow.postMessage(message, '*');
  }, []);

  // Resolve the app's current (theme-aware) surface color so the sandbox can
  // paint its opaque background to match the canvas instead of showing white.
  const resolveSurfaceColor = useCallback((): string => {
    try {
      const surface = getComputedStyle(document.documentElement)
        .getPropertyValue('--app-surface')
        .trim();
      if (surface) return `rgb(${surface})`;
    } catch {
      // ignore
    }
    return '#0f172a';
  }, []);

  const settleCapture = useCallback((id: unknown, settle: (pending: PendingCapture) => void) => {
    if (typeof id !== 'string') return;
    const pending = pendingCapturesRef.current.get(id);
    if (!pending) return;
    pendingCapturesRef.current.delete(id);
    window.clearTimeout(pending.timer);
    settle(pending);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      capture: (options) =>
        new Promise<string>((resolve, reject) => {
          if (!readyRef.current) {
            reject(new Error('The preview is still loading.'));
            return;
          }
          const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const timer = window.setTimeout(() => {
            pendingCapturesRef.current.delete(id);
            reject(new Error('The preview took too long to produce a screenshot.'));
          }, CAPTURE_TIMEOUT_MS);
          pendingCapturesRef.current.set(id, { resolve, reject, timer });
          postToFrame({ type: 'capture', id, scale: options?.scale ?? 2 });
        }),
    }),
    [postToFrame]
  );

  useEffect(() => {
    const pending = pendingCapturesRef.current;
    return () => {
      pending.forEach((entry) => {
        window.clearTimeout(entry.timer);
        entry.reject(new Error('The preview was closed before the screenshot finished.'));
      });
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const frame = iframeRef.current;
      // Only trust messages coming from our own sandbox iframe.
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'klose-sandbox') return;

      switch (data.type) {
        case 'ready':
          postToFrame({ type: 'surface', color: resolveSurfaceColor() });
          setReady(true);
          break;
        case 'rendered':
          setError(null);
          break;
        case 'error':
          setError(typeof data.message === 'string' ? data.message : 'Failed to render component');
          break;
        case 'select':
          if (data.info) onElementSelectRef.current?.(data.info as SelectedElementInfo);
          break;
        case 'contentSize':
          if (typeof data.width === 'number' && typeof data.height === 'number') {
            onContentSizeRef.current?.({ width: data.width, height: data.height });
          }
          break;
        case 'capture':
          settleCapture(data.id, (entry) => {
            if (typeof data.dataUrl === 'string') entry.resolve(data.dataUrl);
            else entry.reject(new Error('The sandbox returned an empty screenshot.'));
          });
          break;
        case 'captureError':
          settleCapture(data.id, (entry) =>
            entry.reject(
              new Error(typeof data.message === 'string' ? data.message : 'Screenshot failed')
            )
          );
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postToFrame, resolveSurfaceColor, settleCapture]);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    postToFrame({ type: 'render', code, name: exportName });
  }, [ready, code, exportName, postToFrame]);

  // A broken/corrupt local installation should fail clearly instead of leaving
  // the preview spinner up forever.
  const READY_TIMEOUT_MS = 15000;
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => {
      setError((current) =>
        current ??
        'The bundled preview runtime failed to load. Rebuild or reinstall Klose and try again.'
      );
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    postToFrame({ type: 'setInspecting', value: isInspecting });
  }, [ready, isInspecting, postToFrame]);

  return (
    <div className="w-full h-full min-w-full min-h-full relative">
      <iframe
        ref={iframeRef}
        title="Sketch preview"
        sandbox="allow-scripts"
        src="/preview.html"
        allowTransparency
        className="w-full h-full block border-0"
        style={{ background: 'transparent', pointerEvents: interactive ? 'auto' : 'none' }}
      />

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-red-500 bg-red-50/50 rounded-lg pointer-events-none">
          <LucideReact.AlertTriangle className="mb-2 w-6 h-6" />
          <p className="text-sm font-semibold">Render Error</p>
          <p className="text-xs opacity-75 text-center mt-1">{error}</p>
        </div>
      )}

      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-400 pointer-events-none">
          <LucideReact.Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
    </div>
  );
});

export default Preview;
