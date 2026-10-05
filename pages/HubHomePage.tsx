import React, { useEffect, useMemo, useState } from 'react';
import { FileText, GitBranch, Layers, MessageSquare, Moon, Search, Settings2, Sun } from 'lucide-react';
import { HubRepo } from '../types';
import { agentLine, getSetup, listRepos, sinceShort } from '../services/hubService';
import { repoHref } from '../lib/repoScope';
import { useSettings } from '../contexts/SettingsContext';
import { AgentDot } from '../components/Hub/AgentDot';
import { SuggestedPrompts } from '../components/Hub/SuggestedPrompts';

const POLL_MS = 5000;

const COLUMNS = 'grid grid-cols-[12px_minmax(0,1fr)_52px_52px_56px_64px] items-center gap-x-4';

const Count = ({ icon: Icon, value, title }: { icon: React.ElementType; value: number; title: string }) => (
  <span className="flex items-center justify-end gap-1 text-xs tabular-nums text-app-muted" title={title}>
    <Icon size={12} className="text-app-subtle" />
    {value}
  </span>
);

const RepoRow: React.FC<{ repo: HubRepo }> = ({ repo }) => (
  <a
    href={repoHref(repo.id)}
    className={`${COLUMNS} rounded-xl border px-4 py-2.5 transition-colors duration-200 ${
      repo.agent === 'working'
        ? 'border-blue-500/30 bg-blue-500/[0.06] hover:border-blue-500/50'
        : 'border-app-border bg-app-surface hover:border-app-border-strong'
    }`}
  >
    <AgentDot agent={repo.agent} />
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold text-app-primary">{repo.name}</span>
        {repo.branch && (
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-app-subtle">
            <GitBranch size={10} className="shrink-0" />
            <span className="truncate">{repo.branch}</span>
          </span>
        )}
      </div>
      <div className="truncate text-xs text-app-subtle">
        <span className={repo.agent ? 'text-app-muted' : ''}>{agentLine(repo)}</span> · {repo.path}
      </div>
    </div>
    {repo.files > 0 ? (
      <>
        <Count icon={FileText} value={repo.files} title={`${repo.files} Klose file${repo.files === 1 ? '' : 's'}`} />
        <Count icon={Layers} value={repo.sketches} title={`${repo.sketches} sketch${repo.sketches === 1 ? '' : 'es'}`} />
      </>
    ) : (
      <span className="col-span-2 text-right text-xs text-app-subtle">No files yet</span>
    )}
    <span className="flex justify-end">
      {repo.comments > 0 ? (
        <span
          className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500"
          title={`${repo.comments} comment${repo.comments === 1 ? '' : 's'} waiting for the agent`}
        >
          <MessageSquare size={11} />
          {repo.comments}
        </span>
      ) : (
        <span className="text-xs text-app-subtle">—</span>
      )}
    </span>
    <span className="text-right text-xs tabular-nums text-app-subtle">{sinceShort(repo.lastActive)}</span>
  </a>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-app-subtle">{children}</div>
);

/**
 * The hub's front page: every repo Klose found on this machine, the ones with
 * a coding agent in them first. Nothing here is set up per repo — the list
 * comes from Claude Code's own session files.
 */
const HubHomePage: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const isLightMode = settings.themeMode === 'light';
  const [repos, setRepos] = useState<HubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Until setup is finished (or skipped), the hub's front door is setup.
  useEffect(() => {
    getSetup()
      .then((s) => {
        if (!s.onboarding.completed) window.location.replace('/welcome');
      })
      .catch(() => {});
  }, []);

  // Agent state changes on its own schedule, so this page asks again every
  // few seconds — but only while someone is looking at it.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      listRepos()
        .then((list) => {
          if (cancelled) return;
          setRepos(list);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load repos');
        });
    };
    const poll = () => document.visibilityState !== 'hidden' && load();
    load();
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos || []).filter((r) => !q || `${r.name} ${r.path} ${r.branch || ''} ${r.session?.name || ''}`.toLowerCase().includes(q));
  }, [repos, query]);
  const live = shown.filter((r) => r.agent);
  const rest = shown.filter((r) => !r.agent);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app-bg font-sans text-app-primary selection:bg-ceko-accent/30">
      <div className="flex items-center justify-between border-b border-app-border bg-app-surface-elevated px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.2)]" />
          <span className="font-logo text-lg font-bold tracking-tight text-app-primary">Klose</span>
          <span className="rounded-md border border-app-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-app-muted">hub</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/welcome"
            className="flex h-10 items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-3.5 text-xs font-medium text-app-muted transition-all duration-200 hover:bg-app-surface-soft hover:text-app-primary"
            title="Run setup again"
          >
            <Settings2 size={14} />
            Setup
          </a>
          <button
            type="button"
            onClick={() => updateSettings({ themeMode: isLightMode ? 'dark' : 'light' })}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted transition-all duration-200 hover:bg-app-surface-soft hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            title={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-12 pt-8 md:px-12 canvas-scroll">
        <div className="mx-auto min-w-[560px] max-w-4xl">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-app-primary">Repos on this machine</h1>
              <p className="mt-1 text-sm text-app-muted">Found from Claude Code sessions. Nothing to install per repo.</p>
            </div>
            <label className="flex h-9 w-56 items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 text-sm text-app-muted focus-within:border-ceko-accent/60">
              <Search size={14} className="shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter repos"
                aria-label="Filter repos"
                className="w-full bg-transparent text-app-primary placeholder:text-app-subtle focus:outline-none"
              />
            </label>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400" role="alert">
              {error}
            </div>
          )}

          {repos === null && !error ? (
            <div className="space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[58px] animate-pulse rounded-xl bg-ceko-surface" />
              ))}
            </div>
          ) : repos && repos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-app-border p-10 text-center">
              <h2 className="text-lg font-semibold text-app-primary">No repos found yet.</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-app-muted">
                Open Claude Code in a repo and it appears here on its own. To list one by hand, run{' '}
                <code className="font-mono text-app-secondary">klose hub add</code> inside it.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-app-muted">No repo matches “{query}”.</p>
          ) : (
            <>
              {live.length > 0 && (
                <div className="mb-6">
                  <SectionLabel>Live agents · {live.length}</SectionLabel>
                  <div className="space-y-1.5">{live.map((r) => <RepoRow key={r.id} repo={r} />)}</div>
                </div>
              )}
              {rest.length > 0 && (
                <div>
                  <SectionLabel>Recent · {rest.length}</SectionLabel>
                  <div className="space-y-1.5">{rest.map((r) => <RepoRow key={r.id} repo={r} />)}</div>
                </div>
              )}
              <p className="mt-6 rounded-lg border border-app-border px-3 py-2 text-xs leading-relaxed text-app-muted">
                Klose only reads <code className="font-mono text-app-secondary">~/.claude</code> to build this list. It writes
                into a repo's <code className="font-mono text-app-secondary">.klose/</code> once you sketch there, not before.
              </p>
            </>
          )}

          {repos !== null && (
            <div className="mt-10">
              <SectionLabel>Try in Claude Code</SectionLabel>
              <p className="mb-2 text-xs text-app-muted">Open Claude Code in one of these repos and paste one of these. Click to copy.</p>
              <SuggestedPrompts compact />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HubHomePage;
