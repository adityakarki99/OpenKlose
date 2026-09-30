import React, { useState, useEffect, useRef } from 'react';
import { Project, RepoSave } from '../../types';
import { listProjects, createProject, deleteProject, saveProject, saveProjectToRepo, getRepoName } from '../../services/projectService';
import { Plus, Trash2, Layers, Loader2, Pencil, Check, FileText, MessageSquare, FolderDown, CircleDot } from 'lucide-react';
import { Button } from '../DesignSystem/Button';
import { Card } from '../DesignSystem/Card';
import { Input } from '../DesignSystem/Input';

// --- Components ---

// One column template shared by the header and every row, so the numbers line up.
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_64px_96px_56px_140px_72px_48px] items-center gap-x-3';

/**
 * The "In repo" cell: whether this file's folder in the repo matches the
 * canvas, and the one action that fixes it when it doesn't.
 */
const RepoCell = ({ repo, isSaving, onSave }: { repo?: RepoSave; isSaving: boolean; onSave: (e: React.MouseEvent) => void }) => {
    if (isSaving) {
        return (
            <span className="flex items-center gap-1.5 text-xs text-app-muted">
                <Loader2 size={12} className="animate-spin" />
                Saving…
            </span>
        );
    }
    if (repo?.state === 'saved') {
        return (
            <span className="flex items-center gap-1 text-xs text-emerald-400" title={`Saved to ${repo.dir}`}>
                <Check size={13} />
                Saved
            </span>
        );
    }
    if (repo?.state === 'changed') {
        return (
            <button
                onClick={onSave}
                title={`The canvas changed since it was saved to ${repo.dir}`}
                className="flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-500 transition-colors hover:bg-amber-400/25"
            >
                <CircleDot size={11} />
                Changed · Save
            </button>
        );
    }
    return (
        <button
            onClick={onSave}
            title="Write this file into the repo: a README plus one .tsx per sketch"
            className="flex items-center gap-1.5 rounded-md border border-dashed border-app-border-strong px-2 py-1 text-xs font-medium text-app-secondary transition-colors hover:border-ceko-accent/60 hover:text-app-primary"
        >
            <FolderDown size={11} />
            Save to repo
        </button>
    );
};

interface FileRowProps {
    project: Project;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onSaveToRepo: (e: React.MouseEvent) => void;
    isSavingToRepo: boolean;
    timeAgo: string;
    isRenaming: boolean;
    renameValue: string;
    onRenameStart: (e: React.MouseEvent) => void;
    onRenameChange: (val: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
}

const FileRow = ({
    project,
    onClick,
    onDelete,
    onSaveToRepo,
    isSavingToRepo,
    timeAgo,
    isRenaming,
    renameValue,
    onRenameStart,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel
}: FileRowProps) => {
    const nodes = project.nodes || [];
    const built = nodes.filter(n => n.status === 'built').length;
    const comments = nodes.reduce((sum, n) => sum + (n.comments?.length || 0), 0);
    const inRepo = project.repo && project.repo.state !== 'canvas';
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

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
            className={`group ${COLUMNS} cursor-pointer rounded-xl border border-app-border bg-app-surface px-4 py-2.5 transition-colors duration-200 hover:border-app-border-strong`}
        >
            <div className="flex min-w-0 items-center gap-3">
                <FileText size={16} className={`shrink-0 ${inRepo ? 'text-ceko-accent' : 'text-app-subtle'}`} />
                <div className="min-w-0">
                    {isRenaming ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => onRenameChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={handleKeyDown}
                            onBlur={() => onRenameSubmit()}
                            className="w-full max-w-xs rounded border border-ceko-accent/50 bg-app-bg px-1 py-0.5 text-sm text-app-primary focus:outline-none"
                        />
                    ) : (
                        <h3 className="truncate text-sm font-semibold text-app-primary">{project.name}</h3>
                    )}
                    <div className="truncate font-mono text-[11px] text-app-subtle">
                        {inRepo ? `${project.repo!.dir}/` : 'not in the repo yet'}
                    </div>
                </div>
            </div>

            <span className="flex items-center justify-end gap-1 text-xs tabular-nums text-app-muted">
                <Layers size={12} className="text-app-subtle" />
                {nodes.length}
            </span>

            <span className="flex items-center justify-end gap-2" title={`${built} of ${nodes.length} sketches built`}>
                <span className="h-1 w-8 overflow-hidden rounded-full bg-app-surface-soft">
                    <span
                        className="block h-full rounded-full bg-emerald-400"
                        style={{ width: nodes.length ? `${(built / nodes.length) * 100}%` : 0 }}
                    />
                </span>
                <span className="text-[11px] tabular-nums text-app-subtle">{built}/{nodes.length}</span>
            </span>

            <span className="flex justify-end">
                {comments > 0 ? (
                    <span
                        className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500"
                        title={`${comments} pending comment${comments === 1 ? '' : 's'}`}
                    >
                        <MessageSquare size={11} />
                        {comments}
                    </span>
                ) : (
                    <span className="text-xs text-app-subtle">—</span>
                )}
            </span>

            <span>
                <RepoCell repo={project.repo} isSaving={isSavingToRepo} onSave={onSaveToRepo} />
            </span>

            <span className="text-right text-xs tabular-nums text-app-subtle">{timeAgo}</span>

            <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                    onClick={onRenameStart}
                    className="rounded p-1 text-app-subtle transition-colors hover:text-ceko-accent"
                    title="Rename file"
                >
                    <Pencil size={13} />
                </button>
                <button
                    onClick={onDelete}
                    className="rounded p-1 text-app-subtle transition-colors hover:text-red-400"
                    title="Delete file"
                >
                    <Trash2 size={13} />
                </button>
            </span>
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
    const [repoName, setRepoName] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    // Create Modal State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createName, setCreateName] = useState('Untitled Project');

    // Rename State
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const fetchProjects = async ({ quiet = false } = {}) => {
        try {
            if (!quiet) setIsLoading(true);
            setError(null);
            const data = await listProjects();
            setProjects(data);
        } catch (err) {
            setError('Failed to load files');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
        getRepoName().then(setRepoName).catch(() => { /* the heading still reads fine without it */ });
    }, []);

    // Files the agent creates or edits show up here without a reload.
    useEffect(() => {
        const source = new EventSource('/api/events');
        source.addEventListener('update', () => fetchProjects({ quiet: true }));
        return () => source.close();
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
            setError('Failed to create file');
            console.error(err);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, project: Project) => {
        e.stopPropagation();
        const kept = project.repo && project.repo.state !== 'canvas'
            ? ` The copy saved in ${project.repo.dir}/ stays in the repo.`
            : '';
        if (!confirm(`Delete "${project.name}" from the canvas? This cannot be undone.${kept}`)) return;
        try {
            await deleteProject(project.id);
            setProjects(prev => prev.filter(p => p.id !== project.id));
        } catch (err) {
            setError('Failed to delete file');
            console.error(err);
        }
    };

    const handleSaveToRepo = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            setSavingId(id);
            const { repo } = await saveProjectToRepo(id);
            setProjects(prev => prev.map(p => (p.id === id ? { ...p, repo } : p)));
        } catch (err) {
            setError(err instanceof Error ? `Couldn't save to the repo: ${err.message}` : "Couldn't save to the repo");
            console.error(err);
        } finally {
            setSavingId(null);
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
            console.error('Failed to rename file:', err);
            setError('Failed to rename file');
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
            <div className="w-full px-8 md:px-12 pt-8 pb-4 flex items-end justify-between">
                <div>
                    {repoName && <div className="mb-1 text-xs font-medium text-app-muted">{repoName}</div>}
                    <h1 className="text-2xl font-bold tracking-tight text-app-primary">Klose files</h1>
                    <p className="mt-1 text-sm text-app-muted">One file per canvas. Save one to the repo to keep it as a planning doc.</p>
                </div>
                <Button
                    variant="primary"
                    size="md"
                    onClick={() => setShowCreateModal(true)}
                    leftIcon={<Plus size={16} strokeWidth={2.5} />}
                >
                    New file
                </Button>
            </div>

            {/* Content */}
            <div className="relative z-10 flex-1 overflow-auto px-8 pb-12 pt-4 md:px-12 canvas-scroll">
                <div className="mx-auto min-w-[680px] max-w-5xl">
                    {error && (
                        <div className="mb-6 p-4 rounded-xl text-sm flex items-center justify-between border border-red-500/20 bg-red-500/10 text-red-400" role="alert">
                            <span>{error}</span>
                            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</Button>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="space-y-1.5">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-[58px] rounded-xl bg-ceko-surface animate-pulse" />
                            ))}
                        </div>
                    ) : projects.length === 0 ? (
                        <Card variant="ghost" className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8">
                            <div className="mb-6 flex flex-col items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-app-border bg-app-surface">
                                    <FileText size={24} className="text-app-subtle" />
                                </div>
                                <div>
                                    <h2 className="mb-1 text-lg font-semibold text-app-primary">No Klose files in this repo yet.</h2>
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
                                Create your first file
                            </Button>
                        </Card>
                    ) : (
                        <>
                            <div className={`${COLUMNS} px-4 pb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle`}>
                                <span>File</span>
                                <span className="text-right">Sketches</span>
                                <span className="text-right">Built</span>
                                <span className="text-right">Notes</span>
                                <span>In repo</span>
                                <span className="text-right">Edited</span>
                                <span />
                            </div>
                            <div className="space-y-1.5">
                                {projects.map(project => (
                                    <FileRow
                                        key={project.id}
                                        project={project}
                                        onClick={() => onOpenProject(project)}
                                        onDelete={(e) => handleDelete(e, project)}
                                        onSaveToRepo={(e) => handleSaveToRepo(e, project.id)}
                                        isSavingToRepo={savingId === project.id}
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
                            <p className="mt-4 rounded-lg border border-app-border px-3 py-2 text-xs leading-relaxed text-app-muted">
                                Saving writes <code className="font-mono text-app-secondary">README.md</code> (notes, status, feedback) and
                                one <code className="font-mono text-app-secondary">.tsx</code> per sketch into the file's folder. The canvas
                                itself stays in <code className="font-mono text-app-secondary">.klose/projects/</code>.
                            </p>
                        </>
                    )}
                </div>
            </div>

            {/* Create Project Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ceko-bg/80 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
                    <Card variant="default" className="w-full max-w-md p-6 scale-100 animate-in zoom-in-95 duration-200">
                        <h2 id="create-project-title" className="text-xl font-bold mb-4 text-app-primary">New file</h2>
                        <form onSubmit={handleCreateSubmit}>
                            <div className="space-y-4">
                                <Input
                                    label="File name"
                                    type="text"
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                    placeholder="e.g. Billing page"
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
                                        Create file
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
