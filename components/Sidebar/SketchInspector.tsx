import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ComponentNode } from '../../types';

interface SketchInspectorProps {
  node: ComponentNode;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
}

export const SketchInspector: React.FC<SketchInspectorProps> = ({ node, onClose, onUpdate }) => {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [notes, setNotes] = useState(node.notes || '');

  useEffect(() => {
    setName(node.name);
    setDescription(node.description);
    setNotes(node.notes || '');
  }, [node.id]);

  return (
    <div className="absolute right-6 top-6 z-30 flex max-h-[calc(100vh-3rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surfaceElevated shadow-2xl">
      <div className="flex items-center justify-between border-b border-app-border bg-app-surfaceSoft/60 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-app-muted">Sketch</span>
        <button onClick={onClose} className="rounded-lg p-1 text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary" aria-label="Close inspector">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onUpdate(node.id, { name })}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none focus:border-blue-500"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onUpdate(node.id, { description })}
            placeholder="What is this component? What does it show?"
            className="h-24 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Notes for the agent</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onUpdate(node.id, { notes })}
            placeholder="States, interactions, data it needs, edge cases..."
            className="h-28 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </label>

        <div className="rounded-xl border border-app-border bg-app-surfaceSoft p-3">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-app-subtle">
            <span>Status</span>
            <span className={node.status === 'built' ? 'text-emerald-400' : 'text-amber-400'}>
              {node.status === 'built' ? 'Built' : 'Sketch'}
            </span>
          </div>
          {node.status === 'built' && node.builtFilePath ? (
            <p className="break-all text-[11px] text-app-secondary">{node.builtFilePath}</p>
          ) : (
            <p className="text-[11px] text-app-muted">
              Ask your coding agent (e.g. <code>/klose</code>) to build this sketch — it will mark it built once the real file exists.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SketchInspector;
