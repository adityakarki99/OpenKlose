import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Box, FileCode2, Copy, Check, RefreshCw, Loader2, ChevronRight, X, Blocks,
  GitBranch, FolderGit2, Eye, EyeOff, PlusSquare, ChevronDown, Sparkles, Layers,
} from 'lucide-react';
import { listComponents, getComponentSource, classifyComponents, rankComponents, rankAllRepos } from '../services/componentService';
import { listProjects, createProject, addNode } from '../services/projectService';
import { RepoComponent, ComponentIndex, ComponentRanking, ComponentRole, Project } from '../types';
import { REPO_ID } from '../lib/repoScope';

const ROLE_LABELS: Record<ComponentRole, string> = {
  primitive: 'Primitives',
  composite: 'Composites',
  screen: 'Screens',
  provider: 'Providers',
};

const VERDICTS: Record<ComponentRanking['verdict'], { title: string; body: string; tone: string }> = {
  reuse: { title: 'Something here already does this', body: 'Reuse or extend the top match instead of sketching a new one.', tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
  partial: { title: 'A partial fit', body: 'Check the top matches before deciding to build something new.', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  new: { title: 'Nothing here does this job', body: 'Sketch a new component — the closest matches are below for reference.', tone: 'border-app-border bg-app-surface-soft text-app-secondary' },
};

/** "primitive · input" — what Jev said a component is. */
const RoleBadge: React.FC<{ component: RepoComponent }> = ({ component }) =>
  component.role ? (
    <span
      className="flex-shrink-0 rounded-full border border-app-border px-1.5 py-0.5 text-[10px] font-medium text-app-muted"
      title={component.roleConfidence != null ? `Jev: ${Math.round(component.roleConfidence * 100)}% sure of the role` : undefined}
    >
      {component.role} · {component.kind}
    </span>
  ) : null;

/** A ranked component from another repo lives on that repo's page; its id is "<repo id>:<component id>". */
function ownId(c: RepoComponent): string {
  return c.repo ? c.id.slice(c.repo.id.length + 1) : c.id;
}
import Preview from '../components/Runtime/Preview';

function reuseNote(c: RepoComponent): string {
  const imp = c.isDefaultExport
    ? `import ${c.name} from '${c.importPath}';`
    : `import { ${c.name} } from '${c.importPath}';`;
  const props = c.props.length ? ` Props: ${c.props.map((p) => p.name + (p.optional ? '?' : '')).join(', ')}.` : '';
  return `Reuse the existing "${c.name}" component (${c.file}:${c.line}) instead of building a new one.\n${imp}${props}`;
}

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* blocked */ }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface-soft px-2 py-1 text-[11px] font-medium text-app-secondary transition-colors hover:bg-app-surface"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
};

// Adds the component to a project's canvas as a "built" node linking the real file.
const AddToCanvas: React.FC<{ component: RepoComponent; source: string | null }> = ({ component, source }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    if (projects === null) listProjects().then(setProjects).catch(() => setProjects([]));
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, projects]);

  const nodeFor = (): Partial<RepoComponent> & Record<string, unknown> => ({
    name: component.name,
    description: component.description || `Reused from ${component.file}`,
    notes: `Existing component pulled from ${component.file}:${component.line}.` +
      (component.props.length ? ` Props: ${component.props.map((p) => p.name + (p.optional ? '?' : '')).join(', ')}.` : ''),
    status: 'built',
    builtFilePath: component.file,
    exportName: component.name,
    code: component.previewable ? (source || '') : '',
    x: 160 + Math.round(Math.random() * 120),
    y: 140 + Math.round(Math.random() * 120),
    width: 460,
    height: 360,
  });

  const addTo = async (projectId: string) => {
    setBusy(true);
    try {
      await addNode(projectId, nodeFor() as never);
      navigate(`/canvas/${projectId}`);
    } catch { setBusy(false); }
  };

  const addToNew = async () => {
    setBusy(true);
    try {
      const p = await createProject(`${component.name} — from ${component.category}`);
      await addNode(p.id, nodeFor() as never);
      navigate(`/canvas/${p.id}`);
    } catch { setBusy(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-ceko-accent/40 bg-ceko-accent/15 px-2.5 py-1 text-[11px] font-semibold text-ceko-accent transition-colors hover:bg-ceko-accent/25 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <PlusSquare size={12} />}
        Add to canvas <ChevronDown size={11} />
      </button>
      {open && !busy && (
        <div className="absolute right-0 z-50 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-app-border bg-app-surface-elevated p-1 shadow-2xl">
          <button onClick={addToNew} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-ceko-accent hover:bg-app-surface-soft">
            <PlusSquare size={13} /> New project…
          </button>
          {projects === null ? (
            <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-app-subtle" /></div>
          ) : projects.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-app-subtle">No projects yet.</p>
          ) : (
            <>
              <div className="my-1 border-t border-app-border" />
              {projects.map((p) => (
                <button key={p.id} onClick={() => addTo(p.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs text-app-secondary hover:bg-app-surface-soft hover:text-app-primary">
                  <span className="truncate">{p.name}</span>
                  <span className="flex-shrink-0 text-[10px] text-app-subtle">{p.nodes?.length || 0}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const LivePreview: React.FC<{ component: RepoComponent; source: string | null }> = ({ component, source }) => {
  const [show, setShow] = useState(true);
  if (!component.previewable) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-app-border bg-app-bg px-3 py-3 text-xs text-app-subtle">
        <EyeOff size={14} className="flex-shrink-0" />
        Not previewable in isolation — this file imports repo-local modules that only resolve inside your app.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-app-border bg-app-bg">
      <div className="flex items-center justify-between border-b border-app-border px-3 py-1.5">
        <span className="text-[10px] font-medium text-app-subtle">Rendered in an isolated sandbox — best-effort, no props supplied.</span>
        <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-app-subtle hover:text-app-primary">
          {show ? <EyeOff size={12} /> : <Eye size={12} />} {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && (
        <div className="h-56 w-full">
          {source ? <Preview code={source} exportName={component.name} interactive={false} /> : <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-app-subtle" /></div>}
        </div>
      )}
    </div>
  );
};

const PropList: React.FC<{ props: RepoComponent['props'] }> = ({ props }) => {
  if (props.length === 0) return <p className="text-xs text-app-subtle">No typed props found.</p>;
  return (
    <div className="space-y-1">
      {props.map((p) => (
        <div key={p.name} className="flex items-baseline gap-2 text-xs">
          <code className="font-medium text-app-primary">{p.name}{p.optional ? '?' : ''}</code>
          <span className="truncate text-app-subtle">{p.type}</span>
        </div>
      ))}
    </div>
  );
};

const Detail: React.FC<{ component: RepoComponent; onClose: () => void }> = ({ component, onClose }) => {
  const [source, setSource] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  useEffect(() => {
    let alive = true;
    setSource(null); setLoadingSource(true);
    getComponentSource(component.file)
      .then((r) => { if (alive) setSource(r.source); })
      .catch(() => { if (alive) setSource('// Could not read source file.'); })
      .finally(() => { if (alive) setLoadingSource(false); });
    return () => { alive = false; };
  }, [component.file]);

  const importStmt = component.isDefaultExport
    ? `import ${component.name} from '${component.importPath}';`
    : `import { ${component.name} } from '${component.importPath}';`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-app-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Box size={16} className="flex-shrink-0 text-ceko-accent" />
            <h2 className="truncate text-lg font-semibold text-app-primary">{component.name}</h2>
            <span className="rounded-full border border-app-border bg-app-surface-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-app-subtle">{component.category}</span>
            <RoleBadge component={component} />
          </div>
          <p className="mt-1 font-mono text-xs text-app-muted">{component.file}:{component.line}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <AddToCanvas component={component} source={source} />
          <button onClick={onClose} className="rounded-lg p-1 text-app-subtle hover:bg-app-surface-muted/10 hover:text-app-primary" aria-label="Close"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5 canvas-scroll">
        {component.description && <p className="text-sm leading-relaxed text-app-secondary">{component.description}</p>}

        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Live preview</span>
          <LivePreview component={component} source={source} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Import</span>
            <CopyButton text={importStmt} label="Copy import" />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-app-border bg-app-bg px-3 py-2 font-mono text-xs text-app-secondary">{importStmt}</pre>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Props</span>
          <PropList props={component.props} />
        </div>

        <div className="rounded-lg border border-ceko-accent/25 bg-ceko-accent/5 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ceko-accent/90">Reuse in /klose</span>
            <CopyButton text={reuseNote(component)} label="Copy for agent" />
          </div>
          <p className="text-xs leading-relaxed text-app-secondary">Paste this into your coding agent so it reuses this component instead of sketching a new one.</p>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Source</span>
          <div className="overflow-hidden rounded-lg border border-app-border bg-app-bg">
            {loadingSource ? (
              <div className="flex items-center justify-center py-10 text-app-subtle"><Loader2 size={18} className="animate-spin" /></div>
            ) : (
              <pre className="max-h-[40vh] overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-app-secondary canvas-scroll">{source}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const RepoBadge: React.FC<{ index: ComponentIndex }> = ({ index }) => (
  <div className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-surface-soft px-2.5 py-1 text-xs">
    <FolderGit2 size={13} className="text-ceko-accent" />
    <span className="font-medium text-app-primary">{index.repo.name}</span>
    {index.repo.branch && (
      <span className="inline-flex items-center gap-1 text-app-subtle"><GitBranch size={11} /> {index.repo.branch}</span>
    )}
    <span className="hidden truncate font-mono text-[11px] text-app-subtle sm:inline" title={index.repo.root}>{index.repo.root}</span>
  </div>
);

const ComponentsPage: React.FC = () => {
  const [index, setIndex] = useState<ComponentIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<RepoComponent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Jev: classification (role filters, duplicates) and search by meaning.
  const [role, setRole] = useState<ComponentRole | null>(null);
  const [onlyIds, setOnlyIds] = useState<Set<string> | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyNote, setClassifyNote] = useState<string | null>(null);
  const [ranking, setRanking] = useState<ComponentRanking | null>(null);
  const [rankedFor, setRankedFor] = useState('');
  const [isRanking, setIsRanking] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [allRepos, setAllRepos] = useState(false);
  const jevAvailable = Boolean(index?.jev?.available);

  const load = async (refresh = false) => {
    try {
      refresh ? setRefreshing(true) : setIsLoading(true);
      setError(null);
      const data = await listComponents(undefined, refresh);
      setIndex(data);
    } catch (err) {
      setError('Could not scan this repo for components. Is `klose serve` running inside your project?');
      console.error(err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Arriving from another repo's search result: open the component it named.
  useEffect(() => {
    if (!index) return;
    const focus = new URLSearchParams(window.location.search).get('focus');
    const found = focus && index.components.find((c) => c.id === focus);
    if (found) setSelected(found);
  }, [index]);

  const classify = async () => {
    setClassifying(true);
    setClassifyNote(null);
    try {
      const summary = await classifyComponents();
      const failed = summary.failed ? ` ${summary.failed} failed${summary.error ? ` (${summary.error})` : ''}.` : '';
      setClassifyNote(`Classified ${summary.classified} new component${summary.classified === 1 ? '' : 's'}.${failed}`);
      await load();
    } catch (err) {
      setClassifyNote(err instanceof Error ? err.message : 'Classification failed');
    } finally {
      setClassifying(false);
    }
  };

  const askJev = async () => {
    const need = query.trim();
    if (!need || isRanking) return;
    setIsRanking(true);
    setRankError(null);
    try {
      setRanking(await (allRepos ? rankAllRepos(need) : rankComponents(need)));
      setRankedFor(need);
    } catch (err) {
      setRankError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsRanking(false);
    }
  };

  const clearRanking = () => {
    setRanking(null);
    setRankedFor('');
    setRankError(null);
  };

  const openResult = (c: RepoComponent) => {
    if (c.repo && c.repo.id !== REPO_ID) {
      window.location.assign(`/r/${c.repo.id}/components?focus=${encodeURIComponent(ownId(c))}`);
      return;
    }
    setSelected(index?.components.find((x) => x.id === ownId(c)) || c);
  };

  const roles = useMemo(() => {
    const counts = new Map<ComponentRole, number>();
    for (const c of index?.components || []) if (c.role) counts.set(c.role, (counts.get(c.role) || 0) + 1);
    return (Object.keys(ROLE_LABELS) as ComponentRole[]).filter((r) => counts.has(r)).map((r) => ({ role: r, count: counts.get(r)! }));
  }, [index]);

  const categories = useMemo(() => {
    if (!index) return [];
    const counts = new Map<string, number>();
    for (const c of index.components) counts.set(c.category, (counts.get(c.category) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [index]);

  const filtered = useMemo(() => {
    if (!index) return [];
    // A ranking already answered the query, in its own order.
    if (ranking) {
      return ranking.ranked.slice(0, 12).filter((c) => (!role || c.role === role) && (!category || c.repo || c.category === category));
    }
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return index.components.filter((c) => {
      if (onlyIds && !onlyIds.has(c.id)) return false;
      if (role && c.role !== role) return false;
      if (category && c.category !== category) return false;
      if (terms.length === 0) return true;
      const hay = `${c.name} ${c.file} ${c.category} ${c.description} ${c.role || ''} ${c.kind || ''} ${c.props.map((p) => p.name).join(' ')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [index, query, category, role, onlyIds, ranking]);

  const unclassified = index ? index.count - (index.classified || 0) : 0;

  return (
    <div className="flex h-full overflow-hidden bg-app-bg font-sans text-app-primary selection:bg-ceko-accent/30">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-app-border px-8 pt-8 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-app-primary">
                <Blocks size={22} className="text-ceko-accent" /> Components
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {index && <RepoBadge index={index} />}
                <span className="text-sm text-app-muted">
                  {index ? `${index.count} components — search and reuse instead of rebuilding.` : 'Your repo’s real components.'}
                </span>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
            {jevAvailable && unclassified > 0 && (
              <button
                onClick={classify}
                disabled={classifying}
                className="inline-flex items-center gap-2 rounded-lg border border-ceko-accent/40 bg-ceko-accent/15 px-3 py-2 text-xs font-semibold text-ceko-accent transition-colors hover:bg-ceko-accent/25 disabled:opacity-60"
                title={`Ask Jev what each of the ${unclassified} unclassified components is: one request each, sending names, paths, props and doc comments — no source code`}
              >
                {classifying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {classifying ? `Classifying ${unclassified}…` : `Classify ${unclassified} with Jev`}
              </button>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-app-border bg-app-surface-soft px-3 py-2 text-xs font-medium text-app-secondary transition-colors hover:bg-app-surface disabled:opacity-50"
              title="Re-scan the repository"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Rescan
            </button>
            </div>
          </div>

          <div className="relative mt-4">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (ranking) clearRanking();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && jevAvailable) askJev();
              }}
              placeholder={jevAvailable ? 'Search by name, or describe what you need and press Enter to ask Jev…' : 'Search by name, file, prop, or description…'}
              className={`w-full rounded-xl border border-app-border bg-app-surface py-2.5 pl-10 text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-ceko-accent/60 ${jevAvailable ? 'pr-44' : 'pr-3'}`}
            />
            {jevAvailable && (
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
                {REPO_ID && (
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-app-muted" title="Search every repo the hub knows about">
                    <input type="checkbox" checked={allRepos} onChange={(e) => { setAllRepos(e.target.checked); clearRanking(); }} className="accent-blue-500" />
                    All repos
                  </label>
                )}
                <button
                  onClick={askJev}
                  disabled={!query.trim() || isRanking}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ceko-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                  title="Rank components by how well they fit what you described (one Jev request; no source code is sent)"
                >
                  {isRanking ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Ask Jev
                </button>
              </div>
            )}
          </div>
          {!jevAvailable && index && (
            <p className="mt-2 text-[11px] text-app-subtle">
              Set <code className="font-mono">TYPESAFE_API_KEY</code> before starting Klose to sort these by role and search them by meaning with Jev.
            </p>
          )}
          {classifyNote && <p className="mt-2 text-[11px] text-app-muted">{classifyNote}</p>}

          {roles.length > 0 && !onlyIds && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">Role</span>
              <button onClick={() => setRole(null)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${role === null ? 'border-ceko-accent/50 bg-ceko-accent/15 text-ceko-accent' : 'border-app-border text-app-muted hover:text-app-primary'}`}>All</button>
              {roles.map((r) => (
                <button key={r.role} onClick={() => setRole(role === r.role ? null : r.role)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${role === r.role ? 'border-ceko-accent/50 bg-ceko-accent/15 text-ceko-accent' : 'border-app-border text-app-muted hover:text-app-primary'}`}>
                  {ROLE_LABELS[r.role]} <span className="opacity-60">{r.count}</span>
                </button>
              ))}
            </div>
          )}

          {categories.length > 0 && !onlyIds && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {roles.length > 0 && <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">Folder</span>}
              <button onClick={() => setCategory(null)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${category === null ? 'border-ceko-accent/50 bg-ceko-accent/15 text-ceko-accent' : 'border-app-border text-app-muted hover:text-app-primary'}`}>All</button>
              {categories.map((cat) => (
                <button key={cat.name} onClick={() => setCategory(category === cat.name ? null : cat.name)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${category === cat.name ? 'border-ceko-accent/50 bg-ceko-accent/15 text-ceko-accent' : 'border-app-border text-app-muted hover:text-app-primary'}`}>
                  {cat.name} <span className="opacity-60">{cat.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 canvas-scroll">
          {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

          {rankError && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">Jev couldn't search: {rankError}</div>}

          {ranking && (
            <div className={`mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 ${VERDICTS[ranking.verdict].tone}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles size={14} className="flex-shrink-0" />
                  {VERDICTS[ranking.verdict].title}
                  <span className="text-[11px] font-normal opacity-70">fit {Math.round(ranking.exists * 100)}%</span>
                </div>
                <p className="mt-0.5 text-xs text-app-secondary">
                  {VERDICTS[ranking.verdict].body} Ranked for “{rankedFor}”{allRepos ? ' across every repo' : ''}
                  {ranking.considered < ranking.total ? ` (the ${ranking.considered} of ${ranking.total} components closest to its words)` : ''}.
                </p>
              </div>
              <button onClick={clearRanking} className="flex-shrink-0 rounded-md p-1 text-app-subtle hover:text-app-primary" aria-label="Clear the search"><X size={14} /></button>
            </div>
          )}

          {!ranking && index?.duplicates && index.duplicates.length > 0 && (
            <div className="mb-4 rounded-xl border border-app-border bg-app-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold text-app-primary">
                  <Layers size={13} className="text-amber-500" />
                  Primitives that may do the same job
                </span>
                {onlyIds && <button onClick={() => setOnlyIds(null)} className="text-[11px] text-app-muted hover:text-app-primary">Show all</button>}
              </div>
              <p className="mt-0.5 text-[11px] text-app-muted">Worth a look before adding another — or a sign the design system has split.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {index.duplicates.map((d) => (
                  <button
                    key={d.kind}
                    onClick={() => setOnlyIds(new Set(d.components.map((c) => c.id)))}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500 transition-colors hover:bg-amber-500/20"
                  >
                    <span className="font-semibold">{d.kind}</span> · {d.components.map((c) => c.name).join(', ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-28 rounded-xl bg-app-surface animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-app-border bg-app-surface"><Box size={26} className="text-app-subtle" /></div>
              <h2 className="text-base font-semibold text-app-primary">{index && index.count === 0 ? 'No components found in this repo yet.' : 'No components match your search.'}</h2>
              <p className="mt-1 max-w-sm text-sm text-app-muted">{index && index.count === 0 ? 'Klose scans .tsx / .jsx files for exported components. Once your repo has some, they’ll appear here.' : 'Try a different name, prop, or clear the filters.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => (
                <button key={c.id} onClick={() => openResult(c)} className={`group flex flex-col rounded-xl border bg-app-surface p-4 text-left transition-all hover:border-ceko-accent/50 hover:shadow-lg ${selected?.id === ownId(c) && !(c.repo && c.repo.id !== REPO_ID) ? 'border-ceko-accent/60 ring-1 ring-ceko-accent/30' : 'border-app-border'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Box size={15} className="flex-shrink-0 text-ceko-accent" />
                      <span className="truncate text-sm font-semibold text-app-primary">{c.name}</span>
                      {c.previewable && <span className="flex-shrink-0 text-emerald-400" title="Previewable in isolation"><Eye size={12} /></span>}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {c.relevance != null && (
                        <span className="rounded-md bg-ceko-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ceko-accent" title="How well Jev thinks this fits what you described">
                          {Math.round(c.relevance * 100)}%
                        </span>
                      )}
                      <ChevronRight size={14} className="text-app-subtle transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-app-muted">
                    <FileCode2 size={11} className="flex-shrink-0" />
                    <span className="truncate">{c.repo && c.repo.id !== REPO_ID ? `${c.repo.name}: ` : ''}{c.file}</span>
                  </div>
                  {c.role && <div className="mt-1.5"><RoleBadge component={c} /></div>}
                  {c.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-app-secondary">{c.description}</p>}
                  {c.props.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {c.props.slice(0, 4).map((p) => <span key={p.name} className="rounded border border-app-border px-1.5 py-0.5 text-[10px] font-medium text-app-subtle">{p.name}</span>)}
                      {c.props.length > 4 && <span className="rounded px-1.5 py-0.5 text-[10px] text-app-subtle">+{c.props.length - 4}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="hidden w-[440px] flex-shrink-0 border-l border-app-border bg-app-surface-elevated lg:block">
          <Detail component={selected} onClose={() => setSelected(null)} />
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 bg-app-surface-elevated lg:hidden">
          <Detail component={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
};

export default ComponentsPage;
