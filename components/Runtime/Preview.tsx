import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as LucideReact from 'lucide-react';
import { SANDBOX_BOOTSTRAP_HTML } from './sandboxBootstrap';
import type { SelectedElementInfo } from '../../types';

interface PreviewProps {
  code: string;
  /**
   * Whether the live component should receive pointer events. When false, the
   * iframe ignores pointer events so clicks fall through to the canvas (e.g.
   * to select or drag the node).
   */
  interactive?: boolean;
  /** When true, hovering highlights elements and a click reports the element instead of interacting with it. */
  isInspecting?: boolean;
  /** Called with the clicked element's info while inspecting. */
  onElementSelect?: (info: SelectedElementInfo) => void;
}

/**
 * Renders a sketch's preview code inside a sandboxed, cross-origin iframe.
 *
 * SECURITY: this code comes from the coding agent, not Klose itself, so it's
 * treated as untrusted. It runs in an opaque-origin iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`) so it cannot read the
 * parent app's cookies, localStorage, or DOM, and its CSP blocks network
 * access. All communication is mediated through postMessage.
 */
const Preview: React.FC<PreviewProps> = ({ code, interactive = true, isInspecting = false, onElementSelect }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;

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
        default:
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postToFrame, resolveSurfaceColor]);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    postToFrame({ type: 'render', code });
  }, [ready, code, postToFrame]);

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
        srcDoc={SANDBOX_BOOTSTRAP_HTML}
        allowTransparency
        className="w-full h-full block border-0"
        style={{ background: 'transparent', pointerEvents: interactive || isInspecting ? 'auto' : 'none' }}
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
};

export default Preview;
