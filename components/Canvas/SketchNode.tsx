import React from 'react';
import { Trash2, Copy, FileCode2, MessageSquare } from 'lucide-react';
import { ComponentNode, SelectedElementInfo } from '../../types';
import Preview from '../Runtime/Preview';

interface SketchNodeProps {
  node: ComponentNode;
  isSelected: boolean;
  isInspecting?: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onResizeStart: (id: string, handle: string, e: React.MouseEvent) => void;
  onInspectElement?: (info: SelectedElementInfo) => void;
}

const HANDLES: { key: string; className: string; cursor: string }[] = [
  { key: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { key: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { key: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { key: 'e', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { key: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { key: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { key: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { key: 'w', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

const SketchNode: React.FC<SketchNodeProps> = ({ node, isSelected, isInspecting = false, onSelect, onDelete, onDuplicate, onDragStart, onResizeStart, onInspectElement }) => {
  const isBuilt = node.status === 'built';
  const commentCount = node.comments?.length || 0;

  return (
    <div
      data-node-id={node.id}
      className={`absolute flex flex-col rounded-2xl border bg-app-surfaceElevated shadow-lg transition-colors ${
        isInspecting ? 'border-blue-500 ring-2 ring-blue-500/40' : isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-app-border hover:border-app-borderStrong'
      }`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(node.id, e); }}
      onClick={(e) => onSelect(node.id, e)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-app-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isBuilt ? 'bg-emerald-400' : 'bg-amber-400'}`} title={isBuilt ? 'Built' : 'Sketch'} />
          <span className="truncate text-sm font-semibold text-app-primary">{node.name || 'Untitled sketch'}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {commentCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-app-surfaceMuted/10 px-1.5 py-0.5 text-[10px] font-medium text-app-subtle"
              title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
            >
              <MessageSquare size={11} /> {commentCount}
            </span>
          )}
          {isSelected && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(node.id); }}
                className="rounded-md p-1 text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary"
                aria-label="Duplicate sketch"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
                className="rounded-md p-1 text-app-subtle hover:bg-red-500/10 hover:text-red-400"
                aria-label="Delete sketch"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {node.code ? (
        <div className="relative flex-1 overflow-hidden rounded-b-2xl">
          <Preview code={node.code} interactive={isSelected} isInspecting={isInspecting} onElementSelect={onInspectElement} />
          {isInspecting && (
            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-[11px] font-medium text-blue-300 shadow">
              Click an element to comment on it
            </div>
          )}
          {isBuilt && node.builtFilePath && (
            <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-app-surfaceElevated/90 px-2 py-1 text-[11px] font-medium text-emerald-300 shadow">
              <FileCode2 size={12} /> {node.builtFilePath}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-app-secondary">
            {node.description || 'No description yet — select this sketch to add one.'}
          </p>
          {isBuilt && node.builtFilePath && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
              <FileCode2 size={12} /> {node.builtFilePath}
            </div>
          )}
        </div>
      )}
      {isSelected &&
        HANDLES.map((h) => (
          <div
            key={h.key}
            className={`absolute z-10 h-3 w-3 rounded-full border-2 border-blue-500 bg-app-surfaceElevated ${h.className}`}
            style={{ cursor: h.cursor }}
            onMouseDown={(e) => { e.stopPropagation(); onResizeStart(node.id, h.key, e); }}
          />
        ))}
    </div>
  );
};

export default SketchNode;
