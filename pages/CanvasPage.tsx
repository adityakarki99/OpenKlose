import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ComponentNode, DragState, ResizeState, ProjectContext, SelectedElementInfo } from '../types';
import { getProject } from '../services/projectService';
import { CANVAS_WIDTH, CANVAS_HEIGHT, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, GRID_SIZE, DEFAULT_PROJECT_CONTEXT } from '../constants';
import SketchNode from '../components/Canvas/SketchNode';
import ZoomControl from '../components/Canvas/ZoomControl';
import VerticalNavigationBar from '../components/Canvas/VerticalNavigationBar';
import SketchInspector from '../components/Sidebar/SketchInspector';
import { ProjectContextPanel } from '../components/Sidebar/ProjectContextPanel';
import { Loader2, X } from 'lucide-react';
import { useHistory } from '../hooks/useHistory';
import { usePersistence } from '../hooks/usePersistence';

const CanvasPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // --- Loading State ---
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- State ---
  const [projectName, setProjectName] = useState('Untitled Project');
  const [zoom, setZoom] = useState(1);

  const {
    state: nodes,
    setState: setNodes,
    setTransient: setNodesTransient,
    commitToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory<ComponentNode[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [designSystemPrompt, setDesignSystemPrompt] = useState<string>('');
  const [projectContext, setProjectContext] = useState<ProjectContext>(DEFAULT_PROJECT_CONTEXT);
  const [isContextPopUpOpen, setIsContextPopUpOpen] = useState(false);

  // Element inspection: when active, clicking an element in the selected node's
  // live preview captures it as a pending target for the next comment.
  const [inspectingNodeId, setInspectingNodeId] = useState<string | null>(null);
  const [pendingElement, setPendingElement] = useState<SelectedElementInfo | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const saveData = useMemo(
    () => ({ name: projectName, nodes, designSystemPrompt, projectContext }),
    [projectName, nodes, designSystemPrompt, projectContext]
  );

  const { saveStatus, saveNow, isDirty } = usePersistence({
    projectId: projectId || null,
    data: saveData,
    enabled: !pageLoading,
  });

  const isSaving = saveStatus === 'saving';

  const dragStartNodesRef = useRef<ComponentNode[]>([]);
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
        setProjectName(project.name);
        setNodes(() => project.nodes || []);
        setDesignSystemPrompt(project.designSystemPrompt || '');
        setProjectContext(project.projectContext || DEFAULT_PROJECT_CONTEXT);
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
    const source = new EventSource('/api/events');
    source.addEventListener('update', () => {
      getProject(projectId)
        .then((project) => {
          setNodes(() => project.nodes || []);
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

  const handleInspectElement = (info: SelectedElementInfo) => {
    setPendingElement(info);
    setInspectingNodeId(null);
  };

  // Reset inspection/pending-element state whenever the selected sketch changes.
  useEffect(() => {
    setInspectingNodeId(null);
    setPendingElement(null);
  }, [selectedNodeId]);

  const handleDeleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
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

  const handleBackToProjects = async () => {
    if (projectId && isDirty) {
      await saveNow();
    }
    navigate('/projects');
  };

  const handleSelectFromList = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (node && canvasRef.current) {
      setSelectedNodeId(id);
      const viewportW = canvasRef.current.clientWidth;
      const viewportH = canvasRef.current.clientHeight;
      const nodeCenterX = node.x + node.width / 2;
      const nodeCenterY = node.y + node.height / 2;
      canvasRef.current.scrollTo({
        left: nodeCenterX * zoom - viewportW / 2,
        top: nodeCenterY * zoom - viewportH / 2,
        behavior: 'smooth',
      });
    }
  };

  // --- Interaction Handlers ---
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (dragState.isDragging || resizeState.isResizing) return;
    setSelectedNodeId(null);
    setCanvasDrag({
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: canvasRef.current?.scrollLeft || 0,
      scrollTop: canvasRef.current?.scrollTop || 0,
    });
  };

  const handleMouseMove = (e: { clientX: number; clientY: number }) => {
    if (canvasDrag.active && canvasRef.current) {
      const dx = e.clientX - canvasDrag.startX;
      const dy = e.clientY - canvasDrag.startY;
      canvasRef.current.scrollLeft = canvasDrag.scrollLeft - dx;
      canvasRef.current.scrollTop = canvasDrag.scrollTop - dy;
    }

    if (dragState.isDragging && dragState.nodeId) {
      interactionMovedRef.current = true;
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;

      const newX = Math.max(0, Math.min(CANVAS_WIDTH - 100, dragState.initialNodeX + dx));
      const newY = Math.max(0, Math.min(CANVAS_HEIGHT - 100, dragState.initialNodeY + dy));

      const snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

      setNodesTransient((prev) => prev.map((n) => (n.id === dragState.nodeId ? { ...n, x: snappedX, y: snappedY } : n)));
    }

    if (resizeState.isResizing && resizeState.nodeId) {
      interactionMovedRef.current = true;
      const dx = (e.clientX - resizeState.startX) / zoom;
      const dy = (e.clientY - resizeState.startY) / zoom;

      setNodesTransient((prev) =>
        prev.map((n) => {
          if (n.id !== resizeState.nodeId) return n;
          let { x, y, width, height } = n;
          const { handle, initialX, initialY, initialWidth, initialHeight } = resizeState;
          if (handle?.includes('e')) width = Math.max(200, initialWidth + dx);
          if (handle?.includes('w')) {
            const newW = Math.max(200, initialWidth - dx);
            if (newW !== width) { x = initialX + dx; width = newW; }
          }
          if (handle?.includes('s')) height = Math.max(100, initialHeight + dy);
          if (handle?.includes('n')) {
            const newH = Math.max(100, initialHeight - dy);
            if (newH !== height) { y = initialY + dy; height = newH; }
          }
          return { ...n, x, y, width, height };
        })
      );
    }
  };

  const handleMouseUp = () => {
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
  // Binding mousemove/mouseup only on the canvas div means releasing the mouse
  // over a sibling overlay (the toolbar, the inspector panel) or anywhere
  // outside the div's bounds never fires handleMouseUp — isDragging stays
  // true forever, so the node keeps "sticking" to the cursor on the next
  // move anywhere in the canvas. Window-level listeners, active only while a
  // gesture is actually in progress, always see the release.
  useEffect(() => {
    if (!dragState.isDragging && !resizeState.isResizing && !canvasDrag.active) return;

    const onMove = (e: MouseEvent) => handleMouseMove(e);
    const onUp = () => handleMouseUp();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Safety net: alt-tabbing or otherwise losing focus mid-drag should also end it.
    window.addEventListener('blur', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState.isDragging, resizeState.isResizing, canvasDrag.active]);

  const handleDragStart = (id: string, e: React.MouseEvent) => {
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

  const handleResizeStart = (id: string, handle: string, e: React.MouseEvent) => {
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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId && !document.querySelector('input:focus') && !document.querySelector('textarea:focus')) {
          handleDeleteNode(selectedNodeId);
        }
      }
      if (e.key === 'Escape') setSelectedNodeId(null);

      if ((e.metaKey || e.ctrlKey) && !document.querySelector('input:focus') && !document.querySelector('textarea:focus')) {
        if (e.key === 'z') {
          if (e.shiftKey) { if (canRedo) redo(); } else if (canUndo) undo();
        }
        if (e.key === 'y' && canRedo) redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, canUndo, canRedo, undo, redo]);

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
        <div className="absolute top-6 left-6 z-30 pointer-events-auto">
          <VerticalNavigationBar
            onBack={handleBackToProjects}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onAdd={handleAddSketch}
            onSave={handleSaveProject}
            onToggleContext={() => setIsContextPopUpOpen((v) => !v)}
            isSaving={isSaving}
            saveStatus={saveStatus}
            isDirty={isDirty}
            nodes={nodes}
            onSelectNode={handleSelectFromList}
            projectName={projectName}
          />
        </div>

        {isContextPopUpOpen && (
          <div className="absolute left-24 top-6 z-[100] flex h-[600px] max-h-[80vh] w-[400px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surfaceElevated shadow-2xl animate-in fade-in slide-in-from-left-4 duration-300">
            <div className="flex items-center justify-between border-b border-app-border bg-app-surfaceSoft/60 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-app-muted">Project Context</span>
              <button
                onClick={() => setIsContextPopUpOpen(false)}
                className="rounded-lg p-1 text-app-subtle transition-colors hover:bg-app-surfaceMuted/10 hover:text-app-primary"
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
          className={`w-full h-full overflow-auto canvas-scroll relative ${canvasDrag.active ? 'cursor-grabbing' : 'cursor-default'}`}
          onMouseDown={handleCanvasMouseDown}
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
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="pointer-events-auto mx-4 w-full max-w-md space-y-4 rounded-2xl border border-app-border bg-app-canvasEmpty/90 p-6 shadow-2xl backdrop-blur-xl">
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold text-app-primary">Start sketching a component.</h2>
                      <p className="text-sm text-app-secondary">
                        Place a sketch here, then use <code>/klose</code> in your coding agent to ideate the details against
                        this project's design system and build the real component into your repo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddSketch}
                      className="rounded-full border border-app-border bg-app-surfaceMuted/10 px-4 py-2 text-xs font-medium text-app-primary transition-colors hover:bg-app-surfaceMuted/20"
                    >
                      + Add a sketch
                    </button>
                  </div>
                </div>
              )}
              {nodes.map((node) => (
                <SketchNode
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  isInspecting={inspectingNodeId === node.id}
                  onInspectElement={handleInspectElement}
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

        <div className="absolute bottom-4 left-4 z-30 flex flex-col items-center gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <ZoomControl defaultZoom={(zoom * 100) as any} onZoomChange={(newZoom) => setZoom(newZoom / 100)} className="!p-0 scale-90" />
          </div>
        </div>
      </div>

      {selectedNode && projectId && (
        <SketchInspector
          node={selectedNode}
          projectId={projectId}
          projectName={projectName}
          isInspecting={inspectingNodeId === selectedNode.id}
          pendingElement={pendingElement}
          onToggleInspect={() =>
            setInspectingNodeId((prev) => (prev === selectedNode.id ? null : selectedNode.id))
          }
          onClearPendingElement={() => setPendingElement(null)}
          onConsumePendingElement={() => setPendingElement(null)}
          onClose={() => setSelectedNodeId(null)}
          onUpdate={handleUpdateNode}
        />
      )}
    </div>
  );
};

export default CanvasPage;
