import React, { useEffect, useRef, useState } from 'react';
import { Camera, Code2, Copy, Eye, Loader2, MessageSquarePlus, MoreHorizontal, Scan, Trash2 } from 'lucide-react';
import type { ComponentNode } from '../../types';
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH, SIZE_PRESETS } from '../../constants';

type CaptureState = 'idle' | 'working' | 'done' | 'error';

interface SketchToolbarProps {
  node: ComponentNode;
  zoom: number;
  hasPreview: boolean;
  showCode: boolean;
  canFit: boolean;
  capture: CaptureState;
  onToggleCode: () => void;
  onComment: () => void;
  onScreenshot: (toClipboard: boolean) => void;
  onFit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
  onResize: (id: string, size: { width?: number; height?: number }) => void;
}

/** Closes a popover when the pointer goes down anywhere outside it. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close only the popover; the canvas would otherwise also deselect the sketch.
      e.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-app-border" aria-hidden="true" />;

const SketchDetails: React.FC<{
  node: ComponentNode;
  canFit: boolean;
  onFit: () => void;
  onUpdate: SketchToolbarProps['onUpdate'];
  onResize: SketchToolbarProps['onResize'];
}> = ({ node, canFit, onFit, onUpdate, onResize }) => {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [notes, setNotes] = useState(node.notes || '');
  // Size fields are free text while typed and only committed on blur or
  // Enter, so a half-typed "4" doesn't snap the frame to its minimum.
  const [width, setWidth] = useState(String(Math.round(node.width)));
  const [height, setHeight] = useState(String(Math.round(node.height)));

  useEffect(() => {
    setWidth(String(Math.round(node.width)));
    setHeight(String(Math.round(node.height)));
  }, [node.width, node.height]);

  const commitSize = (axis: 'width' | 'height', raw: string) => {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      setWidth(String(Math.round(node.width)));
      setHeight(String(Math.round(node.height)));
      return;
    }
    onResize(node.id, { [axis]: value });
  };

  const field =
    'w-full rounded-lg border border-app-border bg-app-surface px-2.5 py-2 text-[13px] leading-relaxed text-app-primary outline-none focus:border-blue-500';
  const label = 'text-xs font-semibold text-app-muted';

  return (
    <div className="flex w-80 flex-col gap-3 p-3">
      <label className="flex flex-col gap-1.5">
        <span className={label}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onUpdate(node.id, { name })} placeholder="Untitled sketch" className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => onUpdate(node.id, { description })}
          placeholder="What is this component? What does it show?"
          className={`${field} h-20 resize-none`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>Notes for the agent</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onUpdate(node.id, { notes })}
          placeholder="States, interactions, data it needs, edge cases..."
          className={`${field} h-20 resize-none`}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={label}>Frame size</span>
        <div className="flex items-center gap-2">
          {(['width', 'height'] as const).map((axis) => (
            <label key={axis} className="flex flex-1 items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1.5">
              <span className="text-xs font-medium text-app-muted">{axis === 'width' ? 'W' : 'H'}</span>
              <input
                type="number"
                aria-label={axis === 'width' ? 'Frame width' : 'Frame height'}
                min={axis === 'width' ? MIN_NODE_WIDTH : MIN_NODE_HEIGHT}
                value={axis === 'width' ? width : height}
                onChange={(e) => (axis === 'width' ? setWidth : setHeight)(e.target.value)}
                onBlur={(e) => commitSize(axis, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="w-full bg-transparent text-[13px] text-app-primary outline-none"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SIZE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onResize(node.id, { width: preset.width, height: preset.height })}
              className="rounded-md border border-app-border bg-app-surface-soft px-2 py-1 text-xs font-medium text-app-secondary hover:bg-app-surface"
              title={`${preset.width} × ${preset.height}`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onFit}
            disabled={!canFit}
            className="rounded-md border border-app-border bg-app-surface-soft px-2 py-1 text-xs font-medium text-app-secondary hover:bg-app-surface disabled:opacity-40"
          >
            Fit to preview
          </button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-app-muted">
        {node.status === 'built' && node.builtFilePath
          ? <>Built at <span className="break-all font-mono text-app-secondary">{node.builtFilePath}</span></>
          : <>Ask your coding agent (e.g. <code>/klose</code>) to build this sketch. It will mark it built once the real file exists.</>}
      </p>
    </div>
  );
};

/**
 * Floating toolbar above the selected sketch: its status and name, the
 * sketch's details, starting a comment, the code view, and the rarer actions
 * behind ⋯. Drawn at a constant on-screen size whatever the canvas zoom.
 */
export const SketchToolbar: React.FC<SketchToolbarProps> = ({
  node,
  zoom,
  hasPreview,
  showCode,
  canFit,
  capture,
  onToggleCode,
  onComment,
  onScreenshot,
  onFit,
  onDuplicate,
  onDelete,
  onUpdate,
  onResize,
}) => {
  const [open, setOpen] = useState<'details' | 'menu' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open !== null, ref, () => setOpen(null));
  useEffect(() => setOpen(null), [node.id]);

  const isBuilt = node.status === 'built';
  const btn = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-app-secondary hover:bg-app-surface-muted/10 hover:text-app-primary';
  const iconBtn = 'grid h-8 w-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary';
  const menuItem = 'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-app-secondary hover:bg-app-surface-muted/10 hover:text-app-primary disabled:opacity-40';

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-40 pb-2.5"
      style={{ transform: `scale(${1 / zoom})`, transformOrigin: '0 100%' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div role="toolbar" aria-label={`${node.name || 'Untitled sketch'} actions`} className="relative flex items-center gap-1 whitespace-nowrap rounded-xl border border-app-border bg-app-surface-elevated p-1 shadow-xl">
        <span
          className={`mx-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
            isBuilt ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          }`}
        >
          {isBuilt ? 'Built' : 'Sketch'}
        </span>
        <span className="max-w-56 truncate px-1 text-[13px] font-semibold text-app-primary">{node.name || 'Untitled sketch'}</span>
        <Divider />
        <button type="button" className={`${btn} ${open === 'details' ? 'bg-app-surface-muted/10 text-app-primary' : ''}`} aria-expanded={open === 'details'} onClick={() => setOpen(open === 'details' ? null : 'details')}>
          Details
        </button>
        {hasPreview && (
          <button type="button" className={btn} onClick={onComment} title="Click an element in the preview to attach your comment to it (C)">
            <MessageSquarePlus size={15} /> Comment
          </button>
        )}
        {hasPreview && (
          <>
            <Divider />
            <button type="button" className={`${iconBtn} ${showCode ? 'text-blue-400' : ''}`} onClick={onToggleCode} aria-pressed={showCode} aria-label={showCode ? 'Show live preview' : 'Show preview code'} title={showCode ? 'Back to the live preview' : 'View the code behind this preview'}>
              {showCode ? <Eye size={15} /> : <Code2 size={15} />}
            </button>
          </>
        )}
        <button type="button" className={`${iconBtn} ${open === 'menu' ? 'bg-app-surface-muted/10 text-app-primary' : ''}`} aria-label="More actions" aria-haspopup="menu" aria-expanded={open === 'menu'} onClick={() => setOpen(open === 'menu' ? null : 'menu')}>
          <MoreHorizontal size={16} />
        </button>

        {open === 'menu' && (
          <div role="menu" className="absolute right-0 top-full mt-1.5 flex w-56 flex-col rounded-xl border border-app-border bg-app-surface-elevated p-1 shadow-2xl">
            {hasPreview && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  disabled={capture === 'working'}
                  onClick={(e) => {
                    onScreenshot(e.altKey || e.shiftKey);
                    setOpen(null);
                  }}
                >
                  <span className="flex items-center gap-2">
                    {capture === 'working' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Screenshot
                  </span>
                  <span className="text-xs text-app-muted">⌥ copies</span>
                </button>
                <button type="button" role="menuitem" className={menuItem} disabled={!canFit} onClick={() => { onFit(); setOpen(null); }}>
                  <span className="flex items-center gap-2"><Scan size={14} /> Fit frame to preview</span>
                </button>
                <span className="my-1 h-px bg-app-border" />
              </>
            )}
            <button type="button" role="menuitem" className={menuItem} onClick={() => { onDuplicate(); setOpen(null); }}>
              <span className="flex items-center gap-2"><Copy size={14} /> Duplicate</span>
            </button>
            <button type="button" role="menuitem" className={`${menuItem} text-red-400 hover:text-red-300`} onClick={() => { onDelete(); setOpen(null); }}>
              <span className="flex items-center gap-2"><Trash2 size={14} /> Delete</span>
              <span className="text-xs text-app-muted">⌫</span>
            </button>
          </div>
        )}

        {open === 'details' && (
          <div role="dialog" aria-label="Sketch details" className="absolute left-0 top-full mt-1.5 whitespace-normal rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl">
            <SketchDetails key={node.id} node={node} canFit={canFit} onFit={onFit} onUpdate={onUpdate} onResize={onResize} />
          </div>
        )}
      </div>
    </div>
  );
};
