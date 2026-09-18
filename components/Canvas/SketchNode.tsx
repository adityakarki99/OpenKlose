import React, { useCallback, useRef, useState } from 'react';
import { Trash2, Copy, FileCode2, MessageSquare, Code2, Eye, Camera, Scan, Loader2 } from 'lucide-react';
import { ComponentNode, SelectedElementInfo } from '../../types';
import { RESIZE_HANDLE_HIT_SIZE, RESIZE_HANDLE_SIZE } from '../../constants';
import { copyImageToClipboard, downloadDataUrl, screenshotFileName } from '../../services/exportService';
import Preview, { PreviewHandle } from '../Runtime/Preview';
import CodeView from './CodeView';

interface SketchNodeProps {
  node: ComponentNode;
  isSelected: boolean;
  isInspecting?: boolean;
  /** Canvas zoom, so resize handles can keep a constant on-screen size. */
  zoom: number;
  /** True while a drag/resize/pan is in progress anywhere on the canvas. */
  isGesturing?: boolean;
  /** True while this node in particular is being resized. */
  isResizing?: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onResizeStart: (id: string, handle: string, e: React.PointerEvent) => void;
  onInspectElement?: (info: SelectedElementInfo) => void;
  /** Resize this node so the preview fits exactly, with sizes already in canvas units. */
  onFitToContent?: (id: string, width: number, height: number) => void;
}

const HANDLES: { key: string; left: string; top: string; cursor: string; label: string }[] = [
  { key: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize', label: 'top left' },
  { key: 'n', left: '50%', top: '0%', cursor: 'ns-resize', label: 'top' },
  { key: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize', label: 'top right' },
  { key: 'e', left: '100%', top: '50%', cursor: 'ew-resize', label: 'right' },
  { key: 'se', left: '100%', top: '100%', cursor: 'nwse-resize', label: 'bottom right' },
  { key: 's', left: '50%', top: '100%', cursor: 'ns-resize', label: 'bottom' },
  { key: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize', label: 'bottom left' },
  { key: 'w', left: '0%', top: '50%', cursor: 'ew-resize', label: 'left' },
];

type CaptureState = 'idle' | 'working' | 'done' | 'error';

const SketchNode: React.FC<SketchNodeProps> = ({
  node,
  isSelected,
  isInspecting = false,
  zoom,
  isGesturing = false,
  isResizing = false,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onResizeStart,
  onInspectElement,
  onFitToContent,
}) => {
  const isBuilt = node.status === 'built';
  const commentCount = node.comments?.length || 0;
  const hasPreview = !!node.code;

  const previewRef = useRef<PreviewHandle>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const contentSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [capture, setCapture] = useState<CaptureState>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [canFit, setCanFit] = useState(false);

  const handleContentSize = useCallback((size: { width: number; height: number }) => {
    contentSizeRef.current = size;
    setCanFit(size.width > 0 && size.height > 0);
  }, []);

  const handleFit = () => {
    const size = contentSizeRef.current;
    if (!size || !onFitToContent) return;
    // Borders are 1px a side; the header sits above the preview area.
    const chrome = headerRef.current?.offsetHeight ?? 0;
    onFitToContent(node.id, size.width + 2, size.height + chrome + 2);
  };

  // Screenshots are taken inside the sandbox (the parent cannot read a
  // cross-origin frame), so this is always an async round-trip.
  const handleScreenshot = async (toClipboard: boolean) => {
    if (!previewRef.current || capture === 'working') return;
    setCapture('working');
    setCaptureError(null);
    try {
      const dataUrl = await previewRef.current.capture({ scale: 2 });
      if (toClipboard) await copyImageToClipboard(dataUrl);
      else downloadDataUrl(dataUrl, screenshotFileName(node.name || 'sketch'));
      setCapture('done');
      setTimeout(() => setCapture('idle'), 1500);
    } catch (err) {
      setCapture('error');
      setCaptureError(err instanceof Error ? err.message : 'Screenshot failed');
      setTimeout(() => setCapture('idle'), 4000);
    }
  };

  const handleSize = RESIZE_HANDLE_SIZE / zoom;
  const hitSize = RESIZE_HANDLE_HIT_SIZE / zoom;

  return (
    <div
      data-node-id={node.id}
      className={`absolute flex flex-col rounded-2xl border bg-app-surfaceElevated shadow-lg transition-colors ${
        isInspecting ? 'border-blue-500 ring-2 ring-blue-500/40' : isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-app-border hover:border-app-borderStrong'
      }`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Header buttons and the code panel handle their own pointers; only a
        // primary press on the frame itself starts a drag.
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        onDragStart(node.id, e);
      }}
      onClick={(e) => onSelect(node.id, e)}
    >
      <div ref={headerRef} className="flex items-center justify-between gap-2 border-b border-app-border px-4 py-2.5">
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
          {hasPreview && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCode((v) => !v); }}
              className={`rounded-md p-1 hover:bg-app-surfaceMuted/10 hover:text-app-primary ${showCode ? 'text-blue-400' : 'text-app-subtle'}`}
              aria-label={showCode ? 'Show live preview' : 'Show preview code'}
              aria-pressed={showCode}
              title={showCode ? 'Back to the live preview' : 'View the code behind this preview'}
            >
              {showCode ? <Eye size={14} /> : <Code2 size={14} />}
            </button>
          )}
          {hasPreview && isSelected && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleScreenshot(e.altKey || e.shiftKey); }}
                disabled={capture === 'working'}
                className={`rounded-md p-1 hover:bg-app-surfaceMuted/10 hover:text-app-primary disabled:opacity-60 ${
                  capture === 'error' ? 'text-red-400' : capture === 'done' ? 'text-emerald-400' : 'text-app-subtle'
                }`}
                aria-label="Screenshot this preview"
                title="Screenshot the preview (hold Alt to copy to the clipboard instead)"
              >
                {capture === 'working' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleFit(); }}
                disabled={!canFit}
                className="rounded-md p-1 text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary disabled:opacity-40"
                aria-label="Fit frame to the preview"
                title="Resize this frame to fit its preview exactly"
              >
                <Scan size={14} />
              </button>
            </>
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
        <div
          className="relative flex-1 overflow-hidden rounded-b-2xl"
          // Same surface the sandbox paints inside itself: while a resize is in
          // flight the iframe lags the frame by a paint, and matching colors
          // keeps that from flashing as a dark band.
          style={{ background: 'rgb(var(--app-surface))' }}
        >
          <Preview
            ref={previewRef}
            code={node.code}
            exportName={node.exportName}
            // An interactive iframe eats the pointer events a gesture depends on,
            // so the preview only takes them when the canvas is idle.
            interactive={(isSelected || isInspecting) && !isGesturing}
            isInspecting={isInspecting}
            onElementSelect={onInspectElement}
            onContentSize={handleContentSize}
          />
          {showCode && (
            <CodeView
              code={node.code}
              exportName={node.exportName}
              filePath={node.builtFilePath}
              onClose={() => setShowCode(false)}
            />
          )}
          {isInspecting && (
            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-[11px] font-medium text-blue-300 shadow">
              Click an element to comment on it
            </div>
          )}
          {captureError && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg border border-red-500/40 bg-app-surfaceElevated/95 px-2 py-1 text-[11px] text-red-300 shadow">
              {captureError}
            </div>
          )}
          {isBuilt && node.builtFilePath && !showCode && !captureError && (
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

      {/* Live size readout, so a resize can hit an exact number instead of being eyeballed. */}
      {isResizing && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md border border-app-border bg-app-surfaceElevated px-2 py-0.5 font-mono text-app-secondary shadow"
          style={{ top: `calc(100% + ${8 / zoom}px)`, fontSize: 11 / zoom, borderWidth: 1 / zoom }}
        >
          {Math.round(node.width)} × {Math.round(node.height)}
        </div>
      )}

      {isSelected &&
        HANDLES.map((h) => (
          <div
            key={h.key}
            role="presentation"
            aria-label={`Resize ${h.label}`}
            className="absolute z-10 flex items-center justify-center"
            style={{
              left: h.left,
              top: h.top,
              width: hitSize,
              height: hitSize,
              transform: 'translate(-50%, -50%)',
              cursor: h.cursor,
              touchAction: 'none',
            }}
            onPointerDown={(e) => { e.stopPropagation(); onResizeStart(node.id, h.key, e); }}
          >
            <div
              className="rounded-full bg-app-surfaceElevated"
              style={{
                width: handleSize,
                height: handleSize,
                border: `${Math.max(1, 2 / zoom)}px solid rgb(59 130 246)`,
              }}
            />
          </div>
        ))}
    </div>
  );
};

export default SketchNode;
