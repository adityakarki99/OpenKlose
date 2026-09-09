export interface ComponentNode {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  /** Freeform notes about intent, states, interactions — read by the agent when it builds this sketch. */
  notes?: string;
  /** 'sketch' = an idea placed on the canvas, not yet built. 'built' = a real file exists in the repo. */
  status?: 'sketch' | 'built';
  /** Path (relative to the repo root) of the real component file, once built. */
  builtFilePath?: string;
}

export interface CanvasState {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface DragState {
  isDragging: boolean;
  nodeId: string | null;
  startX: number;
  startY: number;
  initialNodeX: number;
  initialNodeY: number;
}

export interface ResizeState {
  isResizing: boolean;
  nodeId: string | null;
  handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w' | null;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
}

export type ThemeMode = 'dark' | 'light';

export interface ProjectContext {
  projectDescription: string;
  targetAudience: string;
  brandName: string;
  brandVoice: string;
  designReferences: string;
  techNotes: string;
  productInfo: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  nodes: ComponentNode[];
  created_at: string;
  updated_at: string;
  /** Freeform notes about the project's design system (tokens, references, conventions) — read by the agent, not consumed by Klose itself. */
  designSystemPrompt?: string;
  projectContext?: ProjectContext;
}

export interface UserSettings {
  themeMode: ThemeMode;
  cssLogicalProperties: boolean;
  rtlDirection: boolean;
}
