import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  MousePointerClick,
  MessageSquare,
  Hammer,
  Lock,
  Palette,
  FolderOpen,
  ArrowRight,
  Plus,
  Crosshair,
  Search,
  Layers,
  FileCode,
  Github,
  Moon,
  Sun,
  Loader2,
  Check,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { createProject, listProjects } from '../services/projectService';

const REPO_URL = 'https://github.com/adityakarki99/OpenKlose';

// ---------- Mini canvas (hero visual) ----------

const MiniNodeShell: React.FC<{
  name: string;
  status: 'sketch' | 'built';
  badge?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ name, status, badge, className, style, children }) => (
  <div
    className={`absolute w-56 overflow-hidden rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl ${className || ''}`}
    style={style}
  >
    <div className="flex items-center justify-between gap-2 border-b border-app-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${status === 'built' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <span className="truncate text-[11px] font-semibold text-app-primary">{name}</span>
      </div>
      {badge}
    </div>
    <div className="p-3">{children}</div>
  </div>
);

const MiniCanvas: React.FC = () => (
  <div
    className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-app-border bg-app-canvas-empty/60"
    aria-hidden
  >
    {/* dotted grid */}
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: 'radial-gradient(rgb(var(--app-grid-dot) / 0.5) 0.75px, transparent 0.75px)',
        backgroundSize: '20px 20px',
        opacity: 0.5,
      }}
    />

    {/* Sketch node — a pricing card with feedback on it */}
    <MiniNodeShell
      name="Pricing card"
      status="sketch"
      className="left-6 top-6 animate-float"
      style={{ animationDelay: '0s' }}
      badge={
        <span className="flex items-center gap-1 rounded-full bg-app-surface-muted/10 px-1.5 py-0.5 text-[9px] font-medium text-app-subtle">
          <MessageSquare size={9} /> 2
        </span>
      }
    >
      <div className="rounded-lg border border-blue-500/30 bg-app-surface p-2.5">
        <p className="text-[9px] font-medium uppercase tracking-wider text-blue-400">Pro</p>
        <p className="mt-0.5 text-sm font-bold text-app-primary">
          $29<span className="text-[10px] font-normal text-app-muted">/mo</span>
        </p>
        <div className="mt-2 space-y-1">
          <div className="h-1 w-full rounded-full bg-app-surface-muted/15" />
          <div className="h-1 w-3/4 rounded-full bg-app-surface-muted/15" />
        </div>
        <div className="mt-2.5 rounded-md bg-blue-600 py-1 text-center text-[10px] font-semibold text-white">
          Subscribe
        </div>
      </div>
    </MiniNodeShell>

    {/* Element-scoped comment chip pointing at the sketch's button */}
    <div
      className="absolute left-[60px] top-[236px] z-10 flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-200 shadow-lg animate-float"
      style={{ animationDelay: '1.2s' }}
    >
      <Crosshair size={11} /> Make the button larger
    </div>

    {/* Built node — a login form wired to a real file */}
    <MiniNodeShell
      name="Login form"
      status="built"
      className="bottom-7 right-5 animate-float"
      style={{ animationDelay: '0.6s' }}
    >
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-app-primary">Welcome back</p>
        <div className="h-5 rounded-md border border-app-border bg-app-surface" />
        <div className="h-5 rounded-md border border-app-border bg-app-surface" />
        <div className="mt-1 rounded-md bg-app-primary/90 py-1 text-center text-[10px] font-semibold text-app-bg">
          Sign in
        </div>
      </div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">
        src/components/LoginForm.tsx
      </div>
    </MiniNodeShell>
  </div>
);

// ---------- Sections ----------

const STEPS = [
  { icon: Sparkles, title: 'Ideate', body: 'Run /klose and talk it through — the agent reads your repo before it suggests anything.' },
  { icon: MousePointerClick, title: 'Preview', body: 'A real, rendered mockup lands on the canvas — not a labeled box — styled to your design system.' },
  { icon: MessageSquare, title: 'Comment', body: 'Leave feedback, or point at an exact element. Copy it back to the agent in one click.' },
  { icon: Hammer, title: 'Build', body: 'On your go-ahead, the agent writes the real component into your source tree.' },
];

const TILES = [
  {
    icon: Crosshair,
    title: 'Point at the exact element',
    body: 'Click the thing that is wrong in the live preview. The agent gets its tag, text, classes and DOM path — so "make this bigger" is never ambiguous again.',
  },
  {
    icon: Palette,
    title: 'Grounded in your design system',
    body: 'Reads your Tailwind config, tokens, and existing components before it sketches — so previews match your app instead of generic defaults.',
  },
  {
    icon: Search,
    title: 'Reuse before you build',
    body: 'Every exported component in the repo is indexed with its props and file path, and the agent has to search it first — instead of handing you a fourth Button.',
  },
  {
    icon: FileCode,
    title: 'Sketches stay linked to real code',
    body: 'A built sketch keeps the path of the file it produced. Comment on it later and the agent edits that real component and re-previews it.',
  },
  {
    icon: Layers,
    title: 'A board, not a transcript',
    body: 'Three variants side by side, a whole flow left to right, every edge state visible at once. Composition is something you see — chat scrollback cannot show it.',
  },
  {
    icon: Lock,
    title: 'Local, private, versionable',
    body: 'Runs on your machine. Projects are plain JSON in .klose/ — commit them as design history or gitignore them. No login, no cloud, no API keys.',
  },
];

const COMPARISON: { label: string; chat: string; klose: string }[] = [
  { label: 'Styling', chat: 'Generic defaults the model invents', klose: 'Your Tailwind config, tokens, and conventions' },
  { label: 'Knows your components', chat: 'No', klose: 'Yes — a searchable index the agent checks first' },
  { label: 'Feedback precision', chat: 'Describe it in prose', klose: 'Click the element; the agent gets its exact DOM path' },
  { label: 'Layout', chat: 'One thing at a time, linear', klose: 'Infinite board — variants, flows, and edge states at once' },
  { label: 'After the build', chat: 'Dead end; you copy-paste out', klose: 'Sketch stays linked to its file and keeps iterating' },
  { label: 'Where it runs', chat: 'Hosted', klose: 'Your machine; JSON in your repo' },
];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const isLight = settings.themeMode === 'light';
  const [creating, setCreating] = useState(false);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
    listProjects()
      .then((p) => setProjectCount(p.length))
      .catch(() => setProjectCount(null));
  }, []);

  const handleNewProject = async () => {
    setCreating(true);
    try {
      const project = await createProject('Untitled Project');
      navigate(`/canvas/${project.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreating(false);
      navigate('/projects');
    }
  };

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText('npm install -D klose && npx klose init');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-app-bg text-app-primary font-sans selection:bg-blue-500/30">
      {/* Top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.25)]" />
          <span className="text-lg font-bold tracking-tight">Klose</span>
        </div>
        <nav className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-app-muted transition-colors hover:text-app-primary sm:flex"
          >
            <Github size={16} /> GitHub
          </a>
          <button
            type="button"
            onClick={() => updateSettings({ themeMode: isLight ? 'dark' : 'light' })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-app-border bg-app-surface text-app-muted transition-colors hover:text-app-primary"
            aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {isLight ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            onClick={() => navigate('/projects')}
            className="rounded-lg border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-primary transition-colors hover:bg-app-surface-soft"
          >
            Open Klose
          </button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-8 md:pt-14">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div className={`transition-all duration-700 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-app-muted">
              Local · No login · No API keys
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-app-primary md:text-5xl">
              The visual surface your coding agent is missing.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-app-secondary">
              Klose is a local canvas that lives inside your coding agent. Sketch UI ideas as live
              previews grounded in your project&apos;s <em className="not-italic text-app-primary">real</em>{' '}
              design system, point at the exact element that is wrong, and let the agent build it
              into your repo — as a real file, on a real path.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={handleNewProject}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-xl bg-app-primary px-5 py-2.5 text-sm font-semibold text-app-bg transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                New project
              </button>
              <button
                onClick={() => navigate('/projects')}
                className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-surface px-5 py-2.5 text-sm font-semibold text-app-primary transition-colors hover:bg-app-surface-soft"
              >
                <FolderOpen size={16} />
                Browse projects
                {projectCount ? <span className="text-app-muted">({projectCount})</span> : null}
              </button>
            </div>

            <button
              onClick={copyInstall}
              className="group mt-6 inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-mono text-xs text-app-secondary transition-colors hover:bg-app-surface-soft"
              title="Copy install command"
            >
              <span className="text-app-subtle">$</span> npm install -D klose &amp;&amp; npx klose init
              {copied ? <Check size={13} className="text-emerald-400" /> : <span className="text-app-subtle opacity-0 transition-opacity group-hover:opacity-100">copy</span>}
            </button>
          </div>

          <div className={`transition-all delay-150 duration-700 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
            <MiniCanvas />
          </div>
        </div>
      </section>

      {/* The loop */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-app-primary">Sketch → Preview → Comment → Build</h2>
          <p className="mt-2 text-sm text-app-muted">The whole loop stays in your editor — no context-switching to a design tool.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border border-app-border bg-app-surface p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-app-primary/10 text-app-accent">
                <s.icon size={18} />
              </div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-mono text-app-subtle">0{i + 1}</span>
                <h3 className="text-sm font-semibold text-app-primary">{s.title}</h3>
              </div>
              <p className="text-xs leading-relaxed text-app-secondary">{s.body}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight size={16} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-app-border lg:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Why it's different */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-app-primary">What you don&apos;t get from a chat window</h2>
          <p className="mt-2 text-sm text-app-muted">Klose has no model of its own — your agent is the intelligence. This is the surface it was missing.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TILES.map((t) => (
            <div key={t.title} className="rounded-2xl border border-app-border bg-app-surface p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-app-primary/10 text-app-accent">
                <t.icon size={20} />
              </div>
              <h3 className="mb-2 text-base font-semibold text-app-primary">{t.title}</h3>
              <p className="text-sm leading-relaxed text-app-secondary">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Chat artifact vs Klose */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        {/* md+: a three-column table */}
        <div className="hidden overflow-hidden rounded-3xl border border-app-border bg-app-surface md:block">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] gap-px bg-app-border text-sm">
            <div className="bg-app-surface-elevated px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">
              &nbsp;
            </div>
            <div className="bg-app-surface-elevated px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">
              Generating it in chat
            </div>
            <div className="bg-app-surface-elevated px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-app-accent">
              Klose
            </div>
            {COMPARISON.map((row) => (
              <React.Fragment key={row.label}>
                <div className="bg-app-surface px-5 py-4 font-medium text-app-primary">{row.label}</div>
                <div className="bg-app-surface px-5 py-4 text-app-muted">{row.chat}</div>
                <div className="bg-app-surface px-5 py-4 text-app-secondary">{row.klose}</div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* mobile: one stacked card per row */}
        <div className="space-y-3 md:hidden">
          {COMPARISON.map((row) => (
            <div key={row.label} className="rounded-2xl border border-app-border bg-app-surface p-4">
              <p className="text-sm font-semibold text-app-primary">{row.label}</p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-app-muted">
                  <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">In chat</span>
                  {row.chat}
                </p>
                <p className="text-app-secondary">
                  <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-app-accent">Klose</span>
                  {row.klose}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-app-muted">
          A chat artifact shows you a beautiful component. Klose shows you{' '}
          <span className="text-app-primary">your</span> component — next to the other five you are
          considering, in your tokens, reusing what you already built, with a comment pinned to the
          exact element that is wrong.
        </p>
      </section>

      {/* Quick start */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="rounded-3xl border border-app-border bg-app-surface-elevated p-8 md:p-10">
          <h2 className="text-2xl font-bold tracking-tight text-app-primary">Get started in two commands</h2>
          <p className="mt-2 text-sm text-app-muted">Install it in any repo, then use it from your agent.</p>
          <div className="mt-6 space-y-3">
            <div className="rounded-xl border border-app-border bg-app-bg p-4 font-mono text-sm text-app-secondary">
              <span className="text-app-subtle select-none">$ </span>npm install -D klose
              <br />
              <span className="text-app-subtle select-none">$ </span>npx klose init
            </div>
            <div className="flex items-center gap-2 px-1 text-sm text-app-muted">
              <span>Then, in Claude Code:</span>
              <code className="rounded-md border border-app-border bg-app-surface px-2 py-0.5 text-app-primary">/klose</code>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={handleNewProject}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-xl bg-app-primary px-5 py-2.5 text-sm font-semibold text-app-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create a project
            </button>
            <a
              href={`${REPO_URL}#readme`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-surface px-5 py-2.5 text-sm font-semibold text-app-primary transition-colors hover:bg-app-surface-soft"
            >
              Read the docs <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-app-border pt-8 text-sm text-app-muted sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-app-primary/80" />
            <span>Klose — a local design-ideation canvas for coding agents.</span>
          </div>
          <div className="flex items-center gap-4">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-app-primary">
              <Github size={15} /> GitHub
            </a>
            <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="transition-colors hover:text-app-primary">
              AGPL-3.0
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
