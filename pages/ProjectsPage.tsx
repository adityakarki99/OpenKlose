import React from 'react';
import { useNavigate } from 'react-router-dom';
import ProjectBrowser from '../components/Projects/ProjectBrowser';
import { Project } from '../types';

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();

  const onOpenProject = (project: Project) => {
    navigate(`/canvas/${project.id}`);
  };

  return (
    <ProjectBrowser
      onOpenProject={onOpenProject}
      onNewProject={() => {}}
    />
  );
};

export default ProjectsPage;
