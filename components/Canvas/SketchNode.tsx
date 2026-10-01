import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, FileCode2, MessageSquare, Sparkles } from 'lucide-react';
import { ComponentNode, LintResult, PinPosition, SelectedElementInfo } from '../../types';
import { RESIZE_HANDLE_HIT_SIZE, RESIZE_HANDLE_SIZE } from '../../constants';
import { copyImageToClipboard, downloadDataUrl, screenshotFileName } from '../../services/exportService';
import Preview, { PreviewHandle } from '../Runtime/Preview';
import CodeView from './CodeView';
import { SketchSizePanel, SketchToolbar } from './SketchToolbar';
import { CommentPins, DRAFT_PIN_ID, SketchWidePins } from './CommentPins';
import { openComments } from '../../lib/feedback.js';

interface SketchNodeProps {
  node: ComponentNode;
  isSelected: boolean;
  /** True while this sketch's preview is accepting element picks. */
  isTargeting?: boolean;
  /** Why it is: the toolbar's Comment button, or the comment composer having focus. */
  targetingReason?: 'pinned' | 'composer' | null;
  /** Canvas zoom, so handles, pins and the toolbar keep a constant on-screen size. */
  zoom: number;
  /** True while a drag/resize/pan is in progress anywhere on the canvas. */
  isGesturing?: boolean;
  /** True while this node in particular is being resized. */
  isResizing?: boolean;
  /** The element picked for the comment being written, when this sketch is selected. */
  draftElement?: SelectedElementInfo | null;
  /** The comment highlighted from its pin or from the feedback tray. */
  activeCommentId?: string | null;
  /** Show the active comment as a popup by its pin (the feedback tray is collapsed). */
  showThread?: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onResizeStart: (id: string, handle: string, e: React.PointerEvent) => void;
  onInspectElement?: (info: SelectedElementInfo) => void;
  /** The toolbar's Comment button: start picking an element for a new comment. */
  onComment?: (id: string) => void;
  /** Resize this node so the preview fits exactly, with sizes already in canvas units. */
  onFitToContent?: (id: string, width: number, height: number) => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
  onResize: (id: string, size: { width?: number; height?: number }) => void;
  onPinClick: (nodeId: string, commentId: string) => void;
  onOpenInTray: () => void;
  onDeleteComment: (nodeId: string, commentId: string) => void;
  /** Set for a few seconds after the agent changed this sketch, e.g. "Updated by agent". */
  agentBadge?: string | null;
  /** Whether the server has a TYPESAFE_API_KEY (Jev). */
  jevAvailable?: boolean;
  onClassify?: (id: string) => Promise<void>;
  onLint?: (id: string) => Promise<LintResult>;
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
  isTargeting = false,
  targetingReason = null,
  zoom,
  isGesturing = false,
  isResizing = false,
  draftElement = null,
  activeCommentId = null,
  showThread = false,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onResizeStart,
  onInspectElement,
  onComment,
  onFitToContent,
  onUpdate,
  onResize,
  onPinClick,
  onOpenInTray,
  onDeleteComment,
  agentBadge = null,
  jevAvailable = false,
  onClassify,
  onLint,
}) => {
  const isBuilt = node.status === 'built';
  const classification = node.classification;
  const overlaps = classification?.overlaps || [];
  // Resolved comments are history: no pins, not counted. Numbers match the tray's.
  const comments = useMemo(() => openComments(node.comments), [node.comments]);
  const commentCount = comments.length;
  const hasPreview = !!node.code;

  const previewRef = useRef<PreviewHandle>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const contentSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [capture, setCapture] = useState<CaptureState>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [canFit, setCanFit] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(41);
  const [pinPositions, setPinPositions] = useState<PinPosition[]>([]);

  // Pins sit below the header, so its height is tracked rather than read once:
  // fonts and the preview's own layout can change it after the first paint.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const handleContentSize = useCallback((size: { width: number; height: number }) => {
    contentSizeRef.current = size;
    setCanFit(size.width > 0 && size.height > 0);
  }, []);

  // Pins are only drawn on the selected sketch, so only it asks the sandbox
  // where its commented elements are.
  const pinTargets = useMemo(() => {
    if (!isSelected) return [];
    const targets = comments
      .filter((c) => c.element)
      .map((c) => ({ id: c.id, element: c.element as SelectedElementInfo }));
    if (draftElement) targets.push({ id: DRAFT_PIN_ID, element: draftElement });
    return targets;
  }, [isSelected, comments, draftElement]);

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
  const showPins = isSelected && hasPreview && !showCode && !isGesturing;

  return (
    <div
      data-node-id={node.id}
      className={`absolute flex flex-col rounded-2xl border bg-app-surface-elevated shadow-lg transition-colors ${
        isTargeting
          ? 'border-blue-500 ring-2 ring-blue-500/40'
          : isSelected
            ? 'border-blue-500 ring-2 ring-blue-500/30'
            : agentBadge
              ? 'border-violet-400 ring-4 ring-violet-400/30'
              : 'border-app-border hover:border-app-border-strong'
      }`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Toolbar buttons, pins and the code panel handle their own pointers;
        // only a primary press on the frame itself starts a drag.
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        onDragStart(node.id, e);
      }}
      onClick={(e) => onSelect(node.id, e)}
    >
      {isSelected && !isGesturing && (
        <SketchToolbar
          node={node}
          zoom={zoom}
          hasPreview={hasPreview}
          showCode={showCode}
          capture={capture}
          onToggleCode={() => setShowCode((v) => !v)}
          onComment={() => {
            setShowCode(false);
            onComment?.(node.id);
          }}
          onScreenshot={handleScreenshot}
          onDuplicate={() => onDuplicate(node.id)}
          onDelete={() => onDelete(node.id)}
          onUpdate={onUpdate}
          jevAvailable={jevAvailable}
          onClassify={onClassify ? () => onClassify(node.id) : undefined}
          onLint={onLint ? () => onLint(node.id) : undefined}
        />
      )}
      {isSelected && !isGesturing && (
        <SketchSizePanel node={node} zoom={zoom} onResize={onResize} onFit={hasPreview ? handleFit : undefined} canFit={canFit} />
      )}

      {/* The toolbar takes this spot on the selected sketch. */}
      {agentBadge && !isSelected && (
        <div
          className="pointer-events-none absolute left-3 flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-0.5 text-[11px] font-semibold text-violet-50 shadow-lg animate-in fade-in duration-200"
          style={{ bottom: '100%', marginBottom: 8 / zoom, transform: `scale(${1 / zoom})`, transformOrigin: '0 100%' }}
          role="status"
        >
          {agentBadge}
        </div>
      )}
      <div ref={headerRef} className="flex items-center gap-2 border-b border-app-border px-4 py-2.5">
        <span
          className={`flex-shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ${
            isBuilt ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'
          }`}
        >
          {isBuilt ? 'Built' : 'Sketch'}
        </span>
        <span className="flex-shrink-0 truncate text-sm font-semibold text-app-primary" style={{ maxWidth: '60%' }}>
          {node.name || 'Untitled sketch'}
        </span>
        {classification && (
          <span
            className="flex flex-shrink-0 items-center gap-1 rounded-md bg-violet-400/10 px-1.5 py-px text-[10.5px] font-medium text-violet-300"
            title={`Jev: ${classification.role} · ${classification.kind}${classification.roleConfidence != null ? ` (${Math.round(classification.roleConfidence * 100)}% sure of the role)` : ''}`}
          >
            <Sparkles size={10} aria-hidden="true" />
            {classification.role} · {classification.kind}
          </span>
        )}
        {overlaps.length > 0 && (
          <span
            className="flex-shrink-0 truncate rounded-md bg-amber-400/15 px-1.5 py-px text-[10.5px] font-medium text-amber-300"
            style={{ maxWidth: 140 }}
            title={`Looks like a second ${classification?.kind} primitive. The repo already has: ${overlaps.map((o) => `${o.name} (${o.file})`).join(', ')}`}
          >
            ≈ {overlaps[0].name}{overlaps.length > 1 ? ` +${overlaps.length - 1}` : ''}
          </span>
        )}
        {/* The built path lives in the header, so it never covers the preview. */}
        <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs text-emerald-300" title={node.builtFilePath}>
          {isBuilt && node.builtFilePath && (
            <>
              <FileCode2 size={12} className="flex-shrink-0" />
              <span className="truncate">{node.builtFilePath}</span>
            </>
          )}
        </span>
        {commentCount > 0 && (
          <span
            className="flex flex-shrink-0 items-center gap-1 rounded-full bg-app-surface-muted/10 px-1.5 py-0.5 text-[11px] font-medium text-app-secondary"
            title={`${commentCount} open comment${commentCount === 1 ? '' : 's'}`}
          >
            <MessageSquare size={11} /> {commentCount}
          </span>
        )}
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
            interactive={(isSelected || isTargeting) && !isGesturing}
            isInspecting={isTargeting}
            onElementSelect={onInspectElement}
            onContentSize={handleContentSize}
            pinTargets={pinTargets}
            onPins={setPinPositions}
          />
          {showCode && (
            <CodeView
              code={node.code}
              exportName={node.exportName}
              filePath={node.builtFilePath}
              onClose={() => setShowCode(false)}
            />
          )}
          {isTargeting && !showCode && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-200">
              <Crosshair size={12} className="flex-shrink-0" />
              {targetingReason === 'pinned'
                ? 'Click an element to comment on it'
                : 'Writing a comment: click an element to attach it'}
            </div>
          )}
          {captureError && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg border border-red-500/40 bg-app-surface-elevated/95 px-2 py-1 text-xs text-red-300 shadow">
              {captureError}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-app-secondary">
            {node.description || 'No description yet. Select this sketch and open Details to add one.'}
          </p>
        </div>
      )}

      {showPins && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: headerHeight }}>
          <div className="pointer-events-auto">
            <CommentPins
              comments={comments}
              positions={pinPositions}
              draftElement={draftElement}
              areaWidth={node.width - 2}
              areaHeight={node.height - headerHeight - 2}
              zoom={zoom}
              activeCommentId={activeCommentId}
              showThread={showThread}
              onPinClick={(commentId) => onPinClick(node.id, commentId)}
              onOpenInTray={onOpenInTray}
              onDeleteComment={(commentId) => onDeleteComment(node.id, commentId)}
            />
          </div>
        </div>
      )}
      {isSelected && !isGesturing && (
        <SketchWidePins
          comments={comments}
          zoom={zoom}
          activeCommentId={activeCommentId}
          onPinClick={(commentId) => onPinClick(node.id, commentId)}
        />
      )}

      {/* Live size readout, so a resize can hit an exact number instead of being eyeballed. */}
      {isResizing && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md border border-app-border bg-app-surface-elevated px-2 py-0.5 font-mono text-app-secondary shadow"
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
              className="rounded-full bg-app-surface-elevated"
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
