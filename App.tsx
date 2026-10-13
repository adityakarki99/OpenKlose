import React, { useEffect, useState } from 'react';
import { BrowserRouter, HashRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import AppLayout from './components/Layout/AppLayout';
import MinimalLayout from './components/Layout/MinimalLayout';
import LandingPage from './pages/LandingPage';
import ProjectsPage from './pages/ProjectsPage';
import ComponentsPage from './pages/ComponentsPage';
import CanvasPage from './pages/CanvasPage';
import SettingsPage from './pages/SettingsPage';
import HubHomePage from './pages/HubHomePage';
import TrayPage from './pages/TrayPage';
import WelcomePage from './pages/WelcomePage';
import OpenRepoPage, { NEXT_KEY } from './pages/OpenRepoPage';
import SharePage from './pages/SharePage';
import { rememberedShare } from './lib/shareSession';
import { getRepo, getServerInfo } from './services/hubService';
import { HUB_HOME, REPO_ID, ROUTER_BASENAME } from './lib/repoScope';
import { STATIC } from './lib/mode';
import { useFolderSession } from './lib/folderSession';

/**
 * Pages of the hosted canvas need an open folder; without one, the front
 * door, remembering where to come back to. A tab that was on a shared canvas
 * (a reload) reopens the link instead: it needs no picker.
 */
const RequireFolder: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const session = useFolderSession();
  const location = useLocation();
  if (session) return children;
  const share = rememberedShare();
  if (share) return <Navigate to={`/s/${share.id}/${share.key}`} replace />;
  try {
    sessionStorage.setItem(NEXT_KEY, location.pathname);
  } catch {
    // The files page is a fine place to land.
  }
  return <Navigate to="/" replace />;
};

/**
 * The hosted canvas (`npm run build:static`): no server, the repo is a folder
 * the browser was given. Hash routes, so a deep link works on any static host
 * without a rewrite rule. No landing page, hub, components index or setup:
 * those belong to the process this build does without.
 */
const StaticApp: React.FC = () => (
  <SettingsProvider>
    <HashRouter>
      <Routes>
        <Route element={<MinimalLayout />}>
          <Route path="/" element={<OpenRepoPage />} />
          {/* A shared canvas: the project at a link the agent made (lib/shareSession.ts). */}
          <Route path="/s/:id/:key" element={<SharePage />} />
          <Route
            path="/canvas/:projectId"
            element={
              <RequireFolder>
                <CanvasPage />
              </RequireFolder>
            }
          />
        </Route>
        <Route
          element={
            <RequireFolder>
              <AppLayout />
            </RequireFolder>
          }
        >
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  </SettingsProvider>
);

/**
 * What this page is showing:
 *   'repo'    one repo's canvas — a per-repo server, or /r/<id>/… on a hub
 *   'hub'     the hub's home page (every repo)
 *   'loading' not known yet: only the server can say whether it is a hub
 */
type Mode = 'loading' | 'hub' | 'repo';

const ServerApp: React.FC = () => {
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
    // /tray is the menu bar popover's content; it also works in a browser tab.
    // /welcome is first-run setup (`klose setup` opens it).
    const page = window.location.pathname.replace(/\/+$/, '');
    return (
      <SettingsProvider>{page === '/tray' ? <TrayPage /> : page === '/welcome' ? <WelcomePage /> : <HubHomePage />}</SettingsProvider>
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

const App: React.FC = STATIC ? StaticApp : ServerApp;

export default App;
