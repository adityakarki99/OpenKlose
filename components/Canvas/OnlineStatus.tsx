import React, { useState } from 'react';
import { useFolderSession } from '../../lib/folderSession';
import { useShareStatus } from '../../lib/shareSession';
import { shareUrl, shareApi, shareClient, encryptBundle, makeBundle, newShareKey } from '../../server/shareCore.js';

export const onlineLabels = {
  ok: 'Saved online',
  syncing: 'Syncing…',
  offline: 'Offline — changes queued',
  gone: 'Link expired — local recovery available',
  'storage-error': 'Browser recovery failed — keep this tab open',
};

export default function OnlineStatus({ pending = false }: { pending?: boolean }) {
  const session = useFolderSession();
  const status = useShareStatus();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  if (session?.kind !== 'share' || !session.share) return null;
  const link = shareUrl(session.share.host, session.share.id, session.share.key);
  return (
    <div
      className="absolute right-4 top-12 z-40 max-w-sm rounded-lg border border-app-border bg-app-surface-elevated p-3 text-xs shadow-lg"
      data-testid="online-status"
    >
      <button className="min-h-8 text-left" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <span role="status">{pending ? 'Saving changes…' : onlineLabels[status]}</span>
        <span className="ml-3">{expanded ? 'Close' : 'Details'}</span>
      </button>
      {expanded && (
        <div className="space-y-3 pt-2">
          <p>Design workspace saved online. GitHub source is read-only; saving here does not commit code.</p>
          <p>
            Anyone with the link can view and edit. The online copy expires after 30 days without changes. Recovery copies stay in this
            browser.
          </p>
          <button
            className="min-h-9 underline"
            onClick={() =>
              void navigator.clipboard.writeText(link).then(
                () => setMessage('Link copied.'),
                () => setMessage('Could not copy link.'),
              )
            }
          >
            Copy board link
          </button>
          <button className="ml-4 min-h-9 underline" onClick={() => void session.retrySync?.()}>
            Retry sync
          </button>
          {status === 'gone' && (
            <button
              className="min-h-9 underline"
              disabled={pending}
              onClick={async () => {
                try {
                  const project = JSON.parse((await session.fs.read(['.klose', 'projects', `${session.share!.projectId}.json`]))!);
                  const key = newShareKey();
                  const { id } = await shareClient(shareApi(location.origin)).create(
                    await encryptBundle(key, makeBundle(project, { themeCss: session.themeCss || '', repoName: session.name })),
                  );
                  window.location.hash = `/s/${id}/${key}`;
                } catch {
                  setMessage('Could not create a new link. Your recovery copy is still here.');
                }
              }}
            >
              Create a new online link from recovery
            </button>
          )}
          <a className="block min-h-9 underline" href="#/">
            Open another project
          </a>
          <h3 className="font-semibold">Recent revisions on this device</h3>
          {(session.revisions?.() || [])
            .slice()
            .reverse()
            .map((r) => (
              <div key={r.at} className="flex items-center justify-between gap-3">
                <span>{new Date(r.at).toLocaleString()}</span>
                <button
                  className="min-h-9 underline"
                  disabled={pending}
                  onClick={() =>
                    void session.restoreRevision?.(r.at).then(
                      () => setMessage('Revision restored; previous version retained.'),
                      () => setMessage('Could not restore revision.'),
                    )
                  }
                >
                  Restore
                </button>
              </div>
            ))}
          {!session.revisions?.().length && <p>No earlier revisions on this device yet.</p>}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
