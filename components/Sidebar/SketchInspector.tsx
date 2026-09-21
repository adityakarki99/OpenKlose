import React, { useEffect, useRef, useState } from 'react';
import { X, Trash2, Copy, Check, Send, Crosshair, ChevronRight } from 'lucide-react';
import { ComponentNode, SelectedElementInfo } from '../../types';
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH, SIZE_PRESETS } from '../../constants';
import { focusMovedIntoPreview } from '../../lib/targeting.js';

interface SketchInspectorProps {
  node: ComponentNode;
  projectId: string;
  projectName: string;
  /** True while this sketch's preview is accepting element picks. */
  isTargeting: boolean;
  pendingElement: SelectedElementInfo | null;
  /** The canvas focuses this after an element is picked, so the comment can be typed straight away. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Focusing the composer is itself a targeting mode — the canvas needs to know. */
  onComposerFocusChange: (focused: boolean) => void;
  onClearPendingElement: () => void;
  onConsumePendingElement: () => void;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
  /** Resizes the frame, clamped to the canvas and to the minimum frame size. */
  onResize: (id: string, size: { width?: number; height?: number }) => void;
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function describeElement(el: SelectedElementInfo): string {
  const label = el.text ? `"${el.text.slice(0, 40)}"` : el.path || el.tagName;
  return `<${el.tagName}> ${label}`;
}

function elementDetailLine(el: SelectedElementInfo): string {
  const bits = [`<${el.tagName}>`];
  if (el.text) bits.push(`text "${el.text}"`);
  if (el.path) bits.push(`path ${el.path}`);
  if (el.classes) bits.push(`classes "${el.classes}"`);
  return bits.join(', ');
}

function buildAgentText(node: ComponentNode, projectId: string, projectName: string): string {
  const lines: string[] = [];
  lines.push(`Feedback on the "${node.name || 'Untitled sketch'}" sketch (project "${projectName}", id ${projectId}, node ${node.id}):`);
  lines.push('');
  const comments = node.comments || [];
  if (comments.length === 0) {
    lines.push('(no comments left yet)');
  } else {
    comments.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.text}`);
      if (c.element) lines.push(`   ↳ targets element: ${elementDetailLine(c.element)}`);
    });
  }
  lines.push('');
  lines.push('Please address this feedback — use `npx klose project get <id>` to read the current sketch, and `npx klose project update-node` to update it.');
  return lines.join('\n');
}

/** Section keys that fold away, so the panel opens on the part people use. */
type SectionKey = 'description' | 'notes' | 'size' | 'status';

const Section: React.FC<{
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  /** Shown on the collapsed row, so the section's state is readable while folded. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, isOpen, onToggle, trailing, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  // Opening a section near the bottom of the panel should show it, not leave
  // the reader wondering whether the click did anything.
  useEffect(() => {
    if (isOpen) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isOpen]);

  return (
    <div ref={ref} className="border-t border-app-border">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-app-subtle transition-colors hover:text-app-secondary"
      >
        <ChevronRight size={11} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-left">{title}</span>
        {trailing}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
};

export const SketchInspector: React.FC<SketchInspectorProps> = ({
  node,
  projectId,
  projectName,
  isTargeting,
  pendingElement,
  composerRef,
  onComposerFocusChange,
  onClearPendingElement,
  onConsumePendingElement,
  onClose,
  onUpdate,
  onResize,
}) => {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [notes, setNotes] = useState(node.notes || '');
  const [newComment, setNewComment] = useState('');
  const [copied, setCopied] = useState(false);
  // Size fields are free text while being typed, and only committed on blur or
  // Enter — otherwise a half-typed "4" would resize the frame to the minimum.
  const [width, setWidth] = useState(String(Math.round(node.width)));
  const [height, setHeight] = useState(String(Math.round(node.height)));
  // Everything that is written once and read rarely starts folded: the panel
  // opens on the comments, which is what a review actually spends time in.
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    description: false,
    notes: false,
    size: false,
    status: false,
  });

  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    setName(node.name);
    setDescription(node.description);
    setNotes(node.notes || '');
    setNewComment('');
    setCopied(false);
  }, [node.id]);

  // Keep the size fields in step with the frame while it is dragged or fitted.
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

  const comments = node.comments || [];
  const hasPreview = !!node.code;

  const handleAddComment = () => {
    const text = newComment.trim();
    if (!text) return;
    const comment = {
      id: Math.random().toString(36).substring(7),
      text,
      createdAt: Date.now(),
      ...(pendingElement ? { element: pendingElement } : {}),
    };
    onUpdate(node.id, { comments: [...comments, comment] });
    setNewComment('');
    if (pendingElement) onConsumePendingElement();
  };

  const handleDeleteComment = (commentId: string) => {
    onUpdate(node.id, { comments: comments.filter((c) => c.id !== commentId) });
  };

  const handleCopyForAgent = async () => {
    const text = buildAgentText(node, projectId, projectName);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  };

  const isBuilt = node.status === 'built';

  return (
    <div className="absolute bottom-6 right-6 z-30 flex max-h-[calc(100vh-3rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-elevated shadow-2xl">
      {/*
        The panel is titled by the sketch it describes rather than the word
        "Sketch": with several frames on the canvas, the name is the thing that
        tells you which one you are editing.
      */}
      <div className="flex items-start justify-between gap-2 border-b border-app-border bg-app-surface-soft/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onUpdate(node.id, { name })}
            placeholder="Untitled sketch"
            aria-label="Sketch name"
            className="w-full truncate rounded bg-transparent text-sm font-semibold text-app-primary outline-none placeholder:text-app-muted focus:bg-app-surface focus:px-1.5"
          />
          <button
            onClick={() => setOpenSections((prev) => ({ ...prev, description: true }))}
            className="mt-0.5 line-clamp-2 w-full text-left text-[11px] leading-snug text-app-muted transition-colors hover:text-app-secondary"
            title="Edit the description"
          >
            {description || 'Add a description…'}
          </button>
        </div>
        <button
          onClick={onClose}
          className="mt-0.5 flex-shrink-0 rounded-lg p-1 text-app-subtle hover:bg-app-surface-muted/10 hover:text-app-primary"
          aria-label="Close inspector"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">
              Comments{comments.length > 0 ? ` (${comments.length})` : ''}
            </span>
            <button
              onClick={handleCopyForAgent}
              disabled={comments.length === 0}
              className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface-soft px-2 py-1 text-[11px] font-medium text-app-secondary transition-colors hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-40"
              title="Copy this feedback to paste into your coding agent"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy for agent'}
            </button>
          </div>

          {comments.length === 0 ? (
            <p className="py-1 text-[11px] leading-relaxed text-app-muted">
              No feedback yet. Whatever you leave here is what the agent reads next.
            </p>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="group flex items-start gap-2 rounded-lg border border-app-border bg-app-surface p-2.5">
                  <div className="min-w-0 flex-1">
                    {c.element && (
                      <div className="mb-1 inline-flex max-w-full items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                        <Crosshair size={10} className="flex-shrink-0" />
                        <span className="truncate">{describeElement(c.element)}</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-app-secondary">{c.text}</p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className="text-[10px] text-app-subtle">{timeAgo(c.createdAt)}</span>
                    <button
                      onClick={() => handleDeleteComment(c.id)}
                      className="rounded p-0.5 text-app-subtle opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      aria-label="Delete comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Section title="Description" isOpen={openSections.description} onToggle={() => toggleSection('description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onUpdate(node.id, { description })}
            placeholder="What is this component? What does it show?"
            className="h-24 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </Section>

        <Section title="Notes for the agent" isOpen={openSections.notes} onToggle={() => toggleSection('notes')}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onUpdate(node.id, { notes })}
            placeholder="States, interactions, data it needs, edge cases..."
            className="h-28 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </Section>

        <Section
          title="Frame size"
          isOpen={openSections.size}
          onToggle={() => toggleSection('size')}
          trailing={
            <span className="font-mono text-[10px] font-medium normal-case tracking-normal text-app-muted">
              {Math.round(node.width)} × {Math.round(node.height)}
            </span>
          }
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1.5">
                <span className="text-[10px] font-medium uppercase text-app-subtle">W</span>
                <input
                  type="number"
                  min={MIN_NODE_WIDTH}
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  onBlur={(e) => commitSize('width', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="w-full bg-transparent text-xs text-app-primary outline-none"
                />
              </label>
              <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1.5">
                <span className="text-[10px] font-medium uppercase text-app-subtle">H</span>
                <input
                  type="number"
                  min={MIN_NODE_HEIGHT}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  onBlur={(e) => commitSize('height', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="w-full bg-transparent text-xs text-app-primary outline-none"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => onResize(node.id, { width: preset.width, height: preset.height })}
                  className="rounded-md border border-app-border bg-app-surface-soft px-2 py-1 text-[10px] font-medium text-app-secondary transition-colors hover:bg-app-surface"
                  title={`${preset.width} × ${preset.height}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-app-muted">
              Drag a frame handle to resize — hold <kbd>Shift</kbd> to keep the ratio, <kbd>Alt</kbd> to
              ignore the grid. The frame's <span className="font-medium text-app-secondary">fit</span>{' '}
              button sizes it to its preview.
            </p>
          </div>
        </Section>

        <Section
          title="Status"
          isOpen={openSections.status}
          onToggle={() => toggleSection('status')}
          trailing={
            <span className={`text-[10px] font-semibold normal-case tracking-normal ${isBuilt ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isBuilt ? 'Built' : 'Sketch'}
            </span>
          }
        >
          {isBuilt && node.builtFilePath ? (
            <p className="break-all text-[11px] text-app-secondary">{node.builtFilePath}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-app-muted">
              Ask your coding agent (e.g. <code>/klose</code>) to build this sketch — it will mark it built once the real file exists.
            </p>
          )}
        </Section>
      </div>

      {/* The composer is pinned: a long comment list must never scroll it away. */}
      <div className="flex-shrink-0 space-y-2 border-t border-app-border bg-app-surface-elevated p-3">
        {/*
          The targeted element rides on the composer's own input line rather
          than in a block of its own further up the panel: it belongs where
          the comment is being written.
        */}
        {pendingElement && (
          <div className="flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 py-1 pl-2 pr-1 text-[11px] text-blue-200">
            <Crosshair size={11} className="flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono">{describeElement(pendingElement)}</span>
            <button
              onClick={onClearPendingElement}
              className="flex-shrink-0 rounded p-0.5 hover:text-white"
              aria-label="Clear targeted element"
            >
              <X size={11} />
            </button>
          </div>
        )}

        <div className="flex items-start gap-2">
          <textarea
            ref={composerRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onFocus={() => onComposerFocusChange(true)}
            onBlur={() => {
              // Clicking an element moves focus into the preview's iframe a
              // moment before the sandbox reports what was clicked. That blur
              // must not end targeting, or the click lands on nothing.
              window.setTimeout(() => {
                if (focusMovedIntoPreview(document.activeElement)) return;
                onComposerFocusChange(false);
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddComment();
              }
              // Escape drops the targeted element first — the draft survives.
              if (e.key === 'Escape' && pendingElement) {
                e.preventDefault();
                e.stopPropagation();
                onClearPendingElement();
              }
            }}
            placeholder={pendingElement ? 'Feedback on this element…' : 'Leave feedback on this design…'}
            className={`h-16 flex-1 resize-none rounded-lg border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none ${
              isTargeting ? 'border-blue-500' : 'border-app-border focus:border-blue-500'
            }`}
          />
          <button
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            className="flex-shrink-0 rounded-lg border border-app-border bg-app-surface-soft p-2.5 text-app-secondary transition-colors hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Add comment"
          >
            <Send size={14} />
          </button>
        </div>

        {hasPreview && (
          <p className={`px-0.5 text-[10px] leading-relaxed ${isTargeting || pendingElement ? 'text-blue-300' : 'text-app-muted'}`}>
            {pendingElement
              ? 'This comment carries the element, so the agent knows exactly what you mean.'
              : isTargeting
                ? 'Targeting is on — click any element in the preview to attach it.'
                : 'Click here, or the target button on the frame, then pick an element in the preview.'}
          </p>
        )}
      </div>
    </div>
  );
};

export default SketchInspector;
