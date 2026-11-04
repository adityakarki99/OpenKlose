import React, { useEffect, useState } from 'react';
import { AlertTriangle, PlugZap } from 'lucide-react';
import { STATIC } from '../../lib/mode';
import { currentShare } from '../../lib/shareSession';
import { isAllowedLiveUrl } from '../../server/storeCore.js';

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
 * The strict sandbox for agent-written code (components/Runtime/Preview.tsx and
 * preview.html) is not touched by this.
 */

/** How long a page may take to fire `load` before it counts as unreachable. */
const LOAD_TIMEOUT_MS = 10_000;

interface LivePreviewProps {
  url: string;
  /** PNG data URL shown when the page can't be reached (or can't be drawn). */
  snapshot?: string;
  /** Same rule as <Preview>: take mouse input only when the card is selected and the canvas is idle. */
  interactive?: boolean;
  title?: string;
}

type Phase = 'probing' | 'loading' | 'live' | 'down';

const LivePreview: React.FC<LivePreviewProps> = ({ url, snapshot, interactive = false, title }) => {
  const allowed = isAllowedLiveUrl(url);
  // The hosted canvas and a shared canvas never reach the author's machine,
  // and a stranger's project must not make this browser fetch localhost.
  const mayDraw = allowed && !STATIC && !currentShare();
  const [phase, setPhase] = useState<Phase>('probing');

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
      title={title ? `${title} (live)` : 'Live component'}
      src={url}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      onLoad={() => setPhase('live')}
      className="block h-full w-full border-0 bg-white"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      data-live-state={phase}
    />
  );
};

export default LivePreview;
