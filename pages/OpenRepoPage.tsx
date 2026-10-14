import OnlineWorkspaces from '../components/OnlineWorkspaces';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, FolderSync, ShieldCheck, TerminalSquare } from 'lucide-react';
import {
  DirHandleLike,
  ensurePermission,
  forgetFolder,
  isFolderApiSupported,
  openSession,
  pickFolder,
  rememberFolder,
  rememberedFolder,
  useFolderSession,
} from '../lib/folderSession';

/** Where a page sent here wanted to go once a folder is open (see App.tsx). */
export const NEXT_KEY = 'klose:next';

/**
 * The hosted canvas's front door: pick the repo folder. Nothing is installed
 * and nothing runs; the page reads and writes .klose/ in the folder, and the
 * browser remembers the folder so next time it is one click.
 */
const OpenRepoPage: React.FC = () => {
  const navigate = useNavigate();
  const session = useFolderSession();
  const supported = isFolderApiSupported();
  const [remembered, setRemembered] = useState<DirHandleLike | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    rememberedFolder().then(setRemembered).catch(() => setRemembered(null));
  }, [supported]);

  const goOn = () => {
    let next = '/projects';
    try {
      next = sessionStorage.getItem(NEXT_KEY) || next;
      sessionStorage.removeItem(NEXT_KEY);
    } catch {
      // Nowhere to read it from: the files page is right anyway.
    }
    navigate(next, { replace: true });
  };

  const open = async (handle: DirHandleLike) => {
    if (!(await ensurePermission(handle))) {
      setError(`The browser didn't allow access to "${handle.name}". Choose the folder again to grant it.`);
      return;
    }
    openSession(handle);
    await rememberFolder(handle);
    goOn();
  };

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      await open(await pickFolder());
    } catch (err) {
      // Dismissing the picker is not an error.
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Could not open the folder.');
      }
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!remembered) return;
    setBusy(true);
    setError(null);
    try {
      await open(remembered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen the folder.');
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await forgetFolder();
    setRemembered(null);
  };

  const primary =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60';
  const secondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-app-border bg-app-surface px-4 py-2.5 text-sm font-medium text-app-primary transition-colors hover:border-app-border-strong hover:bg-app-surface-soft disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-app-bg px-5 py-10 text-app-primary">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.2)]" />
          <span className="font-logo text-xl font-bold tracking-tight">Klose</span>
          <span className="rounded-full border border-app-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-app-muted">hosted canvas</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Open a project</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-app-secondary">
          Point this page at the repo you design in. It reads and writes the <code className="rounded bg-app-surface-soft px-1 py-0.5 font-mono text-xs">.klose/</code> folder
          there, the same files your coding agent writes, so sketches show up here as the agent adds them. Local folders stay on your machine. Or open an online workspace below.
        </p>

        {!supported ? (
          <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-app-secondary">
            <p className="font-medium text-app-primary">This browser can't open a folder.</p>
            <p className="mt-1">
              Opening a folder from a web page works in Chrome, Edge and other Chromium browsers. In this one, run Klose next to the repo instead:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-app-surface-elevated p-3 font-mono text-xs text-app-primary">npx klose serve --open</pre>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            {remembered && !session && (
              <button type="button" className={primary} onClick={reopen} disabled={busy} data-testid="reopen-folder">
                <FolderSync size={16} />
                Reopen {remembered.name}
              </button>
            )}
            <button type="button" className={remembered && !session ? secondary : primary} onClick={choose} disabled={busy} data-testid="choose-folder">
              <FolderOpen size={16} />
              {remembered ? 'Choose another folder' : 'Choose the repo folder'}
            </button>
            {session && (
              <button type="button" className={secondary} onClick={goOn}>
                Back to {session.name}
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        {remembered && supported && (
          <p className="mt-3 text-xs text-app-muted">
            The browser remembers the folder between visits.{' '}
            <button type="button" onClick={forget} className="underline decoration-dotted underline-offset-2 hover:text-app-primary">
              Forget it
            </button>
          </p>
        )}

        <OnlineWorkspaces />

        <dl className="mt-10 grid gap-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-2 font-medium text-app-primary">
              <ShieldCheck size={15} className="text-emerald-400" /> Only .klose/
            </dt>
            <dd className="mt-1 text-app-muted">The page writes nothing else in the repo, and reads your stylesheets only to match your design tokens.</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-medium text-app-primary">
              <TerminalSquare size={15} className="text-indigo-400" /> Same files as the agent
            </dt>
            <dd className="mt-1 text-app-muted">
              <code className="font-mono text-xs">/klose</code> keeps working through the CLI. New sketches appear here within a second or two.
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-medium text-app-primary">
              <FolderSync size={15} className="text-amber-400" /> When you need it
            </dt>
            <dd className="mt-1 text-app-muted">Close the tab when you are done. There is no process to stop and nothing to update.</dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

export default OpenRepoPage;
