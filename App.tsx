import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import AppLayout from './components/Layout/AppLayout';
import MinimalLayout from './components/Layout/MinimalLayout';
import LandingPage from './pages/LandingPage';
import ProjectsPage from './pages/ProjectsPage';
import ComponentsPage from './pages/ComponentsPage';
import CanvasPage from './pages/CanvasPage';
import SettingsPage from './pages/SettingsPage';
import HubHomePage from './pages/HubHomePage';
import { getRepo, getServerInfo } from './services/hubService';
import { HUB_HOME, REPO_ID, ROUTER_BASENAME } from './lib/repoScope';

/**
 * What this page is showing:
 *   'repo'    one repo's canvas — a per-repo server, or /r/<id>/… on a hub
 *   'hub'     the hub's home page (every repo)
 *   'loading' not known yet: only the server can say whether it is a hub
 */
type Mode = 'loading' | 'hub' | 'repo';

const App: React.FC = () => {
  const [mode, setMode] = useState<Mode>(REPO_ID ? 'repo' : 'loading');

  useEffect(() => {
    if (REPO_ID) {
      // A link to a repo the hub no longer knows (deleted, or a stale
      // bookmark) would show a canvas where every request fails.
      getRepo(REPO_ID).catch((err) => {
        if (err?.status === 404) window.location.replace(HUB_HOME);
      });
      return;
    }
    getServerInfo()
      .then((info) => setMode(info.hub ? 'hub' : 'repo'))
      .catch(() => setMode('repo'));
  }, []);

  if (mode === 'loading') return <div className="h-screen w-screen bg-app-bg" />;

  if (mode === 'hub') {
    return (
      <SettingsProvider>
        <HubHomePage />
      </SettingsProvider>
    );
  }

  return (
    <SettingsProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Routes>
          {/* Full-screen, no navbar */}
          <Route element={<MinimalLayout />}>
            {/* On a hub the repo's front page is its files; the landing page introduces a per-repo install. */}
            <Route path="/" element={REPO_ID ? <Navigate to="/projects" replace /> : <LandingPage />} />
            <Route path="/canvas/:projectId" element={<CanvasPage />} />
          </Route>

          {/* With navbar */}
          <Route element={<AppLayout />}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
};

export default App;
