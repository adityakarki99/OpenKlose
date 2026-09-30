import React, { useRef } from 'react';
import type { ComponentNode } from '../../types';
import { boundsOf } from '../../lib/viewport.js';

interface MinimapProps {
  nodes: ComponentNode[];
  selectedNodeId: string | null;
  /** The visible part of the canvas, in canvas units. */
  view: { x: number; y: number; width: number; height: number };
  /** Centre the view on this canvas point. */
  onNavigate: (x: number, y: number) => void;
}

const WIDTH = 180;
const HEIGHT = 120;
const MARGIN = 200;

/**
 * A small overview of every sketch and where the view is. Click or drag in it
 * to move the view. Only shown once there's more than one sketch to find.
 */
export const Minimap: React.FC<MinimapProps> = ({ nodes, selectedNodeId, view, onNavigate }) => {
  const ref = useRef<HTMLDivElement>(null);
  const content = boundsOf([...nodes, view]);
  if (!content || nodes.length < 2) return null;

  // Frame the sketches and the current view with some room around them.
  const area = {
    x: content.x - MARGIN,
    y: content.y - MARGIN,
    width: content.width + MARGIN * 2,
    height: content.height + MARGIN * 2,
  };
  const scale = Math.min(WIDTH / area.width, HEIGHT / area.height);
  const offsetX = (WIDTH - area.width * scale) / 2;
  const offsetY = (HEIGHT - area.height * scale) / 2;
  const toMap = (x: number, y: number) => ({ left: offsetX + (x - area.x) * scale, top: offsetY + (y - area.y) * scale });

  const navigateFromPointer = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = area.x + (e.clientX - rect.left - offsetX) / scale;
    const y = area.y + (e.clientY - rect.top - offsetY) / scale;
    onNavigate(x, y);
  };

  const viewPos = toMap(view.x, view.y);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Map of ${nodes.length} sketches. Click to move the view.`}
      className="relative cursor-pointer overflow-hidden rounded-xl border border-app-border bg-app-surface-elevated/95 shadow-xl"
      style={{ width: WIDTH, height: HEIGHT, touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        navigateFromPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) navigateFromPointer(e);
      }}
    >
      {nodes.map((n) => {
        const pos = toMap(n.x, n.y);
        return (
          <span
            key={n.id}
            className={`absolute rounded-[2px] ${
              n.id === selectedNodeId ? 'bg-blue-400' : n.status === 'built' ? 'bg-emerald-400/60' : 'bg-app-secondary/40'
            }`}
            style={{ ...pos, width: Math.max(3, n.width * scale), height: Math.max(3, n.height * scale) }}
          />
        );
      })}
      <span
        className="pointer-events-none absolute rounded-sm border border-blue-400/80 bg-blue-400/10"
        style={{ ...viewPos, width: view.width * scale, height: view.height * scale }}
      />
    </div>
  );
};
