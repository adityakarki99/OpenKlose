import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, LayoutGrid, MessageSquare } from 'lucide-react';
import { HubRepo } from '../../types';
import { getRepo, listRepos } from '../../services/hubService';
import { HUB_HOME, REPO_ID, repoHref } from '../../lib/repoScope';
import { AgentDot } from './AgentDot';

const POLL_MS = 5000;

const Item: React.FC<{ repo: HubRepo }> = ({ repo }) => {
  const current = repo.id === REPO_ID;
  return (
    <a
      href={repoHref(repo.id)}
      className={`mx-1.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${current ? 'bg-app-surface-soft' : 'hover:bg-app-surface-soft/60'}`}
    >
      <AgentDot agent={repo.agent} size="sm" />
      <span className={`min-w-0 flex-1 truncate font-medium ${repo.agent ? 'text-app-primary' : 'text-app-muted'}`}>
        {repo.name}
        {repo.branch && <span className="ml-2 text-[11px] font-normal text-app-subtle">{repo.branch}</span>}
      </span>
      {repo.comments > 0 && (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
          <MessageSquare size={10} />
          {repo.comments}
        </span>
      )}
      {current && <Check size={13} className="shrink-0 text-ceko-accent" />}
    </a>
  );
};

const Section = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">{children}</div>
);

/**
 * On a hub, the navbar names the repo you're in and lets you jump to another.
 * Renders nothing on a per-repo server, where there is only one.
 */
export const RepoSwitcher: React.FC = () => {
  const [current, setCurrent] = useState<HubRepo | null>(null);
  const [repos, setRepos] = useState<HubRepo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the pill's agent dot current.
  useEffect(() => {
    if (!REPO_ID) return;
    let cancelled = false;
    const load = () => {
      getRepo(REPO_ID!).then((r) => !cancelled && setCurrent(r)).catch(() => {});
    };
    load();
    const timer = window.setInterval(() => document.visibilityState !== 'hidden' && load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    listRepos().then(setRepos).catch(() => setRepos([]));
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // ⌘K / Ctrl+K opens the switcher from anywhere on the page.
  useEffect(() => {
    if (!REPO_ID) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!REPO_ID) return null;

  const q = query.trim().toLowerCase();
  const shown = (repos || []).filter((r) => !q || `${r.name} ${r.branch || ''}`.toLowerCase().includes(q));
  const live = shown.filter((r) => r.agent);
  const rest = shown.filter((r) => !r.agent);

  return (
    <div ref={rootRef} className="relative flex items-center gap-3">
      <span className="text-app-subtle">/</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[260px] items-center gap-2 rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-sm transition-colors hover:border-app-border-strong"
      >
        <AgentDot agent={current?.agent ?? null} size="sm" />
        <span className="truncate font-semibold text-app-primary">{current?.name || 'Repo'}</span>
        {current?.branch && (
          <span className="hidden min-w-0 items-center gap-1 text-[11px] text-app-subtle md:flex">
            <GitBranch size={10} className="shrink-0" />
            <span className="max-w-[90px] truncate">{current.branch}</span>
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-app-subtle" />
      </button>

      {open && (
        <div className="absolute left-4 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Switch repo…"
            aria-label="Filter repos"
            className="w-full border-b border-app-border bg-transparent px-3.5 py-2.5 text-sm text-app-primary placeholder:text-app-subtle focus:outline-none"
          />
          <div className="max-h-[50vh] overflow-y-auto pb-1.5">
            {repos === null ? (
              <div className="px-3.5 py-3 text-xs text-app-muted">Loading…</div>
            ) : shown.length === 0 ? (
              <div className="px-3.5 py-3 text-xs text-app-muted">No repo matches.</div>
            ) : (
              <>
                {live.length > 0 && <Section>Live agents</Section>}
                {live.map((r) => <Item key={r.id} repo={r} />)}
                {rest.length > 0 && <Section>Recent</Section>}
                {rest.map((r) => <Item key={r.id} repo={r} />)}
              </>
            )}
          </div>
          <a
            href={HUB_HOME}
            className="flex items-center gap-2 border-t border-app-border px-3.5 py-2 text-xs text-app-muted transition-colors hover:text-app-primary"
          >
            <LayoutGrid size={12} />
            All repos
          </a>
        </div>
      )}
    </div>
  );
};

export default RepoSwitcher;
