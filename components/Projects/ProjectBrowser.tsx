import React, { useState, useEffect, useRef } from 'react';
import { Project } from '../../types';
import { listProjects, createProject, deleteProject, saveProject } from '../../services/projectService';
import { Plus, Trash2, FolderOpen, Clock, Layers, Loader2, Pencil, X, Check } from 'lucide-react';
import { Button } from '../DesignSystem/Button';
import { Card } from '../DesignSystem/Card';
import { Input } from '../DesignSystem/Input';

// --- Types ---

type ThumbnailVariant = 'layers' | 'single-rect' | 'double-rect';

// --- Components ---

const Thumbnail = ({ variant }: { variant: ThumbnailVariant }) => {
    const isContent = variant === 'single-rect' || variant === 'double-rect';

    return (
        <div className="flex h-20 w-24 items-center justify-center">
            <div
                className={`
          relative flex h-16 w-12 flex-col gap-1.5 overflow-hidden rounded-[4px] border 
          bg-app-surface p-1.5 shadow-sm transition-all duration-300 
          group-hover:-translate-y-2 group-hover:rotate-1 group-hover:shadow-lg 
          ${isContent
                        ? 'border-app-borderStrong group-hover:border-ceko-accent/50 group-hover:shadow-ceko-accent/10'
                        : 'border-app-border opacity-60 group-hover:opacity-100 group-hover:border-app-borderStrong'}
        `}
            >
                {/* Header line simulating title */}
                <div className={`h-0.5 rounded-full bg-app-subtle transition-colors group-hover:bg-ceko-accent/60 ${isContent ? 'w-2/3' : 'w-1/3 opacity-50'}`} />

                {/* Content Wireframes */}
                {variant === 'single-rect' && (
                    <div className="flex-1 rounded-[2px] border border-dashed border-app-borderStrong bg-app-surfaceSoft transition-colors group-hover:border-ceko-accent/30" />
                )}

                {variant === 'double-rect' && (
                    <div className="flex flex-1 flex-col gap-1">
                        <div className="h-1/2 w-full rounded-[2px] border border-dashed border-app-borderStrong bg-app-surfaceSoft transition-colors group-hover:border-ceko-accent/30" />
                        <div className="h-1/2 w-full rounded-[2px] border border-dashed border-app-borderStrong bg-app-surfaceSoft transition-colors group-hover:border-ceko-accent/30" />
                    </div>
                )}

                {/* Empty State visual enhancement */}
                {!isContent && (
                    <div className="mt-2 flex flex-col gap-1.5 opacity-20">
                        <div className="h-0.5 w-full rounded-full bg-app-subtle" />
                        <div className="h-0.5 w-3/4 rounded-full bg-app-subtle" />
                        <div className="h-0.5 w-full rounded-full bg-app-subtle" />
                    </div>
                )}
            </div>
        </div>
    );
};

interface ProjectCardProps {
    project: Project;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
    timeAgo: string;
    isRenaming: boolean;
    renameValue: string;
    onRenameStart: (e: React.MouseEvent) => void;
    onRenameChange: (val: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
}

const ProjectCard = ({
    project,
    onClick,
    onDelete,
    timeAgo,
    isRenaming,
    renameValue,
    onRenameStart,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel
}: ProjectCardProps) => {
    const componentCount = project.nodes ? project.nodes.length : 0;
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

    let thumbnailVariant: ThumbnailVariant = 'layers';
    if (componentCount === 1) thumbnailVariant = 'single-rect';
    if (componentCount > 1) thumbnailVariant = 'double-rect';

    const handleInputClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onRenameSubmit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onRenameCancel();
        }
    };

    return (
        <div
            onClick={onClick}
            className="group relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-transparent p-4 transition-all duration-200 hover:border-app-border hover:bg-app-surface"
        >
            {/* Delete Button (Show on Hover) */}
            <button
                onClick={onDelete}
                className="absolute right-2 top-2 z-10 p-1.5 text-app-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                title="Delete project"
            >
                <Trash2 size={14} />
            </button>

            {/* Icon Area */}
            <div className="transform transition-transform duration-300 group-hover:scale-105">
                <Thumbnail variant={thumbnailVariant} />
            </div>

            {/* Content Area */}
            <div className="flex flex-col items-center text-center w-full">
                {isRenaming ? (
                    <div className="flex items-center gap-1 w-full max-w-[150px]">
                        <input
                            ref={inputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => onRenameChange(e.target.value)}
                            onClick={handleInputClick}
                            onKeyDown={handleKeyDown}
                            onBlur={() => onRenameSubmit()}
                            className="w-full rounded border border-ceko-accent/50 bg-app-bg px-1 py-0.5 text-center text-sm text-app-primary focus:outline-none"
                        />
                    </div>
                ) : (
                    <div className="group/title flex items-center gap-1.5 max-w-full justify-center relative">
                        <h3 className="max-w-[140px] truncate text-sm font-medium text-app-secondary transition-colors duration-200 group-hover:text-ceko-accent">
                            {project.name}
                        </h3>
                        <button
                            onClick={onRenameStart}
                            className="p-1 text-app-subtle opacity-0 transition-opacity hover:text-ceko-accent group-hover/title:opacity-100"
                            title="Rename project"
                        >
                            <Pencil size={10} />
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-3 text-[11px] font-medium text-[#58606e] opacity-0 transition-opacity duration-200 group-hover:opacity-100 mt-1.5">
                    <div className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        <span>
                            {componentCount}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{timeAgo}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ProjectBrowserProps {
    onOpenProject: (project: Project) => void;
    onNewProject: () => void;
}

const ProjectBrowser: React.FC<ProjectBrowserProps> = ({ onOpenProject, onNewProject }) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Create Modal State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createName, setCreateName] = useState('Untitled Project');

    // Rename State
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const fetchProjects = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await listProjects();
            setProjects(data);
        } catch (err) {
            setError('Failed to load projects');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    const handleCreateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsCreating(true);
            const project = await createProject(createName || 'Untitled Project');
            setShowCreateModal(false);
            setCreateName('Untitled Project');
            onOpenProject(project);
        } catch (err) {
            setError('Failed to create project');
            console.error(err);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Delete this project? This cannot be undone.')) return;
        try {
            await deleteProject(id);
            setProjects(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            setError('Failed to delete project');
            console.error(err);
        }
    };

    const handleRenameStart = (e: React.MouseEvent, project: Project) => {
        e.stopPropagation();
        setRenamingId(project.id);
        setRenameValue(project.name);
    };

    const handleRenameSubmit = async () => {
        if (!renamingId) return;

        const originalProject = projects.find(p => p.id === renamingId);
        if (originalProject && originalProject.name === renameValue) {
            setRenamingId(null);
            return;
        }

        try {
            // Optimistic update
            setProjects(prev => prev.map(p =>
                p.id === renamingId ? { ...p, name: renameValue } : p
            ));

            await saveProject(renamingId, { name: renameValue });
            setRenamingId(null);
        } catch (err) {
            console.error('Failed to rename project:', err);
            setError('Failed to rename project');
            fetchProjects(); // Revert on error
        }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-app-bg font-sans text-app-primary selection:bg-ceko-accent/30">
            {/* Page Header */}
            <div className="w-full px-8 md:px-12 pt-8 pb-4 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-app-primary">Projects</h1>
                    <p className="mt-1 text-sm text-app-muted">Your saved workspaces</p>
                </div>
                <Button
                    variant="primary"
                    size="md"
                    onClick={() => setShowCreateModal(true)}
                    leftIcon={<Plus size={16} strokeWidth={2.5} />}
                >
                    New Project
                </Button>
            </div>

            {/* Content */}
            <div className="relative z-10 flex-1 overflow-y-auto p-8 md:p-12 canvas-scroll">
                <div className="mx-auto max-w-7xl">
                    {error && (
                        <div className="mb-6 p-4 rounded-xl text-sm flex items-center justify-between border border-red-500/20 bg-red-500/10 text-red-400" role="alert">
                            <span>{error}</span>
                            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</Button>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="h-44 rounded-xl bg-ceko-surface animate-pulse" />
                            ))}
                        </div>
                    ) : projects.length === 0 ? (
                        <Card variant="ghost" className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8">
                            <div className="mb-6 flex flex-col items-center gap-4">
                                <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-app-border bg-app-surface">
                                    <Thumbnail variant="layers" />
                                </div>
                                <div>
                                    <h2 className="mb-1 text-lg font-semibold text-app-primary">You don&apos;t have any projects yet.</h2>
                                    <p className="max-w-md text-sm text-app-muted">
                                        Start a canvas, sketch your first component, then use <code>/klose</code> in your coding
                                        agent to ideate the details and build it into your repo.
                                    </p>
                                </div>
                            </div>

                            <Button
                                variant="primary"
                                size="lg"
                                onClick={() => setShowCreateModal(true)}
                                disabled={isCreating}
                                isLoading={isCreating}
                                leftIcon={!isCreating && <Plus size={16} />}
                            >
                                Create your first project
                            </Button>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                            {projects.map(project => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    onClick={() => onOpenProject(project)}
                                    onDelete={(e) => handleDelete(e, project.id)}
                                    timeAgo={formatDate(project.updated_at)}
                                    isRenaming={renamingId === project.id}
                                    renameValue={renameValue}
                                    onRenameStart={(e) => handleRenameStart(e, project)}
                                    onRenameChange={setRenameValue}
                                    onRenameSubmit={handleRenameSubmit}
                                    onRenameCancel={() => setRenamingId(null)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Project Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ceko-bg/80 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
                    <Card variant="default" className="w-full max-w-md p-6 scale-100 animate-in zoom-in-95 duration-200">
                        <h2 id="create-project-title" className="text-xl font-bold mb-4 text-white">New Project</h2>
                        <form onSubmit={handleCreateSubmit}>
                            <div className="space-y-4">
                                <Input
                                    label="Project Name"
                                    type="text"
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                    placeholder="e.g. Portfolio Website"
                                    autoFocus
                                />
                                <div className="flex items-center gap-3 pt-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="flex-1"
                                        onClick={() => setShowCreateModal(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        className="flex-1"
                                        disabled={isCreating || !createName.trim()}
                                        isLoading={isCreating}
                                    >
                                        Create Project
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default ProjectBrowser;
