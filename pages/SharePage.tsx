import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, TerminalSquare } from 'lucide-react';
import { openShare } from '../lib/shareSession';
import { getSession } from '../lib/folderSession';

/**
 * A share link's landing: `#/s/<id>/<key>`. Opens the share (fetch, decrypt,
 * start syncing) and goes to the project's canvas. There is nothing to click:
 * the link is the whole setup.
 */
const SharePage: React.FC = () => {
  const { id = '', key = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      try {
        const current = getSession();
        const session = current?.kind === 'share' && current.share?.id === id && current.share.key === key ? current : await openShare(id, key);
        if (!cancelled) navigate(`/canvas/${session.share!.projectId}`, { replace: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open the share.');
      }
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [id, key, navigate]);

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-app-bg px-5 py-10 text-app-primary">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.2)]" />
          <span className="font-logo text-xl font-bold tracking-tight">Klose</span>
          <span className="rounded-full border border-app-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-app-muted">shared canvas</span>
        </div>
        {error ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">This link didn't open</h1>
            <p className="mt-2 text-sm leading-relaxed text-app-secondary" role="alert">
              {error}
            </p>
            <dl className="mt-8 grid gap-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-2 font-medium text-app-primary">
                  <Link2 size={15} className="text-indigo-400" /> Check the link
                </dt>
                <dd className="mt-1 text-app-muted">A share link ends in two long codes after <code className="font-mono text-xs">#/s/</code>. Paste the whole thing.</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 font-medium text-app-primary">
                  <TerminalSquare size={15} className="text-amber-400" /> Ask the agent again
                </dt>
                <dd className="mt-1 text-app-muted">
                  Shares expire a month after the last change. <code className="font-mono text-xs">npx klose share &lt;projectId&gt;</code> makes a fresh one.
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Opening the shared canvas…</h1>
            <p className="mt-2 text-sm leading-relaxed text-app-secondary">Decrypting it in this tab. The key is in the link and never left it.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default SharePage;
