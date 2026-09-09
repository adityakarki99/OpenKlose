import React, { useState, useRef, useEffect } from 'react';
import { Undo, Redo, Plus, Save, LayoutGrid, Loader2, Globe, Moon, Sun } from 'lucide-react';
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
  isSaving: boolean;
  saveStatus?: SaveStatus;
  isDirty?: boolean;
  nodes: ComponentNode[];
  onSelectNode: (id: string) => void;
  projectName?: string;
}

interface ContainerProps {
  children?: React.ReactNode;
}

const NavBarContainer: React.FC<ContainerProps> = ({ children }) => (
  <nav 
    className="font-inter z-10 flex h-fit min-h-[320px] w-14 flex-col items-center rounded-2xl border border-app-border bg-app-surfaceElevated py-4 font-sans text-app-primary"
    aria-label="Sidebar Navigation"
  >
    {children}
  </nav>
);

const Tooltip = ({ label, hidden }: { label: string; hidden?: boolean }) => (
  <span 
    className={`pointer-events-none absolute left-full top-1/2 z-50 ml-4 -translate-y-1/2 whitespace-nowrap rounded border border-app-border bg-app-surfaceElevated px-2 py-1 text-xs font-medium text-app-primary shadow-lg drop-shadow-md transition-all duration-200
      ${hidden ? 'opacity-0 invisible' : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'}
    `}
  >
    {label}
  </span>
);

const BrandLogo: React.FC<{ projectName: string; onBack: () => void }> = ({ projectName, onBack }) => (
  <div className="relative group">
    <button 
      onClick={onBack}
      className="flex h-10 w-10 items-center justify-center rounded-lg transition-all hover:bg-app-surfaceMuted/10 focus:outline-none" 
      aria-label={projectName}
    >
      <div className="w-3 h-3 rounded-full bg-[#60A5FA] shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
    </button>
    <Tooltip label={projectName} />
  </div>
);

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  badge?: React.ReactNode;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, onClick, disabled, className, badge }) => (
  <div className="relative group">
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-slate-600 ${
        disabled 
          ? 'cursor-not-allowed opacity-50 text-app-subtle' 
          : 'cursor-pointer text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary'
      } ${className || ''}`}
      aria-label={label}
    >
      {icon}
      {badge}
    </button>
    <Tooltip label={label} />
  </div>
);

const Separator = () => (
  <div className="h-px w-6 flex-shrink-0 bg-app-border" aria-hidden="true" />
);

const ComponentDropdown = ({
  nodes,
  onSelectNode
}: {
  nodes: ComponentNode[];
  onSelectNode: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="group relative">
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-[#60A5FA]/50 ${isOpen ? 'bg-app-surfaceMuted/10 text-app-primary' : 'text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary'}`}
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-label="Component Navigation"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <Tooltip label="Component Nav" hidden={isOpen} />
      </div>
      
      {isOpen && (
        <div className="absolute left-full top-0 z-50 ml-4 flex max-h-[60vh] w-52 flex-col overflow-hidden rounded-xl border border-app-border bg-app-surfaceElevated py-2 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-200">
          <div className="mb-1 px-4 py-2 text-[9px] font-mono uppercase tracking-wider text-app-subtle">
            Available Components
          </div>
          <div className="flex flex-col overflow-y-auto custom-scrollbar">
            {nodes.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs font-medium italic text-app-subtle">
                No components added yet.
              </div>
            ) : (
              nodes.map(item => (
                <button 
                  key={item.id}
                  onClick={() => {
                    onSelectNode(item.id);
                    setIsOpen(false);
                  }}
                  className="w-full truncate px-4 py-2 text-left text-xs font-medium text-app-primary transition-colors hover:bg-app-surfaceMuted/10 focus:bg-app-surfaceMuted/10 focus:outline-none"
                  title={item.name}
                >
                  {item.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ComponentCounter: React.FC<{ count: number }> = ({ count }) => (
  <div className="relative group">
    <div 
      className="flex items-center justify-center w-10 h-10 rounded-lg transition-all focus:outline-none"
      aria-label="Component Counter"
    >
      <div className="flex items-center justify-center min-w-[22px] px-1.5 h-[22px] rounded-full bg-[#60A5FA]/10 text-[#60A5FA] border border-[#60A5FA]/30 text-[9px] font-mono tracking-wider">
        {count}
      </div>
    </div>
    <Tooltip label={`${count} Component${count !== 1 ? 's' : ''} Added`} />
  </div>
);

export default function VerticalNavigationBar({
  onBack,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAdd,
  onSave,
  onToggleContext,
  isSaving,
  saveStatus = 'idle',
  isDirty = false,
  nodes,
  onSelectNode,
  projectName = "Untitled Project",
}: VerticalNavigationBarProps) {
  const { settings, updateSettings } = useSettings();
  const isLightMode = settings.themeMode === 'light';
  
  const getSaveIcon = () => {
    if (isSaving) return <Loader2 className="w-4 h-4 animate-spin text-[#60A5FA]" />;
    return <Save className={`w-4 h-4 ${isDirty && !isSaving ? 'text-[#60A5FA]' : ''}`} />;
  };

  const getSaveLabel = () => {
    if (isSaving) return 'Saving...';
    if (saveStatus === 'error') return 'Save failed – click to retry';
    if (saveStatus === 'offline') return 'Offline – saved locally';
    if (saveStatus === 'saved') return 'Saved';
    if (isDirty) return 'Unsaved changes';
    return 'All changes saved';
  };

  return (
    <NavBarContainer>
      <div className="flex flex-col items-center gap-3 w-full">
        <BrandLogo projectName={projectName} onBack={onBack} />
        
        <Separator />

        <div className="flex flex-col items-center gap-2 w-full">
          <SidebarItem 
            icon={<Undo className="w-4 h-4" />} 
            label="Undo" 
            onClick={onUndo} 
            disabled={!canUndo} 
          />
          <SidebarItem 
            icon={<Redo className="w-4 h-4" />} 
            label="Redo" 
            onClick={onRedo} 
            disabled={!canRedo} 
          />
        </div>

        <Separator />

        <div className="flex flex-col items-center gap-2 w-full">
          <SidebarItem 
            icon={<Plus className="w-4 h-4" />} 
            label="Add Component" 
            onClick={onAdd}
            className="text-[#60A5FA] hover:bg-[#60A5FA]/10"
          />
          <SidebarItem 
            icon={getSaveIcon()} 
            label={getSaveLabel()} 
            onClick={onSave}
            disabled={isSaving}
            badge={isDirty && !isSaving ? <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#60A5FA] shadow-[0_0_10px_rgba(96,165,250,0.5)] animate-pulse" /> : null}
          />
          <SidebarItem
            icon={<Globe className="w-4 h-4" />}
            label="Project Context"
            onClick={onToggleContext}
          />
          <SidebarItem
            icon={isLightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={() => updateSettings({ themeMode: isLightMode ? 'dark' : 'light' })}
          />
        </div>
      </div>

      <div className="mt-auto pt-4 flex flex-col items-center gap-3 w-full shrink-0">
        <Separator />
        <div className="flex flex-col items-center gap-2 w-full">
          <ComponentDropdown nodes={nodes} onSelectNode={onSelectNode} />
          <ComponentCounter count={nodes.length} />
        </div>
      </div>
    </NavBarContainer>
  );
}
