import React from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';

interface ZoomControlProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Back to 100%, keeping the centre of the view where it is. */
  onReset: () => void;
  /** Zoom so every sketch is in view. */
  onFit: () => void;
  canFit: boolean;
  className?: string;
}

const btn =
  'grid h-8 w-8 place-items-center rounded-lg text-app-secondary transition-colors hover:bg-app-surface-muted/10 hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60';

/**
 * Zoom out / current zoom / zoom in / fit all. Each control names its shortcut
 * in its tooltip, since the shortcuts are how people end up using it.
 */
export default function ZoomControl({ zoom, onZoomIn, onZoomOut, onReset, onFit, canFit, className = '' }: ZoomControlProps) {
  return (
    <div
      role="group"
      aria-label="Zoom"
      className={`flex items-center gap-0.5 rounded-xl border border-app-border bg-app-surface-elevated p-1 shadow-xl ${className}`}
    >
      <button type="button" className={btn} onClick={onZoomOut} aria-label="Zoom out" title="Zoom out (⌘ −)">
        <Minus size={15} />
      </button>
      <button
        type="button"
        onClick={onReset}
        className="h-8 min-w-[52px] rounded-lg px-1.5 font-mono text-xs font-semibold tabular-nums text-app-primary hover:bg-app-surface-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to 100%`}
        title="Reset to 100% (⌘ 0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in (⌘ +)">
        <Plus size={15} />
      </button>
      <span className="mx-0.5 h-5 w-px bg-app-border" aria-hidden="true" />
      <button type="button" className={btn} onClick={onFit} disabled={!canFit} aria-label="Fit all sketches" title="Fit all sketches (⇧ 1)">
        <Maximize size={14} />
      </button>
    </div>
  );
}
