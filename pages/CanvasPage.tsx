import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Comment, ComponentNode, DragState, Project, ResizeState, ProjectContext, SelectedElementInfo } from '../types';
import { getProject } from '../services/projectService';
import { API_BASE } from '../lib/repoScope';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  GRID_SIZE,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  DEFAULT_PROJECT_CONTEXT,
} from '../constants';
import SketchNode from '../components/Canvas/SketchNode';
import ZoomControl from '../components/Canvas/ZoomControl';
import { Minimap } from '../components/Canvas/Minimap';
import { Toast, ToastMessage } from '../components/Canvas/Toast';
import { ShortcutsDialog } from '../components/Canvas/ShortcutsDialog';
import VerticalNavigationBar from '../components/Canvas/VerticalNavigationBar';
import { FileBar, FILE_BAR_HEIGHT } from '../components/Canvas/FileBar';
import { FeedbackTray, TRAY_COLLAPSED_WIDTH, TRAY_OPEN_WIDTH, TrayScope } from '../components/Sidebar/FeedbackTray';
import { ProjectContextPanel } from '../components/Sidebar/ProjectContextPanel';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { clamp, moveFrame, resizeFrame } from '../lib/frameGeometry.js';
import { targetedNodeId, targetingReason } from '../lib/targeting.js';
import { boundsOf, fitView, isEditableTarget, stepZoom, zoomAround } from '../lib/viewport.js';
import { changeBadge, diffSketches, summarizeChanges } from '../lib/changes.js';
import { markSent } from '../lib/feedback.js';
import { mergeSketches } from '../lib/merge.js';
import { useHistory } from '../hooks/useHistory';
import { usePersistence, PersistenceData } from '../hooks/usePersistence';

/** The subset of a pointer event the drag/resize math needs. */
interface PointerSample {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
}

/** Canvas bounds and snapping rules handed to every drag/resize. */
const FRAME_LIMITS = {
  canvasWidth: CANVAS_WIDTH,
  canvasHeight: CANVAS_HEIGHT,
  minWidth: MIN_NODE_WIDTH,
  minHeight: MIN_NODE_HEIGHT,
  grid: GRID_SIZE,
};

const TRAY_STORAGE_KEY = 'klose.feedbackTray';

/** Whether the feedback tray was left open. Remembered per browser, not per project. */
function readTrayOpen(): boolean {
  try {
    return window.localStorage.getItem(TRAY_STORAGE_KEY) !== 'collapsed';
  } catch {
    return true;
  }
}

/** The fields of a project this page edits and autosaves, in one shape. */
function toSaveData(project: Project): PersistenceData {
  return {
    name: project.name,
    nodes: project.nodes || [],
    designSystemPrompt: project.designSystemPrompt || '',
    projectContext: project.projectContext || DEFAULT_PROJECT_CONTEXT,
  };
}

const CanvasPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // --- Loading State ---
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- State ---
  const [projectName, setProjectName] = useState('Untitled Project');
  const [zoom, setZoom] = useState(1);
  // Read by handlers registered once (wheel, keys, the live-update stream).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // One transient message at a time: undo a delete, what the agent just changed.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showToast = useCallback((t: Omit<ToastMessage, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Sketches the agent just changed, with the badge each wears for a few seconds.
  const [agentBadges, setAgentBadges] = useState<Record<string, string>>({});
  // The visible part of the canvas in canvas units, for the minimap.
  const [viewRect, setViewRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [commandCopied, setCommandCopied] = useState(false);

  const {
    state: nodes,
    setState: setNodes,
    setTransient: setNodesTransient,
    reset: resetNodes,
    commitToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory<ComponentNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [designSystemPrompt, setDesignSystemPrompt] = useState<string>('');
  const [projectContext, setProjectContext] = useState<ProjectContext>(DEFAULT_PROJECT_CONTEXT);
  const [isContextPopUpOpen, setIsContextPopUpOpen] = useState(false);

  // Element targeting: clicking an element in a live preview captures it as the
  // target for the next comment. Two things turn it on — the toolbar's Comment button
  // (`inspectingNodeId`), and simply focusing the comment composer
  // (`composerNodeId`), so the common case needs no mode switch at all.
  const [inspectingNodeId, setInspectingNodeId] = useState<string | null>(null);
  const [composerNodeId, setComposerNodeId] = useState<string | null>(null);
  const [pendingElement, setPendingElement] = useState<SelectedElementInfo | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // The feedback tray on the right, and the comment highlighted from a pin or
  // from the tray. With the tray collapsed, the highlighted comment opens as a
  // popup next to its pin instead.
  const [trayOpen, setTrayOpenState] = useState<boolean>(readTrayOpen);
  const [trayScope, setTrayScope] = useState<TrayScope>('sketch');
  const [activeComment, setActiveComment] = useState<{ nodeId: string; commentId: string } | null>(null);
  const trayWidth = trayOpen ? TRAY_OPEN_WIDTH : TRAY_COLLAPSED_WIDTH;

  const setTrayOpen = (open: boolean) => {
    setTrayOpenState(open);
    // A comment highlighted in the tray shouldn't pop up on the canvas the
    // moment the tray is collapsed.
    if (!open) setActiveComment(null);
    try {
      window.localStorage.setItem(TRAY_STORAGE_KEY, open ? 'open' : 'collapsed');
    } catch {
      // Storage can be unavailable (private mode); the tray still works.
    }
  };

  const canvasRef = useRef<HTMLDivElement>(null);

  const saveData = useMemo(
    () => ({ name: projectName, nodes, designSystemPrompt, projectContext }),
    [projectName, nodes, designSystemPrompt, projectContext]
  );

  const saveDataRef = useRef(saveData);
  saveDataRef.current = saveData;
  // What this tab last knew to be on disk: its load, its last save, or the
  // last version it took in from the agent. Merges are three-way against it.
  const baseRef = useRef<PersistenceData | null>(null);

  const { saveStatus, saveNow, markSaved, isDirty } = usePersistence({
    projectId: projectId || null,
    data: saveData,
    enabled: !pageLoading,
    onSaved: (saved) => {
      baseRef.current = saved;
    },
  });

  const isSaving = saveStatus === 'saving';

  // Tells the file bar that project data on disk may have changed, so it
  // re-reads each open file's name, comment count and repo state.
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  useEffect(() => {
    if (saveStatus === 'saved') setFilesRefreshKey((k) => k + 1);
  }, [saveStatus]);

  const dragStartNodesRef = useRef<ComponentNode[]>([]);
  // Pointer moves fire far faster than the canvas can lay out a frame full of
  // iframes, so they are coalesced onto animation frames instead of each one
  // triggering its own render.
  const pendingSampleRef = useRef<PointerSample | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  // Distinguishes a real drag/resize from a plain click, and remembers whether the
  // node was already selected before this mousedown — see the comment above the
  // window-listener effect below for why this matters.
  const interactionMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const wasSelectedBeforeInteractionRef = useRef(false);
  const [dragState, setDragState] = useState<DragState>({ isDragging: false, nodeId: null, startX: 0, startY: 0, initialNodeX: 0, initialNodeY: 0 });
  const [resizeState, setResizeState] = useState<ResizeState>({ isResizing: false, nodeId: null, handle: null, startX: 0, startY: 0, initialX: 0, initialY: 0, initialWidth: 0, initialHeight: 0 });
  const [canvasDrag, setCanvasDrag] = useState<{ active: boolean; startX: number; startY: number; scrollLeft: number; scrollTop: number }>({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  // While any gesture runs, previews stop taking pointer events: an iframe that
  // still accepts them swallows every move once the cursor crosses it, which is
  // what used to make a resize stall mid-drag over a preview.
  const isGesturing = dragState.isDragging || resizeState.isResizing || canvasDrag.active;

  const targetingNodeId = targetedNodeId({
    pinnedNodeId: inspectingNodeId,
    composerNodeId,
    selectedNodeId,
  });
  const targetingWhy = targetingReason({
    pinnedNodeId: inspectingNodeId,
    composerNodeId,
    selectedNodeId,
  });

  // --- Load Project on Mount ---
  useEffect(() => {
    if (!projectId) {
      setLoadError('No project ID provided');
      setPageLoading(false);
      return;
    }

    const loadProject = async () => {
      try {
        const project = await getProject(projectId);
        const loaded = toSaveData(project);
        setProjectName(loaded.name);
        // A fresh history: undo must not walk back past the load to an empty canvas.
        resetNodes(loaded.nodes);
        setDesignSystemPrompt(loaded.designSystemPrompt);
        setProjectContext(loaded.projectContext);
        // What was just read is what's on disk, so opening a file saves nothing.
        baseRef.current = loaded;
        markSaved(loaded);
        setPageLoading(false);
      } catch (err) {
        console.error('Failed to load project:', err);
        setLoadError('Failed to load project');
        setPageLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

  // Live-refresh nodes written by an external process (e.g. the /klose agent) while this tab is open.
  useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(`${API_BASE}/events`);
    source.addEventListener('update', () => {
      setFilesRefreshKey((k) => k + 1);
      getProject(projectId)
        .then((project) => {
          const base = baseRef.current;
          if (!base) return;
          const incoming = toSaveData(project);
          // Our own save coming back, or nothing new.
          if (JSON.stringify(incoming) === JSON.stringify(base)) return;

          const local = saveDataRef.current;
          const { nodes: merged, kept } = mergeSketches({ base: base.nodes, local: local.nodes, incoming: incoming.nodes });
          // Project-level fields: the incoming value, unless edited here since.
          const pick = <K extends keyof PersistenceData>(key: K): PersistenceData[K] =>
            JSON.stringify(local[key]) === JSON.stringify(base[key]) ? incoming[key] : local[key];
          const changes = diffSketches(local.nodes, merged);

          baseRef.current = incoming;
          // Disk now holds `incoming`; whatever was kept from here still
          // differs from it, so autosave writes just that back.
          markSaved(incoming);
          // The agent's version replaces history: undo must not quietly
          // revert what it wrote (and autosave the revert).
          resetNodes(merged);
          setProjectName(pick('name'));
          setDesignSystemPrompt(pick('designSystemPrompt'));
          setProjectContext(pick('projectContext'));
          if (changes.length || kept.length) announceRef.current(changes, kept.length);
        })
        .catch(() => {
          // Ignore — the next successful poll/save will reconcile.
        });
    });
    return () => source.close();
  }, [projectId]);

  // --- Helpers ---
  const smartPlaceNode = (width: number, height: number): { x: number; y: number } => {
    if (canvasRef.current) {
      const viewportX = canvasRef.current.scrollLeft;
      const viewportY = canvasRef.current.scrollTop;
      const viewportW = canvasRef.current.clientWidth;
      const viewportH = canvasRef.current.clientHeight;

      const centerX = (viewportX + viewportW / 2) / zoom - width / 2;
      const centerY = (viewportY + viewportH / 2) / zoom - height / 2;

      const isOccupied = nodes.some((n) => Math.abs(n.x - centerX) < 20 && Math.abs(n.y - centerY) < 20);

      if (isOccupied) return { x: centerX + 40, y: centerY + 40 };
      return { x: centerX, y: centerY };
    }
    return { x: 100, y: 100 };
  };

  const handleAddSketch = () => {
    const pos = smartPlaceNode(DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    const node: ComponentNode = {
      id: Math.random().toString(36).substring(7),
      name: 'New sketch',
      description: '',
      x: pos.x,
      y: pos.y,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'sketch',
    };
    setNodes((prev) => [...prev, node]);
    setSelectedNodeId(node.id);
  };

  const handleUpdateNode = (id: string, updates: Partial<ComponentNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)));
  };

  /**
   * Resizes a sketch frame, keeping it inside the canvas and above the minimum.
   * Used by the inspector's size fields and by "fit to preview" on the frame.
   */
  const handleResizeNode = (id: string, size: { width?: number; height?: number }) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const width = Math.round(
          clamp(size.width ?? n.width, MIN_NODE_WIDTH, CANVAS_WIDTH - n.x)
        );
        const height = Math.round(
          clamp(size.height ?? n.height, MIN_NODE_HEIGHT, CANVAS_HEIGHT - n.y)
        );
        if (width === n.width && height === n.height) return n;
        return { ...n, width, height, updatedAt: Date.now() };
      })
    );
  };

  const handleFitToContent = (id: string, width: number, height: number) => {
    handleResizeNode(id, { width, height });
  };

  const handleInspectElement = (info: SelectedElementInfo) => {
    setPendingElement(info);
    // The toolbar's Comment button is a one-shot pick; composer focus keeps targeting live.
    setInspectingNodeId(null);
    // The composer lives in the tray, so the tray has to be open to type in it.
    setTrayOpen(true);
    // Clicking inside the preview moved focus into its iframe. Hand it back to
    // the composer so the comment can be typed straight away — this is what
    // makes "pick an element" end where the writing happens.
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  /** The toolbar's Comment button: pick an element, then write about it. */
  const handleStartComment = (id: string) => {
    setSelectedNodeId(id);
    setInspectingNodeId(id);
    setTrayOpen(true);
  };

  const handleAddComment = (nodeId: string, text: string, element: SelectedElementInfo | null) => {
    const comment: Comment = {
      id: Math.random().toString(36).substring(7),
      text,
      createdAt: Date.now(),
      ...(element ? { element } : {}),
    };
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, comments: [...(n.comments || []), comment], updatedAt: Date.now() } : n))
    );
    if (element) setPendingElement(null);
    setActiveComment({ nodeId, commentId: comment.id });
  };

  const handleDeleteComment = (nodeId: string, commentId: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? { ...n, comments: (n.comments || []).filter((c) => c.id !== commentId), updatedAt: Date.now() } : n
      )
    );
    setActiveComment((prev) => (prev?.commentId === commentId ? null : prev));
  };

  /** A pin was clicked: show its comment in the tray, or next to the pin if the tray is collapsed. */
  const handlePinClick = (nodeId: string, commentId: string) => {
    const comment = nodes.find((n) => n.id === nodeId)?.comments?.find((c) => c.id === commentId);
    // A comment on the whole sketch has no element to put a popup next to.
    if (!trayOpen && comment && !comment.element) setTrayOpen(true);
    setActiveComment((prev) => (prev?.commentId === commentId && !trayOpen ? null : { nodeId, commentId }));
  };

  // Reset targeting/pending-element state whenever the selected sketch changes.
  useEffect(() => {
    setInspectingNodeId(null);
    setComposerNodeId(null);
    setPendingElement(null);
    setActiveComment((prev) => (prev && prev.nodeId === selectedNodeId ? prev : null));
  }, [selectedNodeId]);

  /** Deletes at once, with Undo in a toast rather than a confirm dialog in the way. */
  const handleDeleteNode = (id: string) => {
    const index = nodesRef.current.findIndex((n) => n.id === id);
    if (index < 0) return;
    const node = nodesRef.current[index];
    setNodes((prev) => prev.filter((n) => n.id !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    const fileNote = node.status === 'built' && node.builtFilePath ? ` ${node.builtFilePath} is untouched.` : '';
    showToast({
      message: `Deleted "${node.name || 'Untitled sketch'}".${fileNote}`,
      action: {
        label: 'Undo',
        onClick: () =>
          setNodes((prev) => (prev.some((n) => n.id === id) ? prev : [...prev.slice(0, index), node, ...prev.slice(index)])),
      },
    });
  };

  /** Resolve a comment by hand, or reopen one (it then counts as new, so the next copy sends it again). */
  const handleSetResolved = (nodeId: string, commentId: string, resolved: boolean) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const comments = (n.comments || []).map((c) => {
          if (c.id !== commentId) return c;
          if (resolved) return { ...c, resolvedAt: Date.now() };
          const { resolvedAt, resolution, sentAt, ...open } = c;
          return open;
        });
        return { ...n, comments, updatedAt: Date.now() };
      })
    );
    if (resolved) setActiveComment((prev) => (prev?.commentId === commentId ? null : prev));
  };

  const handleMarkSent = (ids: Set<string>) => {
    if (ids.size === 0) return;
    setNodes((prev) => {
      const next = markSent(prev, ids);
      return next.every((n, i) => n === prev[i]) ? prev : next;
    });
  };

  const handleDuplicateNode = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const newNode: ComponentNode = {
      ...node,
      id: Math.random().toString(36).substring(7),
      x: node.x + 40,
      y: node.y + 40,
      name: `${node.name} (Copy)`,
      status: 'sketch',
      builtFilePath: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  };

  const handleSaveDesignSystem = (prompt: string) => {
    setDesignSystemPrompt(prompt);
  };

  const handleSaveProject = async () => {
    await saveNow();
  };

  const handleNavigate = async (path: string) => {
    if (projectId && isDirty) {
      await saveNow();
    }
    navigate(path);
  };

  const handleBackToProjects = () => handleNavigate('/projects');

  const handleFlush = async () => {
    if (isDirty) await saveNow();
  };

  const handleSelectFromList = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && canvasRef.current) {
      setSelectedNodeId(id);
      const viewportW = canvasRef.current.clientWidth;
      const viewportH = canvasRef.current.clientHeight;
      const nodeCenterX = node.x + node.width / 2;
      const nodeCenterY = node.y + node.height / 2;
      canvasRef.current.scrollTo({
        left: nodeCenterX * zoomRef.current - viewportW / 2,
        top: nodeCenterY * zoomRef.current - viewportH / 2,
        behavior: 'smooth',
      });
    }
  };

  // --- Viewport: zoom, fit, minimap ---
  // A zoom change resizes the scroll content, so the scroll position that goes
  // with it can only be applied once React has laid the new size out.
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  const updateViewRect = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const z = zoomRef.current;
    setViewRect({ x: el.scrollLeft / z, y: el.scrollTop / z, width: el.clientWidth / z, height: el.clientHeight / z });
  }, []);

  const currentView = () => ({
    zoom: zoomRef.current,
    scrollLeft: canvasRef.current?.scrollLeft || 0,
    scrollTop: canvasRef.current?.scrollTop || 0,
  });

  const applyView = (view: { zoom: number; scrollLeft: number; scrollTop: number }, smooth = false) => {
    const el = canvasRef.current;
    if (!el) return;
    if (Math.abs(view.zoom - zoomRef.current) < 1e-6) {
      el.scrollTo({ left: view.scrollLeft, top: view.scrollTop, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    pendingScrollRef.current = { left: view.scrollLeft, top: view.scrollTop };
    zoomRef.current = view.zoom;
    setZoom(view.zoom);
  };

  useLayoutEffect(() => {
    const el = canvasRef.current;
    const pending = pendingScrollRef.current;
    if (el && pending) {
      el.scrollLeft = pending.left;
      el.scrollTop = pending.top;
      pendingScrollRef.current = null;
    }
    updateViewRect();
  }, [zoom, pageLoading, updateViewRect]);

  const viewCenter = () => ({ x: (canvasRef.current?.clientWidth || 0) / 2, y: (canvasRef.current?.clientHeight || 0) / 2 });
  const zoomBy = (direction: 1 | -1) => applyView(zoomAround(currentView(), stepZoom(zoomRef.current, direction), viewCenter()));
  const resetZoom = () => applyView(zoomAround(currentView(), 1, viewCenter()));
  const viewportSize = () => ({ width: canvasRef.current?.clientWidth || 0, height: canvasRef.current?.clientHeight || 0 });
  const fitAll = () => {
    const bounds = boundsOf(nodesRef.current);
    if (bounds) applyView(fitView(bounds, viewportSize()), true);
  };
  const fitNode = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    applyView(fitView(node, viewportSize(), { padding: 96 }), true);
  };
  const navigateTo = (x: number, y: number) => {
    const el = canvasRef.current;
    if (!el) return;
    el.scrollTo({ left: x * zoomRef.current - el.clientWidth / 2, top: y * zoomRef.current - el.clientHeight / 2 });
  };

  // ⌘/Ctrl + wheel (and trackpad pinch, which browsers report the same way)
  // zooms around the pointer. Needs a non-passive listener to stop the page zooming.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // A plain scroll handed back by a preview (see Preview.tsx) is synthetic,
        // so the browser won't scroll for it: pan by hand.
        if (!e.isTrusted) {
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
          el.scrollBy(e.deltaX * unit, e.deltaY * unit);
        }
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = Math.max(-30, Math.min(30, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      const next = zoomRef.current * Math.exp(-delta * 0.01);
      applyView(zoomAround(currentView(), next, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLoading]);

  // The canvas's size changes with the window, the tray, and once more when the
  // web fonts land after first paint, so it is observed, not read once.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateViewRect());
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageLoading, updateViewRect]);

  // When the agent writes a sketch: badge the ones it touched for a few
  // seconds, and say what happened with a way to go and look.
  const announceRef = useRef<(changes: ReturnType<typeof diffSketches>, kept: number) => void>(() => {});
  announceRef.current = (changes, kept) => {
    const ids = changes.map((c) => c.id);
    setAgentBadges((prev) => ({ ...prev, ...Object.fromEntries(changes.map((c) => [c.id, changeBadge(c)])) }));
    window.setTimeout(() => {
      setAgentBadges((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    }, 8000);
    const keptNote = kept ? `Kept your unsaved edits on ${kept} sketch${kept === 1 ? '' : 'es'}.` : '';
    showToast({
      message: [summarizeChanges(changes), keptNote].filter(Boolean).join(' · '),
      tone: 'agent',
      action: {
        label: 'Show',
        onClick: () => {
          if (ids.length === 1) return fitNode(ids[0]);
          const bounds = boundsOf(nodesRef.current.filter((n) => ids.includes(n.id)));
          if (bounds) applyView(fitView(bounds, viewportSize()), true);
        },
      },
    });
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedNodeId) return;
    setNodes((prev) =>
      prev.map((n) => (n.id === selectedNodeId ? { ...n, ...moveFrame(n, { dx, dy, snap: false, limits: FRAME_LIMITS }), updatedAt: Date.now() } : n))
    );
  };

  const copyKloseCommand = async () => {
    try {
      await navigator.clipboard.writeText('/klose');
      setCommandCopied(true);
      window.setTimeout(() => setCommandCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the command is on screen to type.
    }
  };

  // --- Interaction Handlers ---
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (dragState.isDragging || resizeState.isResizing) return;
    // Primary button / single touch only: a right-click belongs to the browser,
    // and a middle-click should not hijack the canvas either.
    if (e.button !== 0) return;
    setSelectedNodeId(null);
    setCanvasDrag({
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: canvasRef.current?.scrollLeft || 0,
      scrollTop: canvasRef.current?.scrollTop || 0,
    });
  };

  const handlePointerMove = (e: PointerSample) => {
    if (canvasDrag.active && canvasRef.current) {
      const dx = e.clientX - canvasDrag.startX;
      const dy = e.clientY - canvasDrag.startY;
      canvasRef.current.scrollLeft = canvasDrag.scrollLeft - dx;
      canvasRef.current.scrollTop = canvasDrag.scrollTop - dy;
    }

    // Everything snaps to the grid unless Alt is held, which gives pixel-exact
    // control for the last nudge.
    const snap = !e.altKey;

    if (dragState.isDragging && dragState.nodeId) {
      interactionMovedRef.current = true;
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;

      setNodesTransient((prev) =>
        prev.map((n) => {
          if (n.id !== dragState.nodeId) return n;
          const start = { ...n, x: dragState.initialNodeX, y: dragState.initialNodeY };
          return { ...n, ...moveFrame(start, { dx, dy, snap, limits: FRAME_LIMITS }) };
        })
      );
    }

    if (resizeState.isResizing && resizeState.nodeId && resizeState.handle) {
      interactionMovedRef.current = true;
      const dx = (e.clientX - resizeState.startX) / zoom;
      const dy = (e.clientY - resizeState.startY) / zoom;
      const start = {
        x: resizeState.initialX,
        y: resizeState.initialY,
        width: resizeState.initialWidth,
        height: resizeState.initialHeight,
      };
      const next = resizeFrame(start, {
        handle: resizeState.handle,
        dx,
        dy,
        snap,
        // Shift on a corner keeps the frame's starting aspect ratio.
        keepRatio: e.shiftKey,
        limits: FRAME_LIMITS,
      });

      setNodesTransient((prev) =>
        prev.map((n) => (n.id === resizeState.nodeId ? { ...n, ...next } : n))
      );
    }
  };

  const handlePointerUp = () => {
    if ((dragState.isDragging || resizeState.isResizing) && dragStartNodesRef.current.length > 0) {
      commitToHistory(dragStartNodesRef.current);
      dragStartNodesRef.current = [];
    }
    // A real drag/resize just happened — the native "click" event that follows
    // this mouseup (browsers fire one whenever mousedown and mouseup land on the
    // same element, which a drag's own mouseup usually does since the node moves
    // with the cursor) must not be allowed to toggle selection off.
    if (interactionMovedRef.current) {
      suppressClickRef.current = true;
    }
    interactionMovedRef.current = false;
    setCanvasDrag((prev) => ({ ...prev, active: false }));
    setDragState((prev) => ({ ...prev, isDragging: false, nodeId: null }));
    setResizeState((prev) => ({ ...prev, isResizing: false, nodeId: null }));
  };

  // Track drag/resize/pan at the window level, not just over the canvas div.
  //
  // Binding the move/up listeners only on the canvas div means releasing the
  // pointer over a sibling overlay (the toolbar, the inspector panel) or
  // anywhere outside the div's bounds never ends the gesture — isDragging stays
  // true forever, so the node keeps "sticking" to the cursor on the next
  // move anywhere in the canvas. Window-level listeners, active only while a
  // gesture is actually in progress, always see the release.
  useEffect(() => {
    if (!dragState.isDragging && !resizeState.isResizing && !canvasDrag.active) return;

    const onMove = (e: PointerEvent) => {
      pendingSampleRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      };
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null;
        const sample = pendingSampleRef.current;
        if (sample) handlePointerMove(sample);
      });
    };
    const onUp = () => handlePointerUp();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Safety net: alt-tabbing or otherwise losing focus mid-drag should also end it.
    window.addEventListener('blur', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
      pendingSampleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState.isDragging, resizeState.isResizing, canvasDrag.active]);

  const handleDragStart = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const node = nodes.find((n) => n.id === id);
    if (node) {
      dragStartNodesRef.current = nodes;
      interactionMovedRef.current = false;
      wasSelectedBeforeInteractionRef.current = selectedNodeId === id;
      setDragState({ isDragging: true, nodeId: id, startX: e.clientX, startY: e.clientY, initialNodeX: node.x, initialNodeY: node.y });
      setSelectedNodeId(id);
    }
  };

  const handleResizeStart = (id: string, handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const node = nodes.find((n) => n.id === id);
    if (node) {
      dragStartNodesRef.current = nodes;
      interactionMovedRef.current = false;
      wasSelectedBeforeInteractionRef.current = selectedNodeId === id;
      setResizeState({
        isResizing: true,
        nodeId: id,
        handle: handle as ResizeState['handle'],
        startX: e.clientX,
        startY: e.clientY,
        initialX: node.x,
        initialY: node.y,
        initialWidth: node.width,
        initialHeight: node.height,
      });
    }
  };

  // Keyboard shortcuts. The handler is re-read from a ref on every key, so it
  // always sees current state without re-binding the listener each render.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // A field that already handled the key (e.g. Escape dropping a picked element) wins.
    if (showShortcuts || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Escape closes the innermost thing first: a comment popup, then the selection.
      if (activeComment) setActiveComment(null);
      else setSelectedNodeId(null);
      return;
    }
    // Typing in a field (or a focused preview) owns the keyboard.
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) { if (canRedo) redo(); } else if (canUndo) undo();
      } else if (key === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        zoomBy(1);
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        zoomBy(-1);
      } else if (key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (key === 'd' && selectedNodeId) {
        e.preventDefault();
        handleDuplicateNode(selectedNodeId);
      }
      return;
    }
    if (e.altKey) return;

    // Shift+1 / Shift+2 are "!" and "@" on most layouts, so match the physical key.
    if (e.shiftKey && e.code === 'Digit1') {
      e.preventDefault();
      fitAll();
      return;
    }
    if (e.shiftKey && e.code === 'Digit2') {
      e.preventDefault();
      if (selectedNodeId) fitNode(selectedNodeId);
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      setShowShortcuts(true);
      return;
    }
    if (key === 'n' && !e.shiftKey) {
      e.preventDefault();
      handleAddSketch();
      return;
    }
    if (!selectedNodeId) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleDeleteNode(selectedNodeId);
    } else if (key === 'c' && !e.shiftKey) {
      e.preventDefault();
      handleStartComment(selectedNodeId);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? GRID_SIZE * 10 : GRID_SIZE;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      nudgeSelected(dx, dy);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Loading / Error States ---
  if (pageLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app-bg">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-app-bg">
        <p className="text-red-400 text-lg">{loadError}</p>
        <button
          onClick={() => navigate('/projects')}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-app-bg text-app-primary font-sans selection:bg-blue-500/30">
      <div className="absolute inset-0 overflow-hidden flex flex-col">
        {projectId && (
          <FileBar
            projectId={projectId}
            projectName={projectName}
            refreshKey={filesRefreshKey}
            onFlush={handleFlush}
            onNavigate={handleNavigate}
            style={{ right: trayWidth }}
          />
        )}

        <div className="absolute left-6 z-30 pointer-events-auto" style={{ top: FILE_BAR_HEIGHT + 24 }}>
          <VerticalNavigationBar
            onBack={handleBackToProjects}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onAdd={handleAddSketch}
            onSave={handleSaveProject}
            onToggleContext={() => setIsContextPopUpOpen((v) => !v)}
            onShowShortcuts={() => setShowShortcuts(true)}
            isSaving={isSaving}
            saveStatus={saveStatus}
            isDirty={isDirty}
            nodes={nodes}
            onSelectNode={handleSelectFromList}
            projectName={projectName}
          />
        </div>

        {isContextPopUpOpen && (
          <div
            className="absolute left-24 z-[100] flex h-[600px] max-h-[80vh] w-[400px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-elevated shadow-2xl animate-in fade-in slide-in-from-left-4 duration-300"
            style={{ top: FILE_BAR_HEIGHT + 24, left: 104 }}
          >
            <div className="flex items-center justify-between border-b border-app-border bg-app-surface-soft/60 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-app-muted">Project Context</span>
              <button
                onClick={() => setIsContextPopUpOpen(false)}
                className="rounded-lg p-1 text-app-subtle transition-colors hover:bg-app-surface-muted/10 hover:text-app-primary"
                aria-label="Close project context"
              >
                <X size={16} />
              </button>
            </div>
            <ProjectContextPanel
              projectContext={projectContext}
              onUpdateProjectContext={setProjectContext}
              designSystemPrompt={designSystemPrompt}
              onSaveDesignSystem={handleSaveDesignSystem}
            />
          </div>
        )}

        <div
          ref={canvasRef}
          className={`absolute bottom-0 left-0 overflow-auto canvas-scroll ${canvasDrag.active ? 'cursor-grabbing' : 'cursor-default'} ${isGesturing ? 'select-none' : ''}`}
          style={{ top: FILE_BAR_HEIGHT, right: trayWidth }}
          onPointerDown={handleCanvasPointerDown}
          onScroll={updateViewRect}
        >
          <div style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }} className="relative">
            <div
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
              className="relative"
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(rgb(var(--app-grid-dot) / 0.42) 0.75px, transparent 0.75px)',
                  backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                  opacity: 0.4,
                }}
              />
              {nodes.length === 0 && (
                <div
                  className="pointer-events-none absolute z-20 flex items-center justify-center"
                  style={{ left: viewRect.x, top: viewRect.y, width: viewRect.width || '100%', height: viewRect.height || '100%' }}
                >
                  <div className="pointer-events-auto mx-4 w-full max-w-md space-y-4 rounded-2xl border border-app-border bg-app-canvas-empty/90 p-6 shadow-2xl backdrop-blur-xl" style={{ transform: `scale(${1 / zoom})` }}>
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold text-app-primary">Ask your agent for a sketch.</h2>
                      <p className="text-sm leading-relaxed text-app-secondary">
                        Run this in Claude Code and describe the component you want. The agent reads your design system,
                        and its sketches appear here live as it writes them.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-app-border bg-app-surface px-3 py-2">
                      <code className="flex-1 font-mono text-sm text-app-primary">/klose</code>
                      <button
                        type="button"
                        onClick={copyKloseCommand}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/10"
                      >
                        {commandCopied ? <Check size={13} /> : <Copy size={13} />}
                        {commandCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="flex items-center gap-2 text-xs text-app-muted">
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      Listening for changes from the agent
                    </p>
                    <div className="border-t border-app-border pt-3 text-xs text-app-muted">
                      Or{' '}
                      <button type="button" onClick={handleAddSketch} className="font-medium text-app-secondary underline underline-offset-2 hover:text-app-primary">
                        place an empty sketch
                      </button>{' '}
                      (N) and describe it yourself first.
                    </div>
                  </div>
                </div>
              )}
              {nodes.map((node) => (
                <SketchNode
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  isTargeting={targetingNodeId === node.id}
                  targetingReason={targetingNodeId === node.id ? targetingWhy : null}
                  onComment={handleStartComment}
                  draftElement={selectedNodeId === node.id ? pendingElement : null}
                  activeCommentId={activeComment?.nodeId === node.id ? activeComment.commentId : null}
                  showThread={!trayOpen}
                  onUpdate={handleUpdateNode}
                  onResize={handleResizeNode}
                  onPinClick={handlePinClick}
                  onOpenInTray={() => setTrayOpen(true)}
                  onDeleteComment={handleDeleteComment}
                  zoom={zoom}
                  isGesturing={isGesturing}
                  isResizing={resizeState.isResizing && resizeState.nodeId === node.id}
                  onInspectElement={handleInspectElement}
                  onFitToContent={handleFitToContent}
                  agentBadge={agentBadges[node.id] || null}
                  onSelect={(id, e) => {
                    e.stopPropagation();
                    // The preceding mousedown already selected this node (see
                    // handleDragStart). This click only needs to act when it was
                    // NOT the result of a drag/resize (suppressClickRef) and the
                    // node was already selected before that mousedown — i.e. a
                    // plain click on an already-selected node toggles it off.
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    if (wasSelectedBeforeInteractionRef.current) {
                      setSelectedNodeId(null);
                    }
                  }}
                  onDelete={handleDeleteNode}
                  onDuplicate={handleDuplicateNode}
                  onDragStart={handleDragStart}
                  onResizeStart={handleResizeStart}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-4 z-30 flex flex-col items-start gap-2">
          <div className="pointer-events-auto">
            <Minimap nodes={nodes} selectedNodeId={selectedNodeId} view={viewRect} onNavigate={navigateTo} />
          </div>
          <div className="pointer-events-auto">
            <ZoomControl
              zoom={zoom}
              onZoomIn={() => zoomBy(1)}
              onZoomOut={() => zoomBy(-1)}
              onReset={resetZoom}
              onFit={fitAll}
              canFit={nodes.length > 0}
            />
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 z-40 flex justify-center" style={{ left: 16, right: trayWidth + 16 }}>
          <Toast toast={toast} onDismiss={dismissToast} />
        </div>
      </div>

      {projectId && (
        <FeedbackTray
          open={trayOpen}
          onOpenChange={setTrayOpen}
          scope={trayScope}
          onScopeChange={setTrayScope}
          nodes={nodes}
          selectedNode={selectedNode}
          projectId={projectId}
          projectName={projectName}
          activeComment={activeComment}
          onSelectComment={(nodeId, commentId) => {
            handleSelectFromList(nodeId);
            setActiveComment({ nodeId, commentId });
          }}
          onSelectNode={handleSelectFromList}
          onDeleteComment={handleDeleteComment}
          onSetResolved={handleSetResolved}
          onMarkSent={handleMarkSent}
          onAddComment={handleAddComment}
          isTargeting={!!selectedNode && targetingNodeId === selectedNode.id}
          pendingElement={pendingElement}
          onClearPendingElement={() => setPendingElement(null)}
          composerRef={composerRef}
          onComposerFocusChange={(focused) => setComposerNodeId(focused && selectedNode ? selectedNode.id : null)}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
};

// Keyed by project so switching files from the file bar starts from a clean
// slate (undo history, selection, autosave baseline) instead of carrying the
// previous file's state into the next one.
const CanvasRoute: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  return <CanvasPage key={projectId} />;
};

export default CanvasRoute;
