import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, FolderOpen, Settings, Moon, Sun } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

const Navbar: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const isLightMode = settings.themeMode === 'light';

  const navItems = [
    { label: 'Projects', path: '/projects', icon: FolderOpen },
  ];

  return (
    <div className="relative z-20 flex w-full items-center justify-between border-b border-app-border bg-app-surfaceElevated px-6 py-4 text-app-primary shadow-sm">
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
                  : 'text-app-muted hover:text-app-primary hover:bg-app-surfaceSoft'
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
          className="flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-surface hover:bg-app-surfaceSoft text-app-muted hover:text-app-primary transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          title={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-surface hover:bg-app-surfaceSoft text-app-secondary hover:text-app-primary transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          aria-label="User menu"
        >
          <User size={20} />
        </button>

        {isDropdownOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setIsDropdownOpen(false)} />
            <div className={`absolute ${settings.cssLogicalProperties ? 'end-0' : 'right-0'} z-40 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-xl animate-in fade-in zoom-in-95 duration-200`}>
              <div className="space-y-1.5 p-1.5">
                <button
                  onClick={() => {
                    navigate('/settings');
                    setIsDropdownOpen(false);
                  }}
                  className="group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-app-secondary transition-colors hover:bg-app-surfaceSoft hover:text-app-primary"
                >
                  <Settings size={16} className="transition-transform group-hover:-translate-x-0.5" />
                  Settings
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Navbar;
