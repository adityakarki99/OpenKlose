import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronsRight, Copy, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type { Comment, ComponentNode, SelectedElementInfo } from '../../types';
import { buildFeedbackText, describeElement, timeAgo } from '../../lib/feedback.js';
import { focusMovedIntoPreview } from '../../lib/targeting.js';

export const TRAY_OPEN_WIDTH = 380;
export const TRAY_COLLAPSED_WIDTH = 64;

export type TrayScope = 'sketch' | 'all';

interface FeedbackTrayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: TrayScope;
  onScopeChange: (scope: TrayScope) => void;
  nodes: ComponentNode[];
  selectedNode: ComponentNode | null;
  projectId: string;
  projectName: string;
  activeComment: { nodeId: string; commentId: string } | null;
  onSelectComment: (nodeId: string, commentId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onDeleteComment: (nodeId: string, commentId: string) => void;
  onAddComment: (nodeId: string, text: string, element: SelectedElementInfo | null) => void;
  /** True while the selected sketch's preview is accepting element picks. */
  isTargeting: boolean;
  pendingElement: SelectedElementInfo | null;
  onClearPendingElement: () => void;
  /** The canvas focuses this after an element is picked, so the comment can be typed straight away. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Focusing the composer is itself a targeting mode, so the canvas needs to know. */
  onComposerFocusChange: (focused: boolean) => void;
}

const StatusDot: React.FC<{ node: ComponentNode }> = ({ node }) => (
  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${node.status === 'built' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
);

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  };
  return { copied, copy };
}

const CommentRow: React.FC<{
  comment: Comment;
  number: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}> = ({ comment, number, active, onSelect, onDelete }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <div
      ref={ref}
      className={`group flex gap-2.5 rounded-xl border p-2.5 transition-colors ${
        active ? 'border-blue-500/50 bg-blue-500/10' : 'border-app-border bg-app-surface hover:border-app-border-strong'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 gap-2.5 text-left"
        aria-label={`Show comment ${number} on the canvas`}
      >
        <span
          className={`grid h-[22px] w-[22px] flex-shrink-0 place-items-center font-mono text-[11px] font-semibold text-white ${comment.element ? 'bg-blue-500' : 'bg-slate-600'}`}
          style={{ borderRadius: '11px 11px 11px 3px' }}
        >
          {number}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate font-mono text-[11px] ${comment.element ? 'text-blue-300' : 'text-app-muted'}`}>
              {comment.element ? describeElement(comment.element) : 'Whole sketch'}
            </span>
            <span className="flex-shrink-0 text-xs text-app-muted">{timeAgo(comment.createdAt)}</span>
          </span>
          <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-app-secondary">{comment.text}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="self-start rounded p-1 text-app-muted opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`Delete comment ${number}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
};

/**
 * The feedback tray on the right of the canvas. Open, it lists every comment
 * (for the selected sketch or all of them), with numbers that match the pins
 * on the previews, and holds the composer. Collapsed, it shrinks to a strip
 * with the open-comment count, one entry per sketch and "Copy for agent".
 */
export const FeedbackTray: React.FC<FeedbackTrayProps> = ({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  nodes,
  selectedNode,
  projectId,
  projectName,
  activeComment,
  onSelectComment,
  onSelectNode,
  onDeleteComment,
  onAddComment,
  isTargeting,
  pendingElement,
  onClearPendingElement,
  composerRef,
  onComposerFocusChange,
}) => {
  const [draft, setDraft] = useState('');
  const { copied, copy } = useCopy();
  const total = nodes.reduce((sum, n) => sum + (n.comments?.length || 0), 0);
  // "This sketch" means nothing with no sketch selected.
  const effectiveScope: TrayScope = selectedNode ? scope : 'all';
  const scopedNodes = effectiveScope === 'sketch' && selectedNode ? [selectedNode] : nodes;

  useEffect(() => setDraft(''), [selectedNode?.id]);

  const copyForAgent = () => copy(buildFeedbackText({ projectId, projectName, nodes: scopedNodes }));

  const submit = () => {
    const text = draft.trim();
    if (!text || !selectedNode) return;
    onAddComment(selectedNode.id, text, pendingElement);
    setDraft('');
  };

  if (!open) {
    return (
      <aside
        aria-label="Feedback, collapsed"
        className="absolute bottom-0 right-0 top-0 z-30 flex flex-col items-center gap-2.5 border-l border-app-border bg-app-surface-elevated py-3.5"
        style={{ width: TRAY_COLLAPSED_WIDTH }}
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="relative grid h-11 w-11 place-items-center rounded-xl bg-app-surface-muted/10 text-app-primary hover:bg-app-surface-muted/20"
          aria-label={`Open feedback, ${total} comment${total === 1 ? '' : 's'}`}
          title="Open feedback"
        >
          <MessageSquare size={18} />
          {total > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-blue-500 px-1 font-mono text-[10.5px] font-semibold text-white ring-2 ring-app-surface-elevated">
              {total}
            </span>
          )}
        </button>
        <span className="my-1 h-px w-7 bg-app-border" aria-hidden="true" />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
          {nodes.map((node) => {
            const count = node.comments?.length || 0;
            const selected = node.id === selectedNode?.id;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  onSelectNode(node.id);
                  onOpenChange(true);
                }}
                className={`flex w-11 flex-col items-center gap-1 rounded-lg py-1.5 ${selected ? 'bg-blue-500/10 ring-1 ring-blue-500/40' : 'hover:bg-app-surface-muted/10'}`}
                aria-label={`${node.name || 'Untitled sketch'}, ${count} comment${count === 1 ? '' : 's'}`}
                title={node.name || 'Untitled sketch'}
              >
                <StatusDot node={node} />
                <span className={`font-mono text-[11px] font-semibold ${count > 0 ? (selected ? 'text-blue-200' : 'text-app-secondary') : 'text-app-muted'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={copyForAgent}
          disabled={total === 0}
          className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Copy all feedback for the agent"
          title="Copy all feedback for the agent"
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </aside>
    );
  }

  const visible = scopedNodes.filter((n) => effectiveScope === 'sketch' || (n.comments?.length || 0) > 0);
  const scopedCount = scopedNodes.reduce((sum, n) => sum + (n.comments?.length || 0), 0);

  return (
    <aside
      aria-label="Feedback"
      className="absolute bottom-0 right-0 top-0 z-30 flex flex-col border-l border-app-border bg-app-surface-elevated shadow-2xl"
      style={{ width: TRAY_OPEN_WIDTH }}
    >
      <div className="flex items-center gap-2.5 border-b border-app-border px-4 py-3">
        <span className="text-[15px] font-semibold text-app-primary">Feedback</span>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-500/15 px-1.5 font-mono text-[11px] font-semibold text-blue-300">{total}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="grid h-8 w-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary"
          aria-label="Collapse feedback"
          title="Collapse feedback"
        >
          <ChevronsRight size={16} />
        </button>
      </div>

      <div role="group" aria-label="Show feedback for" className="mx-4 mt-3 flex gap-0.5 rounded-lg border border-app-border p-0.5">
        {(['sketch', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={value === 'sketch' && !selectedNode}
            aria-pressed={effectiveScope === value}
            onClick={() => onScopeChange(value)}
            className={`flex-1 rounded-md py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
              effectiveScope === value ? 'bg-app-surface-muted/10 font-medium text-app-primary' : 'text-app-muted hover:text-app-secondary'
            }`}
          >
            {value === 'sketch' ? 'This sketch' : `All sketches · ${total}`}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {visible.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-app-muted">
            No feedback yet. Select a sketch and write a comment below. Whatever you leave here is what the agent reads next.
          </p>
        )}
        {visible.map((node) => {
          const comments = node.comments || [];
          return (
            <section key={node.id} className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onSelectNode(node.id)}
                className="flex items-center gap-2 py-0.5 text-left text-[13px] font-semibold text-app-primary hover:text-blue-300"
              >
                <StatusDot node={node} />
                <span className="flex-1 truncate">{node.name || 'Untitled sketch'}</span>
                <span className="text-xs font-normal text-app-muted">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
              </button>
              {comments.length === 0 && (
                <p className="text-xs leading-relaxed text-app-muted">No feedback on this sketch yet.</p>
              )}
              {comments.map((comment, index) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  number={index + 1}
                  active={activeComment?.commentId === comment.id}
                  onSelect={() => onSelectComment(node.id, comment.id)}
                  onDelete={() => onDeleteComment(node.id, comment.id)}
                />
              ))}
            </section>
          );
        })}
        {visible.some((n) => n.comments?.some((c) => c.element)) && (
          <p className="text-xs leading-relaxed text-app-muted">Click a pin on a preview to find its comment, or a comment here to find its element.</p>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-col gap-2 border-t border-app-border px-4 pb-4 pt-3">
        {selectedNode ? (
          <>
            <label htmlFor="feedback-composer" className="text-xs text-app-muted">
              Comment on <span className="font-semibold text-app-primary">{selectedNode.name || 'Untitled sketch'}</span>
            </label>
            {pendingElement && (
              <div className="flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 py-1 pl-2 pr-1 font-mono text-[11px] text-blue-200">
                <span className="min-w-0 flex-1 truncate">{describeElement(pendingElement)}</span>
                <button type="button" onClick={onClearPendingElement} className="flex-shrink-0 rounded p-0.5 hover:text-white" aria-label="Don't attach this element">
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex items-start gap-2">
              <textarea
                id="feedback-composer"
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
                    submit();
                  }
                  // Escape drops the targeted element first; the draft survives.
                  if (e.key === 'Escape' && pendingElement) {
                    e.preventDefault();
                    e.stopPropagation();
                    onClearPendingElement();
                  }
                }}
                placeholder={pendingElement ? 'Feedback on this element…' : 'Leave feedback on this design…'}
                className={`h-16 flex-1 resize-none rounded-lg border bg-app-surface px-3 py-2 text-[13px] leading-relaxed text-app-primary outline-none ${
                  isTargeting ? 'border-blue-500' : 'border-app-border focus:border-blue-500'
                }`}
              />
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border border-app-border bg-app-surface-soft text-app-secondary hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Add comment"
              >
                <Send size={15} />
              </button>
            </div>
            {selectedNode.code && (
              <p className={`text-xs leading-relaxed ${isTargeting || pendingElement ? 'text-blue-300' : 'text-app-muted'}`}>
                {pendingElement
                  ? 'This comment carries the element, so the agent knows exactly what you mean.'
                  : 'Click an element in the preview to attach it.'}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs leading-relaxed text-app-muted">Select a sketch to comment on it.</p>
        )}
        <button
          type="button"
          onClick={copyForAgent}
          disabled={scopedCount === 0}
          className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : effectiveScope === 'sketch' ? 'Copy feedback for agent' : 'Copy all feedback for agent'}
        </button>
      </div>
    </aside>
  );
};

