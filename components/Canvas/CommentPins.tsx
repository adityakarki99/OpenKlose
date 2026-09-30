import React from 'react';
import { Trash2, PanelRightOpen } from 'lucide-react';
import type { Comment, PinPosition, SelectedElementInfo } from '../../types';
import { describeElement, timeAgo } from '../../lib/feedback.js';

export const DRAFT_PIN_ID = 'draft';

interface CommentPinsProps {
  comments: Comment[];
  /** Where the sandbox found each commented element (and the draft), in preview pixels. */
  positions: PinPosition[];
  /** The element picked for the comment being written, drawn as a dashed pin. */
  draftElement: SelectedElementInfo | null;
  /** Size of the preview area the pins sit over, in canvas units. */
  areaWidth: number;
  areaHeight: number;
  /** Canvas zoom: pins and the popup keep a constant on-screen size. */
  zoom: number;
  activeCommentId: string | null;
  /** When set, the active comment opens as a popup next to its pin (the tray is collapsed). */
  showThread: boolean;
  onPinClick: (commentId: string) => void;
  onOpenInTray: () => void;
  onDeleteComment: (commentId: string) => void;
}

const PIN = 26;

/** A pin's tail points at the top-right corner of its element. */
function anchorFor(pos: PinPosition, areaWidth: number, areaHeight: number) {
  if (!pos.found || pos.x === undefined || pos.y === undefined) return null;
  const right = pos.x + (pos.width ?? 0);
  const top = pos.y;
  // An element scrolled out of the preview has nowhere to put its pin.
  if (top > areaHeight || top + (pos.height ?? 0) < 0 || right < 0 || pos.x > areaWidth) return null;
  return { left: Math.min(Math.max(right, 0), areaWidth), top: Math.max(top, 0) };
}

const Pin: React.FC<{
  label: string;
  active?: boolean;
  draft?: boolean;
  onClick?: () => void;
  ariaLabel: string;
}> = ({ label, active, draft, onClick, ariaLabel }) => (
  <button
    type="button"
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    aria-label={ariaLabel}
    aria-pressed={active}
    className={`absolute bottom-0 left-0 grid place-items-center font-mono text-[11px] font-semibold text-white shadow-lg transition-transform hover:scale-110 ${
      draft
        ? 'border-2 border-dashed border-blue-300 bg-blue-500/30'
        : active
          ? 'bg-blue-500 ring-4 ring-blue-500/40'
          : 'bg-blue-500'
    }`}
    style={{ width: PIN, height: PIN, borderRadius: `${PIN / 2}px ${PIN / 2}px ${PIN / 2}px 3px` }}
  >
    {label}
  </button>
);

/**
 * Numbered pins over a sketch's live preview, one per comment that targets an
 * element, plus a dashed pin for the element picked for the next comment.
 * Numbers match the comment order in the feedback tray and in the text copied
 * for the agent.
 */
export const CommentPins: React.FC<CommentPinsProps> = ({
  comments,
  positions,
  draftElement,
  areaWidth,
  areaHeight,
  zoom,
  activeCommentId,
  showThread,
  onPinClick,
  onOpenInTray,
  onDeleteComment,
}) => {
  const byId = new Map<string, PinPosition>(positions.map((p) => [p.id, p]));
  const scale = `scale(${1 / zoom})`;

  const pins = comments
    .map((comment, index) => ({ comment, number: index + 1, pos: byId.get(comment.id) }))
    .filter(({ comment }) => !!comment.element)
    .map((pin) => ({ ...pin, anchor: pin.pos ? anchorFor(pin.pos, areaWidth, areaHeight) : null }))
    .filter((pin) => pin.anchor);

  const draftPos = draftElement ? byId.get(DRAFT_PIN_ID) : undefined;
  const draftAnchor = draftPos ? anchorFor(draftPos, areaWidth, areaHeight) : null;
  const active = showThread ? pins.find((p) => p.comment.id === activeCommentId) : undefined;

  return (
    <>
      {pins.map(({ comment, number, anchor }) => (
        <div
          key={comment.id}
          className="absolute z-20"
          style={{ left: anchor!.left, top: anchor!.top, transform: scale, transformOrigin: '0 0' }}
        >
          <Pin
            label={String(number)}
            active={comment.id === activeCommentId}
            onClick={() => onPinClick(comment.id)}
            ariaLabel={`Comment ${number}: ${comment.text}`}
          />
        </div>
      ))}

      {draftAnchor && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: draftAnchor.left, top: draftAnchor.top, transform: scale, transformOrigin: '0 0' }}
        >
          <Pin label={String(comments.length + 1)} draft ariaLabel="Element for the next comment" />
        </div>
      )}

      {active && (
        <div
          className="absolute z-30"
          style={{ left: active.anchor!.left, top: active.anchor!.top, transform: scale, transformOrigin: '0 0' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            role="dialog"
            aria-label={`Comment ${active.number}`}
            className="absolute left-9 top-[-22px] flex w-72 flex-col rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl"
          >
            <div className="flex flex-col gap-2 border-b border-app-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] text-blue-300">
                  {active.number} · {describeElement(active.comment.element!)}
                </span>
                <span className="flex-shrink-0 text-xs text-app-muted">{timeAgo(active.comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-app-primary">{active.comment.text}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <button
                type="button"
                onClick={onOpenInTray}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/10"
              >
                <PanelRightOpen size={13} /> Open in tray
              </button>
              <button
                type="button"
                onClick={() => onDeleteComment(active.comment.id)}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-app-muted hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Pins for comments on the whole sketch rather than one element. They stack
 * just outside the frame's right edge, clear of the corner resize handle.
 */
export const SketchWidePins: React.FC<{
  comments: Comment[];
  zoom: number;
  activeCommentId: string | null;
  onPinClick: (commentId: string) => void;
}> = ({ comments, zoom, activeCommentId, onPinClick }) => {
  const pins = comments
    .map((comment, index) => ({ comment, number: index + 1 }))
    .filter(({ comment }) => !comment.element);
  if (pins.length === 0) return null;
  return (
    <div
      className="absolute left-full top-0 z-20 flex flex-col gap-1.5 pl-3"
      style={{ transform: `scale(${1 / zoom})`, transformOrigin: '0 0' }}
    >
      {pins.map(({ comment, number }) => (
        <div key={comment.id} className="relative" style={{ width: PIN, height: PIN }}>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPinClick(comment.id);
            }}
            aria-label={`Comment ${number} on the whole sketch: ${comment.text}`}
            aria-pressed={comment.id === activeCommentId}
            className={`grid h-full w-full place-items-center font-mono text-[11px] font-semibold text-white shadow-lg hover:scale-110 ${
              comment.id === activeCommentId ? 'bg-slate-500 ring-4 ring-slate-400/40' : 'bg-slate-600'
            }`}
            style={{ borderRadius: `${PIN / 2}px ${PIN / 2}px ${PIN / 2}px 3px` }}
          >
            {number}
          </button>
        </div>
      ))}
    </div>
  );
};
