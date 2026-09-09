import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import AppLayout from './components/Layout/AppLayout';
import MinimalLayout from './components/Layout/MinimalLayout';
import LandingPage from './pages/LandingPage';
import ProjectsPage from './pages/ProjectsPage';
import CanvasPage from './pages/CanvasPage';
import SettingsPage from './pages/SettingsPage';

const App: React.FC = () => {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* Full-screen, no navbar */}
          <Route element={<MinimalLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/canvas/:projectId" element={<CanvasPage />} />
          </Route>

          {/* With navbar */}
          <Route element={<AppLayout />}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
};

export default App;
