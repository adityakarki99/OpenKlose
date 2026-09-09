import React, { useState, useEffect } from 'react';
import { Globe, Save, Info } from 'lucide-react';
import { ProjectContext } from '../../types';

export interface ProjectContextPanelProps {
    projectContext: ProjectContext;
    onUpdateProjectContext: (ctx: ProjectContext) => void;
    designSystemPrompt: string;
    onSaveDesignSystem: (prompt: string) => void;
}

export function ProjectContextPanel({
    projectContext,
    onUpdateProjectContext,
    designSystemPrompt,
    onSaveDesignSystem,
}: ProjectContextPanelProps) {
    const [localContext, setLocalContext] = useState(projectContext);
    const [localDesignPrompt, setLocalDesignPrompt] = useState(designSystemPrompt);
    const [isCtxDirty, setIsCtxDirty] = useState(false);
    const [isDsDirty, setIsDsDirty] = useState(false);

    // Sync if parent changes (e.g., project reload)
    useEffect(() => {
        setLocalContext(projectContext);
    }, [projectContext]);

    useEffect(() => {
        setLocalDesignPrompt(designSystemPrompt);
    }, [designSystemPrompt]);

    const handleContextChange = (val: string) => {
        setLocalContext(prev => ({ ...prev, projectDescription: val }));
        setIsCtxDirty(true);
    };

    const handleSaveContext = () => {
        onUpdateProjectContext(localContext);
        setIsCtxDirty(false);
    };

    const handleDsChange = (val: string) => {
        setLocalDesignPrompt(val);
        setIsDsDirty(true);
    };

    const handleSaveDs = () => {
        onSaveDesignSystem(localDesignPrompt);
        setIsDsDirty(false);
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Context Fields */}
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-app-subtle">
                    <div className="flex items-center gap-1.5">
                        <Globe size={10} /> Project Context
                    </div>
                    {isCtxDirty && <span className="text-amber-500 text-[9px]">Unsaved Changes</span>}
                </div>

                <div className="space-y-2">
                    <textarea
                        value={localContext.projectDescription || ''}
                        onChange={(e) => handleContextChange(e.target.value)}
                        placeholder="Describe your project here... (Target audience, brand voice, key features, design inspiration)"
                        className="h-64 w-full resize-none rounded-xl border border-app-border bg-app-surface px-3 py-3 text-xs leading-relaxed text-app-secondary transition-colors placeholder:text-app-subtle focus:border-app-borderStrong focus:outline-none focus:ring-1 focus:ring-app-borderStrong/30"
                    />
                    <button
                        onClick={handleSaveContext}
                        disabled={!isCtxDirty}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-app-border bg-app-surfaceSoft py-2 text-xs font-medium text-app-primary transition-all hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Save size={14} /> Save Context
                    </button>
                </div>
            </div>

            {/* Design System Section */}
            <div className="space-y-4 border-t border-app-border p-4 pt-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-app-subtle">
                    <div className="flex items-center gap-1.5">
                        <span>🎯</span> Design System Notes
                    </div>
                    {isDsDirty && <span className="text-amber-500 text-[9px]">Unsaved Changes</span>}
                </div>

                <div className="space-y-2">
                    <textarea
                        value={localDesignPrompt}
                        onChange={(e) => handleDsChange(e.target.value)}
                        placeholder={`e.g.\nPrimary color: #FF5733\nFont family: Inter, sans-serif\nBorder radius: 8px\nSpacing scale: compact\nExisting components live in src/components/ui`}
                        className="h-40 w-full resize-none rounded-xl border border-app-border bg-app-surface p-3 font-mono text-xs text-app-secondary transition-colors placeholder:text-app-subtle focus:border-app-borderStrong focus:outline-none focus:ring-1 focus:ring-app-borderStrong/30"
                    />
                    <button
                        onClick={handleSaveDs}
                        disabled={!isDsDirty}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-app-border bg-app-surfaceSoft py-2 text-xs font-medium text-app-primary transition-all hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Save size={14} /> Save Notes
                    </button>
                </div>

                <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-[11px]">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <p>
                        Your coding agent reads these notes when it builds a sketch from this project — be specific about tokens and conventions it should follow.
                    </p>
                </div>
            </div>
        </div>
    );
}
