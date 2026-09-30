import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, FolderDown, Loader2, MessageSquare, Plus, X } from 'lucide-react';
import { HubRepo, Project } from '../../types';
import { listProjects, saveProjectToRepo } from '../../services/projectService';
import { agentLine, getRepo } from '../../services/hubService';
import { HUB_HOME, REPO_ID } from '../../lib/repoScope';
import { AgentDot } from '../Hub/AgentDot';
import { openComments } from '../../lib/feedback.js';

export const FILE_BAR_HEIGHT = 40;

// On a hub every repo shares one origin, so each keeps its own list of tabs.
const OPEN_FILES_KEY = REPO_ID ? `klose.openFiles.${REPO_ID}` : 'klose.openFiles';

const AGENT_POLL_MS = 5000;

/** Ids of the files left open as tabs. Remembered per browser and per repo. */
function readOpenFiles(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_FILES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeOpenFiles(ids: string[]) {
  try {
    window.localStorage.setItem(OPEN_FILES_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable (private mode); tabs just won't be remembered.
  }
}

const SAVE_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

interface FileBarProps {
  projectId: string;
  /** The open file's name as it is on the canvas right now (it may not be saved yet). */
  projectName: string;
  /** Bumped by the canvas whenever project data on disk may have changed. */
  refreshKey: number;
  /** Writes pending canvas edits to disk; awaited before saving to the repo or leaving. */
  onFlush: () => Promise<void>;
  onNavigate: (path: string) => void;
  style?: React.CSSProperties;
}

/**
 * The strip above the canvas: this repo's open Klose files as tabs, and on the
 * right where the current one saves in the repo and whether that copy is
 * up to date.
 */
export const FileBar: React.FC<FileBarProps> = ({ projectId, projectName, refreshKey, onFlush, onNavigate, style }) => {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [openIds, setOpenIds] = useState<string[]>(() => {
    const ids = readOpenFiles();
    return ids.includes(projectId) ? ids : [...ids, projectId];
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => writeOpenFiles(openIds), [openIds]);

  // On a hub: which repo this canvas belongs to, and what its agent is doing.
  const [hubRepo, setHubRepo] = useState<HubRepo | null>(null);
  useEffect(() => {
    if (!REPO_ID) return;
    let cancelled = false;
    const load = () => {
      getRepo(REPO_ID!).then((r) => !cancelled && setHubRepo(r)).catch(() => {});
    };
    load();
    const timer = window.setInterval(() => document.visibilityState !== 'hidden' && load(), AGENT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Coalesced: one disk write can fire several change events.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listProjects()
        .then((list) => {
          if (cancelled) return;
          setProjects(list);
          // Forget tabs for files that were deleted.
          setOpenIds((ids) => {
            const kept = ids.filter((id) => id === projectId || list.some((p) => p.id === id));
            return kept.length === ids.length ? ids : kept;
          });
        })
        .catch(() => {
          // Keep showing the last known state; the next refresh will catch up.
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshKey, projectId]);

  const tabs = useMemo(
    () =>
      openIds
        .map((id) => {
          const project = projects?.find((p) => p.id === id);
          if (!project && id !== projectId) return null;
          const comments = (project?.nodes || []).reduce((sum, n) => sum + openComments(n.comments).length, 0);
          return {
            id,
            name: id === projectId ? projectName : project!.name,
            comments,
            changed: project?.repo?.state === 'changed',
          };
        })
        .filter(Boolean) as { id: string; name: string; comments: number; changed: boolean }[],
    [openIds, projects, projectId, projectName]
  );

  const repo = projects?.find((p) => p.id === projectId)?.repo;
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

  /** Arrow keys move between tabs, as a tablist should; Enter or Space opens one. */
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (target !== null) {
      e.preventDefault();
      tabRefs.current[target]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && tabs[index].id !== projectId) {
      e.preventDefault();
      onNavigate(`/canvas/${tabs[index].id}`);
    }
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const index = openIds.indexOf(id);
    const remaining = openIds.filter((other) => other !== id);
    setOpenIds(remaining);
    writeOpenFiles(remaining);
    if (id !== projectId) return;
    const next = remaining[Math.min(index, remaining.length - 1)];
    onNavigate(next ? `/canvas/${next}` : '/projects');
  };

  const handleSaveToRepo = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onFlush();
      const { repo: saved } = await saveProjectToRepo(projectId);
      setProjects((list) => list && list.map((p) => (p.id === projectId ? { ...p, repo: saved } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onFlush, projectId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveToRepo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveToRepo]);

  return (
    <div
      className="absolute left-0 top-0 z-30 flex items-stretch whitespace-nowrap border-b border-app-border bg-app-surface-elevated text-xs"
      style={{ height: FILE_BAR_HEIGHT, ...style }}
    >
      {hubRepo && (
        <a
          href={HUB_HOME}
          title={`${hubRepo.path} — ${agentLine(hubRepo)}. Back to all repos.`}
          className="flex shrink-0 items-center gap-2 border-r border-app-border px-3 text-app-muted transition-colors hover:text-app-primary"
        >
          <AgentDot agent={hubRepo.agent} size="sm" />
          <span className="max-w-[140px] truncate font-medium">{hubRepo.name}</span>
        </a>
      )}
      <div className="flex min-w-0 items-stretch" role="tablist" aria-label="Open Klose files">
        {tabs.map((tab, index) => {
          const active = tab.id === projectId;
          return (
            <div
              key={tab.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => !active && onNavigate(`/canvas/${tab.id}`)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              title={tab.changed ? `${tab.name} — changed since it was saved to the repo` : tab.name}
              className={`group/tab flex min-w-0 items-center gap-2 border-r border-app-border px-3 ${
                active ? 'bg-app-bg text-app-primary' : 'cursor-pointer text-app-secondary hover:text-app-primary'
              }`}
            >
              <FileText size={12} className={`shrink-0 ${active ? 'text-ceko-accent' : 'text-app-muted'}`} />
              <span className={`max-w-[200px] truncate ${active ? 'font-medium' : ''}`}>{tab.name}</span>
              {tab.comments > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-400/15 px-1 text-[11px] font-semibold text-amber-300" title={`${tab.comments} open comment${tab.comments === 1 ? '' : 's'}`}>
                  <MessageSquare size={9} />
                  {tab.comments}
                </span>
              )}
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                {/* Like an editor's unsaved dot: the repo copy is behind the canvas. */}
                {tab.changed && (
                  <span className="h-2 w-2 rounded-full bg-amber-400 group-hover/tab:hidden group-focus-within/tab:hidden" aria-label="Changed since saved to the repo" />
                )}
                <button
                  onClick={(e) => handleClose(e, tab.id)}
                  aria-label={`Close ${tab.name}`}
                  tabIndex={-1}
                  className={`rounded p-0.5 text-app-muted hover:text-app-primary ${tab.changed ? 'hidden group-hover/tab:block group-focus-within/tab:block' : ''}`}
                >
                  <X size={11} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => onNavigate('/projects')}
        title="Open another file"
        aria-label="Open another file"
        className="flex shrink-0 items-center px-2.5 text-app-muted transition-colors hover:text-app-primary"
      >
        <Plus size={13} />
      </button>

      <div className="min-w-2 flex-1" />

      <div className="flex shrink-0 items-center gap-2.5 px-3">
        {error ? (
          <span className="max-w-[260px] truncate text-xs text-red-400" title={error} role="alert">
            Couldn't save: {error}
          </span>
        ) : (
          repo?.dir && <span className="hidden font-mono text-xs text-app-muted lg:inline">{repo.dir}/</span>
        )}
        {isSaving ? (
          <span className="flex items-center gap-1.5 text-xs text-app-secondary">
            <Loader2 size={12} className="animate-spin" />
            Saving…
          </span>
        ) : repo?.state === 'saved' ? (
          <span className="flex items-center gap-1 text-xs text-emerald-300" title={`Saved to ${repo.dir}/`}>
            <Check size={12} />
            Saved · {repo.files} file{repo.files === 1 ? '' : 's'}
          </span>
        ) : (
          <>
          {repo?.state === 'changed' && (
            <span className="flex items-center gap-1.5 text-xs text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
              Changed since saved
            </span>
          )}
          <button
            onClick={handleSaveToRepo}
            title={
              repo?.state === 'changed'
                ? `The canvas changed since it was saved to ${repo.dir}/`
                : 'Write this file into the repo: a README plus one .tsx per sketch'
            }
            className="flex items-center gap-1.5 rounded-md bg-ceko-accent px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <FolderDown size={12} />
            {repo?.state === 'changed' ? 'Save changes' : 'Save to repo'}
            <span className="rounded bg-white/20 px-1 text-[10px]">{SAVE_SHORTCUT}</span>
          </button>
          </>
        )}
      </div>
    </div>
  );
};

export default FileBar;
