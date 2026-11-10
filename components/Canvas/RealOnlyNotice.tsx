import React from 'react';
import { Plug } from 'lucide-react';

interface RealOnlyNoticeProps {
  /** The imports the sandbox can't satisfy. */
  imports: string[];
  /** The last picture taken of the sketch while it was running in the app. */
  snapshot?: string;
  /** The sketch's code came from somewhere else and has not been accepted on this machine. */
  pending?: boolean;
  accepting?: boolean;
  onAccept?: () => void;
  /** The dev server the harness frames, when this canvas has one. */
  devServer?: string;
  /** False on a hosted, shared or online canvas, which can never reach the repo's dev server. */
  nextToRepo?: boolean;
}

/**
 * Shown where the sandbox would have drawn a sketch that imports the repo's
 * own modules. The sandbox can't load those, so there is nothing honest to
 * render: say what the sketch needs, over its last snapshot if it has one.
 */
const RealOnlyNotice: React.FC<RealOnlyNoticeProps> = ({ imports, snapshot, pending = false, accepting = false, onAccept, devServer, nextToRepo = true }) => {
  const named = imports.slice(0, 2).join(', ') + (imports.length > 2 ? ` and ${imports.length - 2} more` : '');
  return (
    <div className="relative h-full w-full" data-real-only={pending ? 'pending' : 'waiting'}>
      {snapshot && <img src={snapshot} alt="Last snapshot" className="h-full w-full object-contain object-top opacity-60" draggable={false} />}
      <div className={`${snapshot ? 'absolute inset-x-3 bottom-3 rounded-xl border border-app-border bg-app-surface-elevated/95 shadow' : 'flex h-full flex-col justify-center'} px-4 py-3`}>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-app-primary">
          <Plug size={12} className="flex-shrink-0" aria-hidden="true" />
          This sketch uses real components
        </p>
        <p className="mt-1 text-xs leading-relaxed text-app-secondary">
          {pending
            ? 'Its code did not come from this machine, so Klose has not written it into your repo. Read the code, then accept it to run it in your app.'
            : nextToRepo
              ? `Start your dev server${devServer ? ` (${devServer})` : ''} to see it. The sandbox can't load your repo's modules.`
              : "It only renders next to the repo, through its dev server. This canvas can't reach one."}
        </p>
        <p className="mt-1 truncate font-mono text-[10.5px] text-app-muted" title={imports.join('\n')}>
          imports {named}
        </p>
        {pending && onAccept && (
          <button
            type="button"
            disabled={accepting}
            onClick={onAccept}
            className="mt-2 rounded-md border border-app-border px-2 py-1 text-xs font-medium text-app-primary hover:bg-app-surface-soft disabled:opacity-60"
          >
            {accepting ? 'Accepting…' : 'Run in my app'}
          </button>
        )}
      </div>
    </div>
  );
};

export default RealOnlyNotice;
