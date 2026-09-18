import { ProjectContext } from './types';

export const DEFAULT_PROJECT_CONTEXT: ProjectContext = {
  projectDescription: '',
  targetAudience: '',
  brandName: '',
  brandVoice: '',
  designReferences: '',
  techNotes: '',
  productInfo: '',
};

export const CANVAS_WIDTH = 8000;
export const CANVAS_HEIGHT = 6000;
export const DEFAULT_NODE_WIDTH = 400;
export const DEFAULT_NODE_HEIGHT = 300;
export const GRID_SIZE = 20;

/** Smallest a sketch frame can be dragged to — below this the preview is unreadable. */
export const MIN_NODE_WIDTH = 200;
export const MIN_NODE_HEIGHT = 120;

/**
 * Resize handles are drawn at a constant *screen* size: the canvas scales its
 * content, so a fixed canvas-space handle becomes unusably small when zoomed out.
 */
export const RESIZE_HANDLE_SIZE = 10;
/** Invisible grab area around each handle, also in screen pixels. */
export const RESIZE_HANDLE_HIT_SIZE = 22;

/** Frame sizes offered as one-click presets in the inspector. */
export const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Mobile', width: 380, height: 700 },
  { label: 'Tablet', width: 760, height: 620 },
  { label: 'Desktop', width: 1280, height: 800 },
  { label: 'Card', width: 400, height: 300 },
];
