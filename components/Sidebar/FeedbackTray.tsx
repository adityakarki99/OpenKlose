import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, ChevronRight, ChevronsRight, Copy, Loader2, MessageSquare, Plug, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { Comment, CommentTriage, ComponentNode, SelectedElementInfo } from '../../types';
import {
  buildFeedbackText,
  commentStatus,
  commentsToSend,
  countNew,
  countOpen,
  describeElement,
  openComments,
  resolvedComments,
  timeAgo,
  triageSummaryLine,
} from '../../lib/feedback.js';
import { focusMovedIntoPreview } from '../../lib/targeting.js';
import { FILE_BAR_HEIGHT } from '../Canvas/FileBar';

export const TRAY_OPEN_WIDTH = 380;
/** Open or collapsed, the tray floats this far in from the canvas's edges. */
export const TRAY_INSET = 12;
const FLOAT_TOP = FILE_BAR_HEIGHT + TRAY_INSET;

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
  /** Mark a comment addressed (resolved = true) or reopen it. */
  onSetResolved: (nodeId: string, commentId: string, resolved: boolean) => void;
  /** A copy just handed these comments to the agent. */
  onMarkSent: (commentIds: Set<string>) => void;
  onAddComment: (nodeId: string, text: string, element: SelectedElementInfo | null) => void;
  /** True while the selected sketch's preview is accepting element picks. */
  isTargeting: boolean;
  pendingElement: SelectedElementInfo | null;
  onClearPendingElement: () => void;
  /** The canvas focuses this after an element is picked, so the comment can be typed straight away. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Focusing the composer is itself a targeting mode, so the canvas needs to know. */
  onComposerFocusChange: (focused: boolean) => void;
  /** Whether the server has a TYPESAFE_API_KEY, so comments can be triaged with Jev. */
  jevAvailable?: boolean;
  /** Ask Jev what each open comment on these sketches (or every sketch) asks for, and how much work it is. */
  onTriage?: (nodeIds?: string[]) => Promise<void>;
}

const EFFORT_CHIP: Record<CommentTriage['effort'], { className: string; title: string }> = {
  quick: { className: 'bg-emerald-400/15 text-emerald-300', title: 'Jev: a small, local change' },
  moderate: { className: 'bg-amber-400/15 text-amber-300', title: 'Jev: a contained change that takes some care' },
  rethink: { className: 'bg-rose-400/15 text-rose-300', title: 'Jev: changes the design or is ambiguous; worth a conversation first' },
};

/** "quick · visual": what Jev said a comment asks for, and how much work it is. */
const TriageChip: React.FC<{ triage: CommentTriage }> = ({ triage }) => {
  const chip = EFFORT_CHIP[triage.effort] || EFFORT_CHIP.moderate;
  const pct = triage.effortConfidence != null ? ` (${Math.round(triage.effortConfidence * 100)}% sure of the effort)` : '';
  return (
    <span className={`rounded px-1.5 py-px text-[10.5px] font-medium ${chip.className}`} title={`${chip.title}${pct}`}>
      {triage.effort} · {triage.kind}
    </span>
  );
};

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
      return true;
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      return false;
    }
  };
  return { copied, copy };
}

const STATUS_CHIP: Record<'new' | 'sent', { label: string; className: string; title: string }> = {
  new: { label: 'New', className: 'bg-amber-400/15 text-amber-300', title: "Not copied for the agent yet" },
  sent: { label: 'Sent', className: 'bg-app-surface-muted/15 text-app-secondary', title: 'Copied for the agent; waiting for it to resolve this' },
};

const CommentRow: React.FC<{
  comment: Comment;
  number: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResolve: () => void;
  /** Copy just this comment for the agent; resolves to whether it reached the clipboard. */
  onCopy: () => Promise<boolean>;
}> = ({ comment, number, active, onSelect, onDelete, onResolve, onCopy }) => {
  const status = commentStatus(comment) as 'new' | 'sent';
  const chip = STATUS_CHIP[status];
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  const action = 'grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-surface-muted/10';
  return (
    <div
      ref={ref}
      className={`pointer-events-auto flex gap-2.5 rounded-xl border p-2.5 transition-colors ${
        // Solid in both states: the list floats over the canvas with nothing behind the cards.
        active ? 'border-blue-500/50 bg-app-surface shadow-[inset_0_0_0_999px_rgba(59,130,246,0.1)]' : 'border-app-border bg-app-surface hover:border-app-border-strong'
      }`}
    >
      <span className="flex flex-shrink-0 flex-col items-center gap-1.5">
        <span
          className={`grid h-[22px] w-[22px] place-items-center font-mono text-[11px] font-semibold text-white ${comment.element ? 'bg-blue-500' : 'bg-slate-600'}`}
          style={{ borderRadius: '11px 11px 11px 3px' }}
        >
          {number}
        </span>
        <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${chip.className}`} title={chip.title}>
          {chip.label}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-col gap-1 text-left" aria-label={`Show comment ${number} on the canvas`}>
          <span className={`truncate font-mono text-[11px] ${comment.element ? 'text-blue-300' : 'text-app-muted'}`}>
            {comment.element ? describeElement(comment.element) : 'Whole sketch'}
          </span>
          <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-app-secondary">{comment.text}</span>
        </button>
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs text-app-muted">{timeAgo(comment.createdAt)}</span>
            {comment.triage && <TriageChip triage={comment.triage} />}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={async () => {
                if (!(await onCopy())) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
              className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium hover:bg-app-surface-muted/10 ${copied ? 'text-emerald-400' : 'text-app-muted hover:text-app-primary'}`}
              aria-label={`Copy comment ${number} for the agent`}
              title="Copy this comment for the agent (marks it sent)"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={onResolve} className={`${action} hover:text-emerald-400`} aria-label={`Mark comment ${number} resolved`} title="Mark resolved">
              <Check size={13} />
            </button>
            <button type="button" onClick={onDelete} className={`${action} hover:text-red-400`} aria-label={`Delete comment ${number}`} title="Delete">
              <Trash2 size={13} />
            </button>
          </span>
        </span>
      </span>
    </div>
  );
};

/** A comment the agent (or the user) marked addressed, with what was changed. */
const ResolvedRow: React.FC<{ comment: Comment; onReopen: () => void; onDelete: () => void }> = ({ comment, onReopen, onDelete }) => (
  <div className="pointer-events-auto flex gap-2.5 rounded-xl border border-app-border/60 bg-app-surface p-2.5">
    <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-400" aria-hidden="true" />
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-app-muted line-through decoration-app-muted/50">{comment.text}</span>
      {comment.resolution && <span className="text-xs leading-relaxed text-emerald-300">{comment.resolution}</span>}
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-app-muted">Resolved {timeAgo(comment.resolvedAt || 0)}</span>
        <span className="flex items-center gap-0.5">
          <button type="button" onClick={onReopen} className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-surface-muted/10 hover:text-blue-300" aria-label="Reopen comment" title="Reopen">
            <RotateCcw size={13} />
          </button>
          <button type="button" onClick={onDelete} className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-surface-muted/10 hover:text-red-400" aria-label="Delete resolved comment" title="Delete">
            <Trash2 size={13} />
          </button>
        </span>
      </span>
    </span>
  </div>
);

/**
 * The feedback tray on the right of the canvas. Open, it lists every comment,
 * with numbers that match the pins on the previews, straight over the canvas:
 * only the cards are solid, and the space between them passes clicks through.
 * Below the list, one floating panel holds the chat box — with the selected
 * sketch as a tag inside it, which is also the filter — and the copy row
 * (copy, Use MCP, collapse). Collapsed, it is a summary as wide as the open
 * tray at the canvas's top right: the open-comment count (click to open) and
 * "Copy for agent".
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
  onSetResolved,
  onMarkSent,
  onAddComment,
  isTargeting,
  pendingElement,
  onClearPendingElement,
  composerRef,
  onComposerFocusChange,
  jevAvailable = false,
  onTriage,
}) => {
  const [draft, setDraft] = useState('');
  const { copied, copy } = useCopy();
  const [showResolved, setShowResolved] = useState(false);
  const [triaging, setTriaging] = useState(false);
  // Counts are of open comments: resolved ones are history, not work.
  const total = countOpen(nodes);
  // "This sketch" means nothing with no sketch selected.
  const effectiveScope: TrayScope = selectedNode ? scope : 'all';
  const scopedNodes = effectiveScope === 'sketch' && selectedNode ? [selectedNode] : nodes;
  const scopedNew = countNew(scopedNodes);

  useEffect(() => setDraft(''), [selectedNode?.id]);
  // Selecting a sketch filters the tray to it; "All sketches" is one click back.
  useEffect(() => {
    if (selectedNode) onScopeChange('sketch');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  /** Copies what the agent hasn't seen yet (or everything open, if it has seen it all) and marks it sent. */
  const copyForAgent = async (forNodes: ComponentNode[] = scopedNodes) => {
    const { ids } = commentsToSend(forNodes);
    const ok = await copy(buildFeedbackText({ projectId, projectName, nodes: forNodes, only: ids }));
    if (ok) onMarkSent(ids);
  };

  const copyOne = async (node: ComponentNode, commentId: string) => {
    const ids = new Set([commentId]);
    const ok = await copy(buildFeedbackText({ projectId, projectName, nodes: [node], only: ids }));
    if (ok) onMarkSent(ids);
    return ok;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || !selectedNode) return;
    onAddComment(selectedNode.id, text, pendingElement);
    setDraft('');
  };

  /** Ask Jev about the open comments in view. The canvas reports the outcome in a toast. */
  const runTriage = async () => {
    if (!onTriage || triaging) return;
    setTriaging(true);
    try {
      await onTriage(effectiveScope === 'sketch' && selectedNode ? [selectedNode.id] : undefined);
    } finally {
      setTriaging(false);
    }
  };

  if (!open) {
    const totalNew = countNew(nodes);
    return (
      <div
        role="region"
        aria-label="Feedback, collapsed"
        className="absolute z-30 flex items-center gap-1 rounded-2xl border border-app-border bg-app-surface-elevated p-1.5 shadow-2xl shadow-black/40"
        style={{ top: FLOAT_TOP, right: TRAY_INSET, width: TRAY_OPEN_WIDTH }}
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 text-app-primary hover:bg-app-surface-muted/10"
          aria-label={`Open feedback, ${total} open comment${total === 1 ? '' : 's'}`}
          title="Open feedback"
        >
          <MessageSquare size={16} className="text-app-muted" />
          <span className="font-mono text-[13px] font-semibold">{total}</span>
          <span className="text-[13px] text-app-secondary">comment{total === 1 ? '' : 's'}</span>
          {totalNew > 0 && (
            <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${STATUS_CHIP.new.className}`} title={STATUS_CHIP.new.title}>
              {totalNew} new
            </span>
          )}
        </button>
        <span className="h-5 w-px bg-app-border" aria-hidden="true" />
        <button
          type="button"
          onClick={() => copyForAgent(nodes)}
          disabled={total === 0}
          className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Copy all feedback for the agent"
          title={copied ? 'Copied — marked as sent' : 'Copy all feedback for the agent'}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    );
  }

  const visible = scopedNodes.filter((n) => effectiveScope === 'sketch' || openComments(n.comments).length > 0);
  const scopedCount = countOpen(scopedNodes);
  const triageLine = triageSummaryLine(scopedNodes);
  const scopedResolved = scopedNodes.flatMap((n) => resolvedComments(n.comments).map((comment) => ({ node: n, comment })));
  const copyLabel = copied
    ? 'Copied — marked as sent'
    : scopedNew > 0
      ? `Copy ${scopedNew} new comment${scopedNew === 1 ? '' : 's'}`
      : scopedCount > 0
        ? `Copy ${scopedCount} open comment${scopedCount === 1 ? '' : 's'} again`
        : 'Copy feedback';

  return (
    <aside
      aria-label="Feedback"
      className="pointer-events-none absolute z-30 flex flex-col gap-3"
      style={{ width: TRAY_OPEN_WIDTH, top: FLOAT_TOP, right: TRAY_INSET, bottom: TRAY_INSET }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-1 canvas-scroll">
        {triageLine && (
          <p className="pointer-events-auto flex items-center gap-1.5 self-start rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-[11px] font-medium text-app-secondary" title="How Jev triaged the open comments, by effort">
            <Sparkles size={11} className="text-violet-300" aria-hidden="true" />
            {triageLine}
          </p>
        )}
        {visible.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-app-muted">
            {scopedResolved.length > 0
              ? 'All caught up: nothing open. Resolved comments are below.'
              : 'No feedback yet. Select a sketch and write a comment below. Whatever you leave here is what the agent reads next.'}
          </p>
        )}
        {visible.map((node) => {
          const comments = openComments(node.comments);
          return (
            <section key={node.id} className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onSelectNode(node.id);
                  onScopeChange('sketch');
                }}
                className="pointer-events-auto flex items-center gap-2 py-0.5 text-left text-[13px] font-semibold text-app-primary hover:text-blue-300"
              >
                <StatusDot node={node} />
                <span className="flex-1 truncate">{node.name || 'Untitled sketch'}</span>
                <span className="text-xs font-normal text-app-muted">{comments.length} open</span>
              </button>
              {comments.length === 0 && (
                <p className="text-xs leading-relaxed text-app-muted">
                  {resolvedComments(node.comments).length > 0 ? 'Nothing open on this sketch. Everything has been resolved.' : 'No feedback on this sketch yet.'}
                </p>
              )}
              {comments.map((comment, index) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  number={index + 1}
                  active={activeComment?.commentId === comment.id}
                  onSelect={() => onSelectComment(node.id, comment.id)}
                  onDelete={() => onDeleteComment(node.id, comment.id)}
                  onResolve={() => onSetResolved(node.id, comment.id, true)}
                  onCopy={() => copyOne(node, comment.id)}
                />
              ))}
            </section>
          );
        })}
        {scopedResolved.length > 0 && (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              aria-expanded={showResolved}
              className="pointer-events-auto flex items-center gap-1.5 self-start py-0.5 text-left text-xs font-medium text-app-muted hover:text-app-secondary"
            >
              {showResolved ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Resolved · {scopedResolved.length}
            </button>
            {showResolved &&
              scopedResolved.map(({ node, comment }) => (
                <ResolvedRow
                  key={comment.id}
                  comment={comment}
                  onReopen={() => onSetResolved(node.id, comment.id, false)}
                  onDelete={() => onDeleteComment(node.id, comment.id)}
                />
              ))}
          </section>
        )}
        {visible.some((n) => n.comments?.some((c) => c.element)) && (
          <p className="text-xs leading-relaxed text-app-muted">Click a pin on a preview to find its comment, or a comment here to find its element.</p>
        )}
      </div>

      <div className="pointer-events-auto flex flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-elevated shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-2 px-4 pb-3 pt-3">
          <div
            className={`relative flex flex-col gap-1.5 rounded-2xl border bg-app-surface p-2 ${!selectedNode ? 'opacity-60' : ''} ${
              isTargeting ? 'border-blue-500' : 'border-app-border focus-within:border-blue-500'
            }`}
          >
            {/* The sketch being commented on, which is also the list's filter: pressed shows
                only its comments, ✕ goes back to every sketch's. */}
            {selectedNode && (
              <span
                className={`flex min-w-0 max-w-[calc(100%-3rem)] items-center gap-1.5 self-start rounded-full py-0.5 pl-2 pr-0.5 text-xs font-medium ${
                  effectiveScope === 'sketch' ? 'bg-app-surface-muted/10 text-app-primary ring-1 ring-blue-500/50' : 'text-app-secondary ring-1 ring-app-border'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onScopeChange('sketch')}
                  aria-pressed={effectiveScope === 'sketch'}
                  className="flex min-w-0 items-center gap-1.5"
                  title={effectiveScope === 'sketch' ? `Showing ${selectedNode.name || 'Untitled sketch'}'s feedback` : `Show only ${selectedNode.name || 'Untitled sketch'}'s feedback`}
                >
                  <StatusDot node={selectedNode} />
                  <span className="truncate">{selectedNode.name || 'Untitled sketch'}</span>
                  <span className="font-mono text-[11px] text-app-muted">{openComments(selectedNode.comments).length}</span>
                </button>
                {effectiveScope === 'sketch' ? (
                  <button
                    type="button"
                    onClick={() => onScopeChange('all')}
                    className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary"
                    aria-label="Show all sketches"
                    title={`All sketches · ${total}`}
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <span className="w-1.5" aria-hidden="true" />
                )}
              </span>
            )}
            <textarea
              id="feedback-composer"
              ref={composerRef}
              /* The tag names the sketch; the element rides in the placeholder. */
              aria-label={selectedNode ? `Comment on ${selectedNode.name || 'Untitled sketch'}` : 'Comment'}
              value={draft}
              disabled={!selectedNode}
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
              placeholder={
                !selectedNode
                  ? 'Select a sketch to comment on it…'
                  : pendingElement
                    ? `Feedback on ${describeElement(pendingElement)}… (Esc to detach)`
                    : 'Leave feedback on this design…'
              }
              className="block h-14 w-full resize-none bg-transparent px-1.5 pr-11 text-[13px] leading-relaxed text-app-primary outline-none placeholder:text-app-muted disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || !selectedNode}
              className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-app-surface-soft disabled:text-app-muted"
              aria-label="Add comment"
              title="Add comment (Enter)"
            >
              <Send size={15} />
            </button>
          </div>
          {selectedNode?.code && !pendingElement && (
            <p className={`text-xs leading-relaxed ${isTargeting ? 'text-blue-300' : 'text-app-muted'}`}>Click an element in the preview to attach it.</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-app-border px-3 py-2.5">
          <button
            type="button"
            onClick={() => copyForAgent()}
            disabled={scopedCount === 0}
            className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            <span className="truncate">{copyLabel}</span>
          </button>
          {jevAvailable && onTriage ? (
            <button
              type="button"
              onClick={runTriage}
              disabled={scopedCount === 0 || triaging}
              className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-lg border border-app-border px-3 text-[13px] font-medium text-app-secondary hover:bg-app-surface-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
              title="Ask Jev what each open comment asks for and how much work it is (one request per sketch; sends the comments' text)"
            >
              {triaging ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Triage
            </button>
          ) : (
            /* Hand comments to the agent over MCP instead of the clipboard. Not built yet. */
            <button
              type="button"
              disabled
              className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-lg border border-app-border px-3 text-[13px] font-medium text-app-secondary hover:bg-app-surface-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
              title="Coming soon: send feedback to the agent over MCP"
            >
              <Plug size={14} />
              Use MCP
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary"
            aria-label="Collapse feedback"
            title="Collapse feedback"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};

