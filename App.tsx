import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import AppLayout from './components/Layout/AppLayout';
import MinimalLayout from './components/Layout/MinimalLayout';
import ProjectsPage from './pages/ProjectsPage';
import CanvasPage from './pages/CanvasPage';
import SettingsPage from './pages/SettingsPage';

const App: React.FC = () => {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* With navbar */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* No navbar (full screen canvas) */}
          <Route element={<MinimalLayout />}>
            <Route path="/canvas/:projectId" element={<CanvasPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
};

export default App;
