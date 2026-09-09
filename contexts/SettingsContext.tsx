import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { UserSettings } from '../types';
import { getSettings, saveSettings } from '../services/settingsService';

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: getSettings(),
  updateSettings: () => {},
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(() => getSettings());

  useEffect(() => {
    document.documentElement.dir = settings.rtlDirection ? 'rtl' : 'ltr';
    document.documentElement.dataset.theme = settings.themeMode;
    document.documentElement.style.colorScheme = settings.themeMode;
    document.body.dataset.theme = settings.themeMode;
  }, [settings.rtlDirection, settings.themeMode]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
