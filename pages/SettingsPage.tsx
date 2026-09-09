import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import type { ThemeMode, UserSettings } from '../types';
import { Button } from '../components/DesignSystem/Button';
import { Card } from '../components/DesignSystem/Card';

const SETTING_CONFIG: { key: keyof UserSettings; label: string; description: string }[] = [
  { key: 'cssLogicalProperties', label: 'CSS logical properties', description: 'Use margin-inline-start etc. for RTL-ready layout' },
  { key: 'rtlDirection', label: 'Right-to-left layout', description: 'Set document direction to RTL (e.g. Arabic, Hebrew)' },
];

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const themeOptions: Array<{ value: ThemeMode; label: string; description: string; icon: React.ReactNode }> = [
    { value: 'dark', label: 'Dark', description: 'High-contrast workspace for the current visual baseline.', icon: <Moon size={16} /> },
    { value: 'light', label: 'Light', description: 'Bright workspace with softer panels and lighter canvas chrome.', icon: <Sun size={16} /> },
  ];

  return (
    <div className="h-full overflow-y-auto bg-app-bg text-app-primary font-sans selection:bg-ceko-accent/30">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/projects')}
          className="mb-8 text-app-muted hover:text-app-primary"
          leftIcon={<ChevronLeft size={18} />}
        >
          Back to Projects
        </Button>

        <h1 className="mb-2 text-2xl font-bold text-app-primary">Settings</h1>
        <p className="mb-8 text-sm text-app-muted">Appearance and internationalization preferences.</p>

        <Card variant="default" noPadding className="mb-8 overflow-hidden">
          <h2 className="border-b border-app-border bg-app-surfaceSoft/60 px-6 py-4 text-sm font-semibold uppercase tracking-wider text-app-secondary">
            Appearance
          </h2>
          <div className="grid gap-4 p-6 md:grid-cols-2">
            {themeOptions.map((option) => {
              const isSelected = settings.themeMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateSettings({ themeMode: option.value })}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    isSelected
                      ? 'border-ceko-accent bg-ceko-accent/10 shadow-lg shadow-blue-500/10'
                      : 'border-app-border bg-app-surface hover:border-app-borderStrong hover:bg-app-surfaceSoft'
                  }`}
                >
                  <div className="mb-3 flex items-center gap-2 text-ceko-accent">
                    {option.icon}
                    <span className="text-sm font-semibold text-app-primary">{option.label}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-app-muted">{option.description}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <Card variant="default" noPadding className="overflow-hidden">
          <h2 className="border-b border-app-border bg-app-surfaceSoft/60 px-6 py-4 text-sm font-semibold uppercase tracking-wider text-app-secondary">
            Internationalization
          </h2>
          <div className="divide-y divide-app-border">
            {SETTING_CONFIG.map(({ key, label, description }) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-4 px-6 py-4 transition-colors hover:bg-app-surfaceSoft/60"
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-app-primary">{label}</span>
                  <span className="mt-0.5 block text-xs text-app-muted">{description}</span>
                </div>
                <div className="flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => updateSettings({ [key]: e.target.checked })}
                    className="h-5 w-5 cursor-pointer rounded border-app-border bg-app-surface text-ceko-accent focus:ring-2 focus:ring-ceko-accent focus:ring-offset-0 focus:ring-offset-transparent"
                  />
                </div>
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SettingsPage;
