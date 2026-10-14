import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { githubContext, parseRepository, projectFromContext } from '../server/githubContext.js';
import { encryptBundle, makeBundle, newShareKey, parseShareUrl, shareApi, shareClient, shareUrl } from '../server/shareCore.js';
import { forgetWorkspace, recentWorkspaces, rememberWorkspace, publicContextCache } from '../lib/workspaceCache';

/** No GitHub credentials in the browser: public import here, private import via the agent CLI. */
export default function OnlineWorkspaces() {
  const navigate = useNavigate();
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(recentWorkspaces);
  const button =
    'min-h-11 rounded-lg border border-app-border px-4 py-2 text-sm font-semibold hover:bg-app-surface-soft disabled:opacity-50';
  const input = 'mt-1 min-h-11 w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-primary';
  const openGithub = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const repository = parseRepository(repo);
      const context = await githubContext(repository, { branch: branch.trim() || undefined, cache: publicContextCache });
      const existing = recentWorkspaces().find((r) => {
        try {
          const source = JSON.parse(r.source || '{}');
          return source.repository?.toLowerCase() === repository.toLowerCase() && source.branch === context.branch;
        } catch {
          return false;
        }
      });
      if (existing) {
        navigate(`/s/${existing.id}/${existing.key}`);
        return;
      }
      const project = projectFromContext(context);
      const key = newShareKey();
      const client = shareClient(shareApi(location.origin));
      const { id } = await client.create(
        await encryptBundle(key, makeBundle(project, { themeCss: context.theme.css, repoName: context.repo })),
      );
      try {
        rememberWorkspace({
          id,
          key,
          host: location.origin,
          name: project.name,
          openedAt: Date.now(),
          source: JSON.stringify(project.source),
        });
      } catch {
        /* The link still opens when device storage is unavailable. */
      }
      navigate(`/s/${id}/${key}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open project.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="online-title" className="mt-8 space-y-6 rounded-xl border border-app-border p-5">
      <h2 id="online-title" className="font-semibold">
        Open online
      </h2>
      <form onSubmit={openGithub} className="space-y-3">
        <label className="block text-sm">
          GitHub repository
          <input
            className={input}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repository"
            required
            disabled={busy}
          />
        </label>
        <label className="block text-sm">
          Branch (optional)
          <input
            className={input}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Default branch"
            disabled={busy}
          />
        </label>
        <p className="text-xs leading-relaxed text-app-muted">
          Imports a public repo’s design notes, tokens and source inventory into an encrypted online board. Anyone with its link can edit.
          No code is committed to GitHub.
        </p>
        <button className={button} disabled={busy} type="submit">
          {busy ? 'Opening project…' : 'Open GitHub repo'}
        </button>
        <details className="text-xs text-app-secondary">
          <summary className="cursor-pointer py-2">Private repo or coding agent?</summary>
          <p className="py-2">Run in your terminal with GH_TOKEN or GITHUB_TOKEN set for a private repo. Paste the resulting link below.</p>
          <pre className="overflow-x-auto rounded bg-app-surface p-3">npx klose open --repo owner/repo --online</pre>
        </details>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseShareUrl(link.trim());
          if (!parsed) {
            setError('Paste a complete Klose shared-board link.');
            return;
          }
          if (parsed.host !== location.origin) {
            setError('Open this link on the site that issued it.');
            return;
          }
          navigate(`/s/${parsed.id}/${parsed.key}`);
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          Shared board link
          <input
            className={input}
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/canvas/#/s/…"
            required
          />
        </label>
        <button className={button} type="submit">
          Open shared board
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {recent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Recent online projects</h3>
          <p className="mt-1 text-xs text-app-muted">Remembered on this browser. Links expire after 30 days without changes.</p>
          <ul className="mt-2 space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <a className="min-h-11 flex items-center text-sm underline" href={shareUrl(r.host, r.id, r.key)}>
                  {r.name}
                </a>
                <button
                  className={button}
                  onClick={() => {
                    forgetWorkspace(r.id);
                    setRecent(recentWorkspaces());
                  }}
                  aria-label={`Forget ${r.name}`}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
