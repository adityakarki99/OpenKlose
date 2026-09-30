import React, { useEffect, useState } from 'react';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import { HubRepo, TrayState } from '../types';
import { agentLine, getTray } from '../services/hubService';
import { HUB_HOME, repoHref } from '../lib/repoScope';
import { AgentDot } from '../components/Hub/AgentDot';

const POLL_MS = 5000;
/** Repos without an agent shown under the live ones; the rest are one click away. */
const MAX_RECENT = 4;

function summary(tray: TrayState): string {
  const agents = tray.agents ? `${tray.agents} agent${tray.agents === 1 ? '' : 's'}` : 'No agents running';
  if (!tray.comments) return agents;
  return `${agents} · ${tray.comments} comment${tray.comments === 1 ? '' : 's'} waiting`;
}

const Row: React.FC<{ repo: HubRepo }> = ({ repo }) => (
  <a href={repoHref(repo.id)} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-app-surface-soft/60">
    <AgentDot agent={repo.agent} size="sm" />
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <span className={`max-w-[60%] shrink-0 truncate text-[13px] font-semibold ${repo.agent ? 'text-app-primary' : 'text-app-secondary'}`}>{repo.name}</span>
        {repo.branch && <span className="min-w-0 truncate text-[11px] text-app-subtle">{repo.branch}</span>}
      </div>
      <div className="truncate text-[11px] text-app-muted">{agentLine(repo)}</div>
    </div>
    {repo.comments > 0 && (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500"
        title={`${repo.comments} comment${repo.comments === 1 ? '' : 's'} waiting for the agent`}
      >
        <MessageSquare size={11} />
        {repo.comments}
      </span>
    )}
    <ArrowUpRight size={13} className="shrink-0 text-app-subtle opacity-0 transition-opacity group-hover:opacity-100" />
  </a>
);

/**
 * The menu bar popover: which repos have an agent, what is waiting for one,
 * and a way into each canvas. Served by the hub at /tray so any shell can
 * host it — the macOS menu bar app shows this page in its popover and opens
 * every link in the default browser.
 */
const TrayPage: React.FC = () => {
  const [tray, setTray] = useState<TrayState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTray()
        .then((t) => {
          if (cancelled) return;
          setTray(t);
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const live = tray?.repos.filter((r) => r.agent) || [];
  const recent = (tray?.repos.filter((r) => !r.agent) || []).slice(0, MAX_RECENT);
  const hidden = tray ? tray.repos.length - live.length - recent.length : 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app-surface-elevated font-sans text-app-primary selection:bg-ceko-accent/30">
      <div className="flex items-center gap-2 border-b border-app-border px-3.5 py-2.5">
        <div className="h-4 w-4 shrink-0 rounded-full bg-app-primary" />
        <span className="font-logo text-[13px] font-bold tracking-tight">Klose</span>
        <span className="truncate text-[11px] text-app-muted">{tray ? summary(tray) : failed ? 'Hub not reachable' : 'Loading…'}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1 canvas-scroll">
        {tray && tray.repos.length === 0 && (
          <p className="px-3.5 py-6 text-center text-xs leading-relaxed text-app-muted">
            No repos yet. Open Claude Code in one and it shows up here.
          </p>
        )}
        {live.map((r) => <Row key={r.id} repo={r} />)}
        {live.length > 0 && recent.length > 0 && (
          <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">Recent</div>
        )}
        {recent.map((r) => <Row key={r.id} repo={r} />)}
      </div>

      <div className="flex items-center justify-between border-t border-app-border bg-app-bg px-3.5 py-2">
        <span className="text-[11px] text-app-subtle">{hidden > 0 ? `+${hidden} more repo${hidden === 1 ? '' : 's'}` : 'Watching ~/.claude/sessions'}</span>
        <a href={HUB_HOME} className="rounded-md bg-ceko-accent px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-500">
          Open canvas
        </a>
      </div>
    </div>
  );
};

export default TrayPage;
