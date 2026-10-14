import React from 'react';
import { onlineLabels } from '../Canvas/OnlineStatus';
import { useNavigate, useLocation } from 'react-router-dom';
import { FolderOpen, Settings, Moon, Sun, Blocks, FolderSync, Link2 } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';
import { RepoSwitcher } from '../Hub/RepoSwitcher';
import { STATIC } from '../../lib/mode';
import { closeSession, useFolderSession } from '../../lib/folderSession';
import { useShareStatus } from '../../lib/shareSession';

/** On the hosted canvas: which folder is open, and the way to another one. On a share: the link's repo, and how the sync is doing. */
const FolderChip: React.FC = () => {
  const session = useFolderSession();
  const navigate = useNavigate();
  const status = useShareStatus();
  if (!session) return null;
  if (session.kind === 'share') {
    const label = onlineLabels[status];
    const tone = status === 'ok' ? 'text-emerald-400' : status === 'syncing' ? 'text-blue-400' : status === 'offline' ? 'text-amber-400' : 'text-red-400';
    return (
      <div className="flex items-center gap-3">
        <span className="text-app-subtle">/</span>
        <span className="max-w-[220px] truncate text-sm font-semibold text-app-primary" title={session.name}>
          {session.name}
        </span>
        <span className={`flex items-center gap-1.5 rounded-md border border-app-border px-2 py-1 text-xs ${tone}`} title="This canvas is a link your agent shared. What you do here reaches the agent; what it sketches shows up here." data-testid="share-status">
          <Link2 size={12} />
          {label}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-app-subtle">/</span>
      <span className="max-w-[220px] truncate text-sm font-semibold text-app-primary" title={session.name}>
        {session.name}
      </span>
      <button
        type="button"
        onClick={() => {
          closeSession();
          navigate('/');
        }}
        className="flex items-center gap-1.5 rounded-md border border-app-border px-2 py-1 text-xs text-app-muted transition-colors hover:border-app-border-strong hover:text-app-primary"
        title="Open a different repo folder"
      >
        <FolderSync size={12} />
        Switch
      </button>
    </div>
  );
};

const Navbar: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const isLightMode = settings.themeMode === 'light';

  const navItems = [
    { label: 'Files', path: '/projects', icon: FolderOpen },
    // The component index is scanned by the server; the hosted canvas has none.
    ...(STATIC ? [] : [{ label: 'Components', path: '/components', icon: Blocks }]),
  ];

  return (
    <div className="relative z-20 flex w-full items-center justify-between border-b border-app-border bg-app-surface-elevated px-6 py-4 text-app-primary shadow-sm">
      {/* Left: Logo */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-3 group">
          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-shadow group-hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]" />
          <span className="hidden font-logo text-lg font-bold tracking-tight text-app-primary sm:block">Klose</span>
        </button>
        {STATIC ? <FolderChip /> : <RepoSwitcher />}
      </div>

      {/* Center: Nav Links */}
      <nav className="flex items-center gap-1">
        {navItems.map(({ label, path, icon: Icon }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-app-muted hover:text-app-primary hover:bg-app-surface-soft'
              }`}
            >
              <Icon size={16} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: User Menu */}
      <div className="relative flex items-center gap-3">
        <button
          type="button"
          onClick={() => updateSettings({ themeMode: isLightMode ? 'dark' : 'light' })}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-surface hover:bg-app-surface-soft text-app-muted hover:text-app-primary transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          title={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        {/* Klose has no accounts, so this is Settings rather than a user menu. */}
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
            location.pathname === '/settings'
              ? 'border-indigo-500/30 bg-indigo-600/20 text-indigo-300'
              : 'border-app-border bg-app-surface text-app-secondary hover:bg-app-surface-soft hover:text-app-primary'
          }`}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};

export default Navbar;
