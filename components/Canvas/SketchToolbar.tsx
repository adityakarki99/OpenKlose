import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Code2, Copy, Eye, FileText, Loader2, MessageSquarePlus, Monitor, MoreHorizontal, Palette, RectangleHorizontal, Scan, Smartphone, Sparkles, Tablet, Trash2, X } from 'lucide-react';
import type { ComponentNode, LintResult } from '../../types';
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH, SIZE_PRESETS } from '../../constants';
import { buildLintText, findingLine } from '../../lib/lintText.js';

type CaptureState = 'idle' | 'working' | 'done' | 'error';

interface SketchToolbarProps {
  node: ComponentNode;
  zoom: number;
  hasPreview: boolean;
  showCode: boolean;
  capture: CaptureState;
  onToggleCode: () => void;
  onComment: () => void;
  onScreenshot: (toClipboard: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
  /** Whether the server has a TYPESAFE_API_KEY, so Jev can classify the sketch and suggest token replacements. */
  jevAvailable?: boolean;
  /** Ask Jev what this sketch is, and which repo primitives it looks like a copy of. */
  onClassify?: () => Promise<void>;
  /** Check the preview code's literal colours, radii and shadows against the repo's tokens. */
  onLint?: () => Promise<LintResult>;
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
  onUpdate: SketchToolbarProps['onUpdate'];
}> = ({ node, onUpdate }) => {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [notes, setNotes] = useState(node.notes || '');

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
      {node.classification && (
        <p className="text-xs leading-relaxed text-app-muted">
          Jev: <span className="text-app-secondary">{node.classification.role} · {node.classification.kind}</span>
          {node.classification.overlaps && node.classification.overlaps.length > 0 && (
            <>
              {' '}· looks like a second {node.classification.kind} primitive next to{' '}
              {node.classification.overlaps.map((o, i) => (
                <React.Fragment key={o.id}>
                  {i > 0 && ', '}
                  <span className="font-mono text-amber-300" title={o.file}>{o.name}</span>
                </React.Fragment>
              ))}
            </>
          )}
        </p>
      )}
      <p className="text-xs leading-relaxed text-app-muted">
        {node.status === 'built' && node.builtFilePath
          ? <>Built at <span className="break-all font-mono text-app-secondary">{node.builtFilePath}</span></>
          : <>Ask your coding agent (e.g. <code>/klose</code>) to build this sketch. It will mark it built once the real file exists.</>}
      </p>
    </div>
  );
};

const VERDICT_CLASS: Record<string, string> = {
  replace: 'text-emerald-300',
  maybe: 'text-amber-300',
  keep: 'text-app-muted',
};

/**
 * The sketch's token check: which literal colours, radii and shadows its
 * preview uses where the repo has a token, and (with Jev) what to use
 * instead. Runs when opened; "Copy for agent" hands the list to the agent.
 */
const SketchLintPanel: React.FC<{ node: ComponentNode; jevAvailable: boolean; onLint: () => Promise<LintResult>; onClose: () => void }> = ({ node, jevAvailable, onLint, onClose }) => {
  const [result, setResult] = useState<LintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    onLint()
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'The check failed'); });
    return () => { cancelled = true; };
    // Re-run only when the code changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.code]);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildLintText(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  };

  const tokenLine = result ? Object.entries(result.tokens).map(([k, n]) => `${n} ${k}`).join(', ') : '';
  return (
    <div role="dialog" aria-label="Token check" className="flex w-96 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-app-muted">Tokens in the preview</span>
        <button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary" aria-label="Close token check">
          <X size={13} />
        </button>
      </div>
      {!result && !error && (
        <p className="flex items-center gap-2 py-2 text-xs text-app-muted"><Loader2 size={13} className="animate-spin" /> Checking{jevAvailable ? ' with Jev' : ''}…</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <>
          <p className="text-xs leading-relaxed text-app-muted">
            {result.findings.length === 0
              ? `Nothing to change: no stock palette colours or arbitrary values where this repo has tokens (${tokenLine || 'no tokens found'}).`
              : `${result.findings.length} literal value${result.findings.length === 1 ? '' : 's'} where this repo has tokens (${tokenLine}).`}
          </p>
          {result.findings.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto canvas-scroll font-mono text-[11px] leading-relaxed">
              {result.findings.map((f) => (
                <li key={f.class} className={`break-all ${VERDICT_CLASS[f.verdict || ''] || 'text-app-secondary'}`}>{findingLine(f)}</li>
              ))}
              {result.truncated && <li className="text-app-muted">… and more; re-run after fixing these</li>}
            </ul>
          )}
          {result.jev.error && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> Jev couldn't suggest replacements: {result.jev.error}</p>
          )}
          {!jevAvailable && result.findings.some((f) => f.candidates > 0) && (
            <p className="text-xs leading-relaxed text-app-muted">Set <code className="font-mono">TYPESAFE_API_KEY</code> before starting Klose to have Jev suggest which token each should become.</p>
          )}
          {result.findings.length > 0 && (
            <button type="button" onClick={copy} className="flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-500">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy for agent'}
            </button>
          )}
        </>
      )}
    </div>
  );
};

const PRESET_ICONS: Record<string, React.ElementType> = {
  Mobile: Smartphone,
  Tablet,
  Desktop: Monitor,
  Card: RectangleHorizontal,
};

/**
 * The selected sketch's frame size, as its own small panel floating outside
 * the frame's top-left corner: W and H, one icon per size preset (the one
 * matching the frame is lit), and — for a sketch with a preview — fitting the
 * frame to it. Like the toolbar, it keeps a constant on-screen size whatever
 * the canvas zoom.
 */
export const SketchSizePanel: React.FC<{
  node: ComponentNode;
  zoom: number;
  onResize: (id: string, size: { width?: number; height?: number }) => void;
  /** Present when the sketch has a preview to fit to. */
  onFit?: () => void;
  /** False until the preview has reported the size it wants. */
  canFit?: boolean;
}> = ({ node, zoom, onResize, onFit, canFit = false }) => {
  // Free text while typed and only committed on blur or Enter, so a
  // half-typed "4" doesn't snap the frame to its minimum.
  const [width, setWidth] = useState(String(Math.round(node.width)));
  const [height, setHeight] = useState(String(Math.round(node.height)));
  useEffect(() => {
    setWidth(String(Math.round(node.width)));
    setHeight(String(Math.round(node.height)));
  }, [node.width, node.height]);

  const commit = (axis: 'width' | 'height', raw: string) => {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      setWidth(String(Math.round(node.width)));
      setHeight(String(Math.round(node.height)));
      return;
    }
    onResize(node.id, { [axis]: value });
  };

  return (
    <div
      className="absolute right-full top-0 z-40 pr-2.5"
      style={{ transform: `scale(${1 / zoom})`, transformOrigin: '100% 0' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div role="group" aria-label="Frame size" className="flex w-[52px] flex-col items-center gap-1 rounded-xl border border-app-border bg-app-surface-elevated p-1 shadow-xl">
        {(['width', 'height'] as const).map((axis) => (
          <label key={axis} className="flex w-full flex-col items-center rounded-lg px-0.5 py-1 hover:bg-app-surface-muted/10" title={axis === 'width' ? 'Frame width' : 'Frame height'}>
            <span className="text-[10px] font-semibold text-app-muted">{axis === 'width' ? 'W' : 'H'}</span>
            <input
              type="number"
              aria-label={axis === 'width' ? 'Frame width' : 'Frame height'}
              min={axis === 'width' ? MIN_NODE_WIDTH : MIN_NODE_HEIGHT}
              value={axis === 'width' ? width : height}
              onChange={(e) => (axis === 'width' ? setWidth : setHeight)(e.target.value)}
              onBlur={(e) => commit(axis, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="w-full bg-transparent text-center font-mono text-[11px] text-app-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </label>
        ))}
        <span className="my-0.5 h-px w-7 bg-app-border" aria-hidden="true" />
        {SIZE_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.label] || RectangleHorizontal;
          const active = Math.round(node.width) === preset.width && Math.round(node.height) === preset.height;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onResize(node.id, { width: preset.width, height: preset.height })}
              aria-pressed={active}
              aria-label={`${preset.label} size, ${preset.width} by ${preset.height}`}
              title={`${preset.label} · ${preset.width} × ${preset.height}`}
              className={`grid h-8 w-8 place-items-center rounded-lg ${
                active ? 'bg-blue-500/15 text-blue-400' : 'text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary'
              }`}
            >
              <Icon size={15} />
            </button>
          );
        })}
        {onFit && (
          <>
            <span className="my-0.5 h-px w-7 bg-app-border" aria-hidden="true" />
            <button
              type="button"
              onClick={onFit}
              disabled={!canFit}
              aria-label="Fit frame to preview"
              title="Fit the frame to the preview"
              className="grid h-8 w-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-muted/10 hover:text-app-primary disabled:opacity-40"
            >
              <Scan size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Floating toolbar above the selected sketch: its name, starting a comment,
 * a screenshot, the code view, and the rarer actions (details, duplicate,
 * delete) behind ⋯. Fitting the frame lives with the other sizing controls,
 * in the size panel. The status badge lives
 * on the frame's own header. Drawn at a constant on-screen size whatever the
 * canvas zoom.
 */
export const SketchToolbar: React.FC<SketchToolbarProps> = ({
  node,
  zoom,
  hasPreview,
  showCode,
  capture,
  onToggleCode,
  onComment,
  onScreenshot,
  onDuplicate,
  onDelete,
  onUpdate,
  jevAvailable = false,
  onClassify,
  onLint,
}) => {
  const [open, setOpen] = useState<'details' | 'menu' | 'lint' | null>(null);
  const [classifying, setClassifying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open !== null, ref, () => setOpen(null));
  useEffect(() => setOpen(null), [node.id]);

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
        <span className="max-w-56 truncate px-2 text-[13px] font-semibold text-app-primary">{node.name || 'Untitled sketch'}</span>
        <Divider />
        {hasPreview && (
          <button type="button" className={btn} onClick={onComment} title="Click an element in the preview to attach your comment to it (C)">
            <MessageSquarePlus size={15} /> Comment
          </button>
        )}
        {hasPreview && (
          <>
            <button
              type="button"
              className={`${iconBtn} ${capture === 'done' ? 'text-emerald-400' : capture === 'error' ? 'text-red-400' : ''}`}
              disabled={capture === 'working'}
              onClick={(e) => onScreenshot(e.altKey || e.shiftKey)}
              aria-label="Screenshot"
              title="Screenshot as PNG (⌥-click copies it instead)"
            >
              {capture === 'working' ? <Loader2 size={15} className="animate-spin" /> : capture === 'done' ? <Check size={15} /> : <Camera size={15} />}
            </button>
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
            <button type="button" role="menuitem" className={menuItem} onClick={() => setOpen('details')}>
              <span className="flex items-center gap-2"><FileText size={14} /> Details…</span>
            </button>
            {hasPreview && onLint && (
              <button type="button" role="menuitem" className={menuItem} onClick={() => setOpen('lint')} title="Which literal colours, radii and shadows the preview uses where the repo has a token">
                <span className="flex items-center gap-2"><Palette size={14} /> Check tokens…</span>
              </button>
            )}
            {jevAvailable && onClassify && (
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={classifying}
                title="Ask Jev what this sketch is (role, kind) and whether the repo already has a primitive like it. Sends its name, description and notes."
                onClick={async () => {
                  setClassifying(true);
                  try {
                    await onClassify();
                  } finally {
                    setClassifying(false);
                    setOpen(null);
                  }
                }}
              >
                <span className="flex items-center gap-2">{classifying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Classify with Jev</span>
              </button>
            )}
            <span className="my-1 h-px bg-app-border" />
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
          <div role="dialog" aria-label="Sketch details" className="absolute right-0 top-full mt-1.5 whitespace-normal rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl">
            <SketchDetails key={node.id} node={node} onUpdate={onUpdate} />
          </div>
        )}
        {open === 'lint' && onLint && (
          <div className="absolute right-0 top-full mt-1.5 whitespace-normal rounded-xl border border-app-border bg-app-surface-elevated shadow-2xl">
            <SketchLintPanel node={node} jevAvailable={jevAvailable} onLint={onLint} onClose={() => setOpen(null)} />
          </div>
        )}
      </div>
    </div>
  );
};
