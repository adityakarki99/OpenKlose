import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Undo, Redo, Plus, Check, CloudOff, AlertTriangle, Loader2, BookOpen, Layers, Moon, Sun, Keyboard } from 'lucide-react';
import { ComponentNode } from '../../types';
import type { SaveStatus } from '../../hooks/usePersistence';
import { useSettings } from '../../contexts/SettingsContext';

interface VerticalNavigationBarProps {
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAdd: () => void;
  onSave: () => void;
  onToggleContext?: () => void;
  onShowShortcuts?: () => void;
  isSaving: boolean;
  saveStatus?: SaveStatus;
  isDirty?: boolean;
  nodes: ComponentNode[];
  onSelectNode: (id: string) => void;
  projectName?: string;
}

const Tooltip = ({ label, hidden }: { label: string; hidden?: boolean }) => (
  <span
    className={`pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded border border-app-border bg-app-surface-elevated px-2 py-1 text-xs font-medium text-app-primary shadow-lg transition-all duration-150
      ${hidden ? 'invisible opacity-0' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'}
    `}
  >
    {label}
  </span>
);

interface RailButtonProps {
  icon: React.ReactNode;
  /** Short caption shown under the icon. */
  caption: string;
  /** Longer description for the tooltip and screen readers; defaults to the caption. */
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  accent?: boolean;
  badge?: React.ReactNode;
  expanded?: boolean;
}

/** An icon with a caption under it, so nothing on the rail has to be guessed. */
const RailButton: React.FC<RailButtonProps> = ({ icon, caption, label, onClick, disabled, accent, badge, expanded }) => (
  <div className="group relative w-full px-1.5">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label || caption}
      aria-expanded={expanded}
      className={`relative flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
        disabled
          ? 'cursor-not-allowed text-app-muted opacity-50'
          : expanded
            ? 'bg-app-surface-muted/10 text-app-primary'
            : accent
              ? 'text-blue-400 hover:bg-blue-500/10'
              : 'text-app-secondary hover:bg-app-surface-muted/10 hover:text-app-primary'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium leading-tight">{caption}</span>
      {badge}
    </button>
    {label && label !== caption && <Tooltip label={label} hidden={expanded} />}
  </div>
);

const Separator = () => <div className="my-1 h-px w-8 flex-shrink-0 bg-app-border" aria-hidden="true" />;

/** The list of sketches on this canvas; picking one pans to it. */
const SketchList = ({ nodes, onSelectNode }: { nodes: ComponentNode[]; onSelectNode: (id: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  return (
    <div className="relative w-full" ref={ref}>
      <RailButton
        icon={<Layers className="h-4 w-4" />}
        caption="Sketches"
        label={`${nodes.length} sketch${nodes.length === 1 ? '' : 'es'}: jump to one`}
        onClick={() => setIsOpen((v) => !v)}
        expanded={isOpen}
        badge={
          <span className="absolute right-0.5 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-blue-500/15 px-1 font-mono text-[9.5px] font-semibold text-blue-300">
            {nodes.length}
          </span>
        }
      />
      {isOpen && (
        <div className="absolute bottom-0 left-full z-50 ml-3 flex max-h-[60vh] w-60 flex-col overflow-hidden rounded-xl border border-app-border bg-app-surface-elevated py-2 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-200">
          <div className="px-4 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-app-muted">Jump to a sketch</div>
          <div className="flex flex-col overflow-y-auto">
            {nodes.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-app-muted">No sketches on this canvas yet.</div>
            ) : (
              nodes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectNode(item.id);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-app-primary hover:bg-app-surface-muted/10 focus:bg-app-surface-muted/10 focus:outline-none"
                  title={item.name}
                >
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${item.status === 'built' ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{item.name || 'Untitled sketch'}</span>
                  <span className="flex-shrink-0 text-[11px] text-app-muted">{item.status === 'built' ? 'Built' : 'Sketch'}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The canvas's tool rail. Changes save on their own, so the save slot is a
 * status first (Saved / Saving / Unsaved / Offline / Failed) and a "save now"
 * button second.
 */
export default function VerticalNavigationBar({
  onBack,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAdd,
  onSave,
  onToggleContext,
  onShowShortcuts,
  isSaving,
  saveStatus = 'idle',
  isDirty = false,
  nodes,
  onSelectNode,
}: VerticalNavigationBarProps) {
  const { settings, updateSettings } = useSettings();
  const isLightMode = settings.themeMode === 'light';

  const save = (() => {
    if (isSaving) return { icon: <Loader2 className="h-4 w-4 animate-spin text-blue-400" />, caption: 'Saving', label: 'Saving…' };
    if (saveStatus === 'error') return { icon: <AlertTriangle className="h-4 w-4 text-red-400" />, caption: 'Retry', label: 'Save failed: click to retry' };
    if (saveStatus === 'offline') return { icon: <CloudOff className="h-4 w-4 text-amber-400" />, caption: 'Offline', label: 'Offline: changes are kept in this browser until the server is back' };
    if (isDirty) return { icon: <span className="grid h-4 w-4 place-items-center"><span className="h-2 w-2 rounded-full bg-blue-400" /></span>, caption: 'Unsaved', label: 'Saves in a moment: click to save now' };
    return { icon: <Check className="h-4 w-4 text-emerald-400" />, caption: 'Saved', label: 'All changes saved' };
  })();

  return (
    <nav
      className="z-10 flex h-fit w-[68px] flex-col items-center gap-1 rounded-2xl border border-app-border bg-app-surface-elevated py-2 font-sans text-app-primary shadow-xl"
      aria-label="Canvas tools"
    >
      <RailButton icon={<ArrowLeft className="h-4 w-4" />} caption="Files" label="Back to all Klose files" onClick={onBack} />
      <Separator />
      <RailButton icon={<Plus className="h-4 w-4" />} caption="Sketch" label="Add a sketch (N)" onClick={onAdd} accent />
      <RailButton icon={<Undo className="h-4 w-4" />} caption="Undo" label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo} />
      <RailButton icon={<Redo className="h-4 w-4" />} caption="Redo" label="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo} />
      <Separator />
      <SketchList nodes={nodes} onSelectNode={onSelectNode} />
      <RailButton icon={<BookOpen className="h-4 w-4" />} caption="Context" label="Project context the agent reads: audience, brand, design notes" onClick={onToggleContext} />
      <RailButton icon={save.icon} caption={save.caption} label={save.label} onClick={onSave} disabled={isSaving} />
      <Separator />
      <RailButton icon={<Keyboard className="h-4 w-4" />} caption="Keys" label="Keyboard shortcuts (?)" onClick={onShowShortcuts} />
      <RailButton
        icon={isLightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        caption={isLightMode ? 'Dark' : 'Light'}
        label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
        onClick={() => updateSettings({ themeMode: isLightMode ? 'dark' : 'light' })}
      />
    </nav>
  );
}
