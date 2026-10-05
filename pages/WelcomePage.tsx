import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, FolderPlus, Loader2, Lock, MousePointerClick, Sparkles, Terminal } from 'lucide-react';
import { SetupState } from '../types';
import { addRepoFolder, finishSetup, getSetup, installSkills } from '../services/hubService';
import { HUB_HOME } from '../lib/repoScope';
import { AgentDot } from '../components/Hub/AgentDot';
import { SuggestedPrompts } from '../components/Hub/SuggestedPrompts';

const STEPS = ['welcome', 'repos', 'skill', 'ready'] as const;
type Step = (typeof STEPS)[number];

/**
 * Set when the desktop app shows this page (it opens /welcome?shell=desktop).
 * The app is then the menu bar icon and owns its login item, so the last step
 * only asks about starting at login, and the app applies the answer.
 */
const IN_DESKTOP_APP = new URLSearchParams(window.location.search).get('shell') === 'desktop';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  hint,
  disabled,
}) => (
  <label className={`flex items-start justify-between gap-4 rounded-xl border border-app-border bg-app-surface px-4 py-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <span>
      <span className="block text-sm font-medium text-app-primary">{label}</span>
      <span className="block text-xs text-app-muted">{hint}</span>
    </span>
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden
      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ceko-accent/50 ${
        checked ? 'bg-ceko-accent' : 'bg-app-surface-soft'
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </span>
  </label>
);

const StatusLine: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <div className="flex items-start gap-2.5 text-sm">
    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-400/15 text-amber-500'}`}>
      {ok ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={10} strokeWidth={2.5} />}
    </span>
    <span className="text-app-secondary">{children}</span>
  </div>
);

// ---------------------------------------------------------------- steps

const WelcomeStep: React.FC = () => (
  <div className="flex flex-col items-center text-center">
    <div className="mb-6 h-14 w-14 rounded-full bg-app-primary shadow-[0_0_40px_rgba(59,130,246,0.25)]" />
    <h1 className="text-3xl font-bold tracking-tight text-app-primary">The canvas your coding agent is missing.</h1>
    <p className="mt-3 max-w-md text-sm leading-relaxed text-app-muted">
      Sketch UI as live previews in your repo's real design system, point at exactly what's wrong, and let the agent build it.
    </p>
    <div className="mt-8 grid w-full max-w-lg grid-cols-3 gap-3 text-left">
      {[
        { icon: Sparkles, title: 'Sketch', body: 'Your agent puts rendered ideas on a canvas.' },
        { icon: MousePointerClick, title: 'Point', body: 'Click an element and say what to change.' },
        { icon: Terminal, title: 'Build', body: 'The agent writes the real file in your repo.' },
      ].map(({ icon: Icon, title, body }) => (
        <div key={title} className="rounded-xl border border-app-border bg-app-surface p-3">
          <Icon size={16} className="mb-2 text-ceko-accent" />
          <div className="text-sm font-semibold text-app-primary">{title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-app-muted">{body}</div>
        </div>
      ))}
    </div>
    <p className="mt-8 flex items-center gap-1.5 text-xs text-app-subtle">
      <Lock size={12} />
      Runs on this machine. No account, no cloud, no AI model of its own.
    </p>
  </div>
);

const ReposStep: React.FC<{ state: SetupState; onChange: (s: SetupState) => void }> = ({ state, onChange }) => {
  const [folder, setFolder] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { claudeCode, repos } = state;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addRepoFolder(folder);
      onChange(result.state);
      const name = result.root.split(/[\\/]/).pop();
      setNotice(result.added ? `Added ${name}.` : `${name} is already listed.`);
      setFolder('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that folder');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-app-primary">Where you work</h1>
      <p className="mt-1 text-sm text-app-muted">Klose finds your repos from Claude Code's own session files. Nothing is installed in them.</p>

      <div className="mt-6 space-y-2">
        {claudeCode.found ? (
          <StatusLine ok>
            Claude Code found at <code className="font-mono text-app-primary">{claudeCode.dir}</code>
            {' · '}
            {claudeCode.sessions ? `${plural(claudeCode.sessions, 'session')} open, ` : ''}
            {plural(claudeCode.recentFolders, 'folder')} used in the last 2 weeks
          </StatusLine>
        ) : (
          <StatusLine ok={false}>
            Claude Code isn't on this machine yet (looked in <code className="font-mono">{claudeCode.dir}</code>).{' '}
            <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="text-ceko-accent hover:underline">
              Install it
            </a>
            , or add a repo by hand below.
          </StatusLine>
        )}
      </div>

      <div className="mt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-app-subtle">Repos found · {repos.length}</div>
      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto canvas-scroll">
        {repos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-app-border px-4 py-6 text-center text-sm text-app-muted">
            Nothing yet. Repos show up once Claude Code has run in them, or add one below.
          </p>
        ) : (
          repos.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-app-border bg-app-surface px-3 py-2">
              <AgentDot agent={r.agent} size="sm" />
              <span className="truncate text-sm font-medium text-app-primary">{r.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-app-subtle">{r.path}</span>
              {r.files > 0 && <span className="shrink-0 text-xs text-app-muted">{plural(r.files, 'file')}</span>}
            </div>
          ))
        )}
      </div>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="~/code/my-app"
          aria-label="Path of a repo to add"
          className="h-9 flex-1 rounded-lg border border-app-border bg-app-surface px-3 font-mono text-sm text-app-primary placeholder:text-app-subtle focus:border-ceko-accent/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!folder.trim() || adding}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-app-border px-3 text-sm font-medium text-app-secondary transition-colors hover:bg-app-surface-soft disabled:opacity-50"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
          Add repo
        </button>
      </form>
      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      {notice && !error && <p className="mt-2 text-xs text-app-muted">{notice}</p>}
    </div>
  );
};

const SkillStep: React.FC<{ state: SetupState; onChange: (s: SetupState) => void }> = ({ state, onChange }) => {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { skills } = state;
  const edited = skills.list.filter((s) => s.state === 'edited');

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      onChange(await installSkills());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-app-primary">Teach Claude Code /klose</h1>
      <p className="mt-1 text-sm text-app-muted">
        One skill, installed once in <code className="font-mono text-app-secondary">{skills.dir}</code>, works in every repo. It tells the agent how to
        put sketches on the canvas and read your comments.
      </p>

      <div className="mt-6 space-y-1.5">
        {skills.list.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-lg border border-app-border bg-app-surface px-3 py-2">
            <code className="font-mono text-sm text-app-primary">/{s.name}</code>
            <span
              className={`text-xs ${
                s.state === 'current' ? 'text-emerald-400' : s.state === 'edited' ? 'text-app-muted' : 'text-amber-500'
              }`}
            >
              {{ current: 'Installed', edited: 'Installed (your edits kept)', outdated: 'Update available', missing: 'Not installed' }[s.state]}
            </span>
          </div>
        ))}
      </div>

      {skills.installed ? (
        <div className="mt-5 space-y-2">
          <StatusLine ok>Installed. Claude Code sessions you start from now on have /klose.</StatusLine>
          <p className="pl-6 text-xs text-app-subtle">Sessions already open pick it up after a restart.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={install}
          disabled={installing}
          className="mt-5 flex items-center gap-2 rounded-lg bg-ceko-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
        >
          {installing && <Loader2 size={14} className="animate-spin" />}
          {skills.list.some((s) => s.state === 'outdated') ? 'Update the skills' : 'Install for every repo'}
        </button>
      )}
      {edited.length > 0 && (
        <p className="mt-3 text-xs text-app-subtle">
          You've edited {edited.map((s) => `/${s.name}`).join(', ')}, so Klose leaves {edited.length === 1 ? 'it' : 'them'} alone.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

const ReadyStep: React.FC<{
  state: SetupState;
  menuBar: boolean;
  startAtLogin: boolean;
  setMenuBar: (v: boolean) => void;
  setStartAtLogin: (v: boolean) => void;
}> = ({ state, menuBar, startAtLogin, setMenuBar, setStartAtLogin }) => {
  const { menuBar: mb } = state;

  return (
    <div>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check size={20} strokeWidth={2.5} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-app-primary">Ready</h1>
      <p className="mt-1 text-sm text-app-muted">
        {plural(state.repos.length, 'repo')} on the canvas
        {state.skills.installed ? ', and /klose is installed for all of them.' : '. Install /klose from the last step whenever you like.'}
      </p>

      {IN_DESKTOP_APP && (
        <div className="mt-6 space-y-2">
          <Toggle
            checked={startAtLogin}
            onChange={setStartAtLogin}
            label="Start Klose at login"
            hint="Klose stays in your menu bar and starts the canvas for you."
          />
        </div>
      )}

      {mb.supported && !IN_DESKTOP_APP && (
        <div className="mt-6 space-y-2">
          <Toggle
            checked={menuBar}
            onChange={setMenuBar}
            disabled={!mb.canBuild && !mb.running}
            label="Keep Klose in the menu bar"
            hint={
              mb.canBuild || mb.running
                ? 'A dot when an agent is working or comments are waiting.'
                : "Needs Apple's command line tools: xcode-select --install"
            }
          />
          <Toggle
            checked={startAtLogin}
            onChange={setStartAtLogin}
            disabled={!mb.canBuild}
            label="Start Klose at login"
            hint="The menu bar app starts the canvas for you."
          />
        </div>
      )}

      <div className="mt-6 text-[11px] font-medium uppercase tracking-[0.14em] text-app-subtle">Try it in Claude Code</div>
      <p className="mb-2 mt-1 text-xs text-app-muted">Open Claude Code in one of your repos and paste one of these. Click to copy.</p>
      <SuggestedPrompts />
    </div>
  );
};

// ---------------------------------------------------------------- page

/**
 * First-run setup, served by the hub at /welcome: `klose setup` opens it, and
 * the hub's home page sends you here until it's finished. Choices on the last
 * step are applied only when you finish, so leaving halfway changes nothing.
 */
const WelcomePage: React.FC = () => {
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [menuBar, setMenuBar] = useState(true);
  const [startAtLogin, setStartAtLogin] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const headingRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoadError(null);
    getSetup()
      .then((s) => {
        setState(s);
        // Defaults: on where they can work, kept as they are where already set.
        setMenuBar(s.menuBar.running || s.menuBar.canBuild);
        setStartAtLogin(IN_DESKTOP_APP || s.menuBar.startAtLogin || s.menuBar.canBuild);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Klose could not load setup'));
  };
  useEffect(load, []);

  // Move focus to each step, so a screen reader announces it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const index = STEPS.indexOf(step);
  const back = () => setStep(STEPS[Math.max(0, index - 1)]);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);

  const finish = async (choices: Parameters<typeof finishSetup>[0]) => {
    setFinishing(true);
    setFinishError(null);
    try {
      const result = await finishSetup(choices);
      if (result.warnings.length) {
        setWarnings(result.warnings);
        setFinishing(false);
        return;
      }
      window.location.assign(HUB_HOME);
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Could not finish setup');
      setFinishing(false);
    }
  };
  const done = () =>
    finish(IN_DESKTOP_APP ? { startAtLogin, shell: 'desktop' as const } : state?.menuBar.supported ? { menuBar, startAtLogin } : {});

  if (loadError || !state) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app-bg font-sans text-app-primary">
        {loadError ? (
          <div className="text-center">
            <p className="text-sm font-semibold">Klose could not start setup</p>
            <p className="mt-1 text-xs text-app-muted">{loadError}</p>
            <button type="button" onClick={load} className="mt-4 rounded-lg border border-app-border px-3 py-1.5 text-sm hover:bg-app-surface-soft">
              Try again
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-app-muted">
            <Loader2 size={14} className="animate-spin" /> Preparing Klose…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-app-bg font-sans text-app-primary selection:bg-ceko-accent/30">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="h-6 w-6 rounded-full bg-app-primary" />
          <span className="font-logo text-base font-bold tracking-tight">Klose</span>
          <span className="text-xs text-app-subtle">Setup</span>
        </div>
        {step !== 'ready' && (
          <button type="button" onClick={() => finish({})} disabled={finishing} className="text-xs text-app-muted hover:text-app-primary">
            Skip setup
          </button>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-xl">
          <div ref={headingRef} tabIndex={-1} className="focus:outline-none" aria-live="polite">
            <span className="sr-only">
              Step {index + 1} of {STEPS.length}
            </span>
            {step === 'welcome' && <WelcomeStep />}
            {step === 'repos' && <ReposStep state={state} onChange={setState} />}
            {step === 'skill' && <SkillStep state={state} onChange={setState} />}
            {step === 'ready' && (
              <ReadyStep state={state} menuBar={menuBar} startAtLogin={startAtLogin} setMenuBar={setMenuBar} setStartAtLogin={setStartAtLogin} />
            )}
          </div>

          {warnings.length > 0 && (
            <div className="mt-5 space-y-1 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-500" role="alert">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <p className="pt-1 text-app-muted">Setup is finished anyway — you can change these from the menu bar later.</p>
            </div>
          )}
          {finishError && (
            <p className="mt-4 text-xs text-red-400" role="alert">
              {finishError}
            </p>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-between border-t border-app-border px-6 py-4">
        <button
          type="button"
          onClick={back}
          disabled={index === 0}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-app-muted transition-colors hover:text-app-primary disabled:invisible"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-ceko-accent' : i < index ? 'w-1.5 bg-app-muted' : 'w-1.5 bg-app-surface-soft'}`} />
          ))}
        </div>
        {warnings.length > 0 ? (
          <a href={HUB_HOME} className="rounded-lg bg-ceko-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
            Open Klose
          </a>
        ) : step === 'ready' ? (
          <button
            type="button"
            onClick={done}
            disabled={finishing}
            className="flex items-center gap-2 rounded-lg bg-ceko-accent px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
          >
            {finishing && <Loader2 size={14} className="animate-spin" />}
            {finishing ? 'Finishing…' : 'Open Klose'}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-ceko-accent px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            {step === 'welcome' ? 'Get started' : 'Continue'}
          </button>
        )}
      </footer>
    </div>
  );
};

export default WelcomePage;
