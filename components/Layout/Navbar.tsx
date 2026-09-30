import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FolderOpen, Settings, Moon, Sun, Blocks } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

const Navbar: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const isLightMode = settings.themeMode === 'light';

  const navItems = [
    { label: 'Files', path: '/projects', icon: FolderOpen },
    { label: 'Components', path: '/components', icon: Blocks },
  ];

  return (
    <div className="relative z-20 flex w-full items-center justify-between border-b border-app-border bg-app-surface-elevated px-6 py-4 text-app-primary shadow-sm">
      {/* Left: Logo */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-3 group">
          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-app-primary shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-shadow group-hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]" />
          <span className="hidden font-logo text-lg font-bold tracking-tight text-app-primary sm:block">Klose</span>
        </button>
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
